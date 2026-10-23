create extension if not exists "pgcrypto";

create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique,
  full_name text not null default 'Customer',
  username text unique,
  phone text,
  dob date,
  country text,
  account_id text unique not null,
  account_type text not null default 'Personal Checking',
  currency text not null default 'USD - US Dollar',
  role text not null default 'user' check (role in ('user', 'admin')),
  status text not null default 'active' check (status in ('active', 'suspended')),
  is_verified boolean not null default false,
  marketing boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.payment_methods (
  id uuid primary key default gen_random_uuid(),
  key text unique not null,
  label text not null,
  fields jsonb not null default '[]'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- status/type vocabulary must match the application:
--   approve -> 'completed', reject -> 'rejected'  (see lib/transaction-status.ts)
-- Databases created before this line used 'approved' / 'failed'; if the admin
-- console cannot reject a transaction, run supabase/fix_transactions_status.sql.
create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in ('deposit', 'withdrawal', 'transfer', 'admin_adjustment')),
  status text not null default 'pending' check (status in ('pending', 'completed', 'rejected')),
  amount numeric(14,2) not null check (amount >= 0),
  description text not null,
  method_key text,
  method_label text,
  -- Cheques share the existing deposit/withdrawal ledger and approval workflow.
  -- Scans are stored separately in a *private* Storage bucket; only paths live here.
  cheque_details jsonb,
  reference text,
  admin_note text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint transactions_cheque_details_check check (
    method_key is distinct from 'cheque' or (
      cheque_details is not null and jsonb_typeof(cheque_details) = 'object' and
      ((type = 'deposit' and coalesce(cheque_details->>'kind', '') = 'deposit') or
       (type = 'withdrawal' and coalesce(cheque_details->>'kind', '') = 'withdrawal'))
    )
  )
);

-- Reject a second deposit of the same cheque while the first is pending or cleared.
create unique index if not exists transactions_unique_cheque_deposit
on public.transactions (user_id, lower(cheque_details->>'bankName'), lower(regexp_replace(cheque_details->>'chequeNumber', '[ -]', '', 'g')))
where method_key = 'cheque' and type = 'deposit' and status in ('pending', 'completed', 'approved');

-- Serialize withdrawal holds across ALL methods. An API balance check alone
-- cannot prevent two concurrent requests from spending the same funds.
create or replace function public.reserve_withdrawal_funds()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  account_status text;
  available numeric;
begin
  if new.status <> 'pending' or new.type not in ('withdrawal', 'withdraw', 'transfer') then
    return new;
  end if;

  select status into account_status from public.users where id = new.user_id for update;
  if not found or account_status <> 'active' then
    raise exception 'An active account is required to withdraw.' using errcode = 'P0001';
  end if;

  select coalesce(sum(case
    when type in ('deposit', 'admin_adjustment') and lower(status::text) in ('completed', 'approved', 'complete', 'success', 'succeeded') then amount
    when type in ('withdrawal', 'withdraw', 'transfer') and lower(status::text) in ('pending', 'completed', 'approved', 'complete', 'success', 'succeeded') then -amount
    else 0
  end), 0) into available
  from public.transactions where user_id = new.user_id;

  if new.amount > available then
    raise exception 'Insufficient available balance.' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists transactions_reserve_withdrawal on public.transactions;
create trigger transactions_reserve_withdrawal
before insert on public.transactions
for each row execute function public.reserve_withdrawal_funds();

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references public.users(id) on delete set null,
  user_id uuid not null references public.users(id) on delete cascade,
  action text not null,
  details text,
  created_at timestamptz not null default now()
);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists users_touch_updated_at on public.users;
create trigger users_touch_updated_at
before update on public.users
for each row execute function public.touch_updated_at();

drop trigger if exists payment_methods_touch_updated_at on public.payment_methods;
create trigger payment_methods_touch_updated_at
before update on public.payment_methods
for each row execute function public.touch_updated_at();

drop trigger if exists transactions_touch_updated_at on public.transactions;
create trigger transactions_touch_updated_at
before update on public.transactions
for each row execute function public.touch_updated_at();

insert into public.payment_methods (key, label, fields)
values
  ('bitcoin', 'Bitcoin (BTC)', '[{"label":"BTC Wallet Address","value":"1A1zP1eP5QGefi2DMPTfTL5SLmv7Divf"}]'),
  ('ethereum', 'Ethereum (ETH)', '[{"label":"ETH Wallet Address","value":"0x71C7656EC7ab88b098defB751B7401B5f6d8976F"}]'),
  ('usdt_trc20', 'USDT - TRC20', '[{"label":"TRC20 Wallet Address","value":"TGj1Ej1qRzL9feLTLhjwgxXF4Ct6GTWg2U"}]'),
  ('usdt_erc20', 'USDT - ERC20', '[{"label":"ERC20 Wallet Address","value":"0x71C7656EC7ab88b098defB751B7401B5f6d8976F"}]'),
  ('wire', 'Wire Transfer (SWIFT)', '[{"label":"Bank Name","value":"paybridge.ks Bank"},{"label":"Account Name","value":"paybridge.ks Ltd"},{"label":"Account Number","value":"0012345678"},{"label":"SWIFT / BIC","value":"PBRGUS33XXX"}]'),
  ('ach', 'ACH Bank Transfer (US)', '[{"label":"Bank Name","value":"paybridge.ks Bank"},{"label":"Account Name","value":"paybridge.ks Ltd"},{"label":"Account Number","value":"0012345678"},{"label":"Routing Number","value":"021000021"}]')
on conflict (key) do nothing;

alter table public.users enable row level security;
alter table public.payment_methods enable row level security;
alter table public.transactions enable row level security;
alter table public.activity_logs enable row level security;

drop policy if exists "Users can read own profile" on public.users;
create policy "Users can read own profile"
on public.users for select
to authenticated
using (id = auth.uid());

-- All profile writes go through /api/profile (service role), not directly from
-- the browser: an unrestricted self-update could grant an account admin rights
-- or reactivate a suspended account.
drop policy if exists "Users can update own profile" on public.users;
drop policy if exists "Users can insert own profile" on public.users;

drop policy if exists "Users can read active payment methods" on public.payment_methods;
create policy "Users can read active payment methods"
on public.payment_methods for select
to authenticated
using (is_active = true);

drop policy if exists "Users can read own transactions" on public.transactions;
create policy "Users can read own transactions"
on public.transactions for select
to authenticated
using (user_id = auth.uid());

-- Only the validated API routes may create transactions. The old direct-insert
-- policy let a browser insert a 'completed' deposit and credit itself instantly.
drop policy if exists "Users can create own transactions" on public.transactions;

drop policy if exists "Users can read own activity logs" on public.activity_logs;
create policy "Users can read own activity logs"
on public.activity_logs for select
to authenticated
using (user_id = auth.uid() or actor_id = auth.uid());

-- Private cheque scans: no authenticated-client Storage policies are granted.
-- The server uploads them with its service role; an authenticated owner or
-- verified admin obtains short-lived signed URLs from the cheque images API.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cheque-images', 'cheque-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- After creating your first account, run this once with that account's email:
-- update public.users set role = 'admin', is_verified = true where email = 'you@example.com';

-- Apply to an existing Supabase project before enabling Stocks in the dashboard.
-- New projects running schema.sql already have these tables and policies.
-- All quote prices are illustrative demo data: this is paper trading only.

create table if not exists public.stock_quotes (
  symbol text primary key check (symbol ~ '^[A-Z]{1,5}([.][A-Z])?$'),
  company_name text not null,
  sector text not null,
  price_per_share numeric(14,2) not null check (price_per_share > 0),
  is_active boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into public.stock_quotes (symbol, company_name, sector, price_per_share)
values
  ('AAPL', 'Apple Inc.', 'Technology', 231.00),
  ('DJT', 'Trump Media & Technology Group', 'Media & Entertainment', 18.50),
  ('MSFT', 'Microsoft Corporation', 'Technology', 425.00),
  ('NVDA', 'NVIDIA Corporation', 'Semiconductors', 141.00),
  ('AMZN', 'Amazon.com, Inc.', 'Consumer Discretionary', 218.00),
  ('TSLA', 'Tesla, Inc.', 'Consumer Discretionary', 320.00),
  ('GOOGL', 'Alphabet Inc.', 'Communication Services', 177.00),
  ('META', 'Meta Platforms, Inc.', 'Communication Services', 612.00),
  ('AMD', 'Advanced Micro Devices, Inc.', 'Semiconductors', 132.00),
  ('JPM', 'JPMorgan Chase & Co.', 'Financials', 295.00)
on conflict (symbol) do nothing;

alter table public.transactions add column if not exists method_key text;
alter table public.transactions add column if not exists method_label text;
alter table public.transactions add column if not exists completed_at timestamptz;

create table if not exists public.stock_trades (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  transaction_id uuid not null unique references public.transactions(id),
  symbol text not null references public.stock_quotes(symbol),
  company_name text not null,
  shares numeric(20,4) not null check (shares > 0),
  price_per_share numeric(14,2) not null check (price_per_share > 0),
  total_amount numeric(14,2) not null check (total_amount > 0),
  side text not null default 'buy' check (side in ('buy', 'sell')),
  created_at timestamptz not null default now()
);

alter table public.stock_trades add column if not exists side text;
update public.stock_trades
set side = 'buy'
where side is null or side not in ('buy', 'sell');
alter table public.stock_trades alter column side set default 'buy';
alter table public.stock_trades alter column side set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conrelid = 'public.stock_trades'::regclass
      and conname = 'stock_trades_side_check'
  ) then
    alter table public.stock_trades
      add constraint stock_trades_side_check check (side in ('buy', 'sell'));
  end if;
end
$$;

create index if not exists stock_trades_user_created_idx
  on public.stock_trades (user_id, created_at desc);
create index if not exists stock_trades_user_symbol_idx
  on public.stock_trades (user_id, symbol);

alter table public.stock_quotes enable row level security;
alter table public.stock_trades enable row level security;

drop policy if exists "Authenticated users can read active stock quotes" on public.stock_quotes;
create policy "Authenticated users can read active stock quotes"
on public.stock_quotes for select
to authenticated
using (is_active = true);

drop policy if exists "Users can read own stock trades" on public.stock_trades;
create policy "Users can read own stock trades"
on public.stock_trades for select
to authenticated
using (user_id = auth.uid());

-- No browser-side writes: purchases must use the authenticated server API and
-- its atomic RPC. The service role is the only application role that can write.
revoke all on public.stock_quotes from public, anon, authenticated;
grant select on public.stock_quotes to authenticated, service_role;
revoke all on public.stock_trades from public, anon, authenticated;
grant select on public.stock_trades to authenticated;
grant all on public.stock_trades to service_role;

-- Remove legacy browser writes that would let an account forge a completed
-- deposit or edit its own role/status while using the balance-backed feature.
drop policy if exists "Users can create own transactions" on public.transactions;
drop policy if exists "Users can update own profile" on public.users;
drop policy if exists "Users can insert own profile" on public.users;

create or replace function public.execute_stock_purchase(
  p_user_id uuid,
  p_symbol text,
  p_shares numeric,
  p_price_multiplier numeric
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_symbol text;
  v_company_name text;
  v_anchor_price numeric(14,2);
  v_price numeric(14,2);
  v_total numeric(14,2);
  v_available numeric;
  v_account_status text;
  v_transaction_id uuid;
  v_trade_id uuid;
  v_description text;
  v_now timestamptz := now();
begin
  if p_user_id is null or p_shares is null or p_shares <= 0 or
     p_shares > 1000000 or p_shares <> round(p_shares, 4) or
     p_price_multiplier is null or p_price_multiplier < 0.90 or
     p_price_multiplier > 1.10 then
    raise exception 'Invalid stock order.' using errcode = 'P0001';
  end if;

  v_symbol := upper(trim(coalesce(p_symbol, '')));
  if v_symbol !~ '^[A-Z]{1,5}([.][A-Z])?$' then
    raise exception 'Stock listing is unavailable.' using errcode = 'P0001';
  end if;

  -- This row lock serializes purchases with pending withdrawals, cheque holds,
  -- and other stock purchases for the same account.
  select status into v_account_status
  from public.users
  where id = p_user_id
  for update;

  if not found or v_account_status <> 'active' then
    raise exception 'An active account is required to buy shares.' using errcode = 'P0001';
  end if;

  select company_name, price_per_share
  into v_company_name, v_anchor_price
  from public.stock_quotes
  where symbol = v_symbol and is_active = true
  for share;

  if not found then
    raise exception 'Stock listing is unavailable.' using errcode = 'P0001';
  end if;

  v_price := round(v_anchor_price * p_price_multiplier, 2);
  if v_price <= 0 then
    raise exception 'Invalid stock order.' using errcode = 'P0001';
  end if;

  v_total := round(p_shares * v_price, 2);
  if v_total < 0.01 then
    raise exception 'Stock order must be at least $0.01.' using errcode = 'P0001';
  end if;

  -- Match the shared ledger rules in lib/balance.ts and the withdrawal trigger:
  -- settled deposits/admin credits add cash; pending and settled withdrawals
  -- subtract cash. A stock purchase is stored as a completed withdrawal.
  select coalesce(sum(case
    when type in ('deposit', 'admin_adjustment') and lower(status::text) in ('completed', 'approved', 'complete', 'success', 'succeeded') then amount
    when type in ('withdrawal', 'withdraw', 'transfer') and lower(status::text) in ('pending', 'completed', 'approved', 'complete', 'success', 'succeeded') then -amount
    else 0
  end), 0)
  into v_available
  from public.transactions
  where user_id = p_user_id;

  if v_total > v_available then
    raise exception 'Insufficient available balance.' using errcode = 'P0001';
  end if;

  v_description := 'Stock purchase: ' || p_shares::text || ' shares of ' || v_company_name || ' (' || v_symbol || ')';

  -- Keep compatibility with older installations that have a required legacy
  -- profile_id column. Current schema.sql installations do not have that column.
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions' and column_name = 'profile_id'
  ) then
    execute 'insert into public.transactions
      (user_id, profile_id, type, status, amount, description, method_key, method_label, completed_at)
      values ($1, $1, ''withdrawal'', ''completed'', $2, $3, ''stocks'', ''Stock purchase'', $4)
      returning id'
    into v_transaction_id
    using p_user_id, v_total, v_description, v_now;
  else
    insert into public.transactions
      (user_id, type, status, amount, description, method_key, method_label, completed_at)
    values
      (p_user_id, 'withdrawal', 'completed', v_total, v_description, 'stocks', 'Stock purchase', v_now)
    returning id into v_transaction_id;
  end if;

  insert into public.stock_trades
    (user_id, transaction_id, symbol, company_name, shares, price_per_share, total_amount, side)
  values
    (p_user_id, v_transaction_id, v_symbol, v_company_name, p_shares, v_price, v_total, 'buy')
  returning id into v_trade_id;

  return jsonb_build_object(
    'id', v_trade_id,
    'transaction_id', v_transaction_id,
    'symbol', v_symbol,
    'company_name', v_company_name,
    'side', 'buy',
    'shares', p_shares,
    'price_per_share', v_price,
    'total_amount', v_total,
    'available_balance', v_available - v_total,
    'created_at', v_now
  );
end;
$$;

-- Compatibility wrapper for older callers of the original three-argument RPC.
create or replace function public.execute_stock_purchase(
  p_user_id uuid,
  p_symbol text,
  p_shares numeric
)
returns jsonb
language sql
set search_path = public
as $$
  select public.execute_stock_purchase($1, $2, $3, 1);
$$;

create or replace function public.execute_stock_sale(
  p_user_id uuid,
  p_symbol text,
  p_shares numeric,
  p_price_multiplier numeric
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_symbol text;
  v_company_name text;
  v_anchor_price numeric(14,2);
  v_price numeric(14,2);
  v_total numeric(14,2);
  v_owned_shares numeric;
  v_available numeric;
  v_account_status text;
  v_transaction_id uuid;
  v_trade_id uuid;
  v_description text;
  v_now timestamptz := now();
begin
  if p_user_id is null or p_shares is null or p_shares <= 0 or
     p_shares > 1000000 or p_shares <> round(p_shares, 4) or
     p_price_multiplier is null or p_price_multiplier < 0.90 or
     p_price_multiplier > 1.10 then
    raise exception 'Invalid stock order.' using errcode = 'P0001';
  end if;

  v_symbol := upper(trim(coalesce(p_symbol, '')));
  if v_symbol !~ '^[A-Z]{1,5}([.][A-Z])?$' then
    raise exception 'Stock listing is unavailable.' using errcode = 'P0001';
  end if;

  -- Lock the account before measuring ownership so concurrent buys, sales,
  -- and withdrawal holds for this user cannot spend the same position twice.
  select status into v_account_status
  from public.users
  where id = p_user_id
  for update;

  if not found or v_account_status <> 'active' then
    raise exception 'An active account is required to sell shares.' using errcode = 'P0001';
  end if;

  -- A holder may exit a position even if new purchases have been deactivated.
  select company_name, price_per_share
  into v_company_name, v_anchor_price
  from public.stock_quotes
  where symbol = v_symbol
  for share;

  if not found then
    raise exception 'Stock listing is unavailable.' using errcode = 'P0001';
  end if;

  v_price := round(v_anchor_price * p_price_multiplier, 2);
  if v_price <= 0 then
    raise exception 'Invalid stock order.' using errcode = 'P0001';
  end if;

  select coalesce(sum(case when side = 'sell' then -shares else shares end), 0)
  into v_owned_shares
  from public.stock_trades
  where user_id = p_user_id and symbol = v_symbol;

  if v_owned_shares <= 0 or p_shares > v_owned_shares + 0.000001 then
    raise exception 'Insufficient shares for this sale.' using errcode = 'P0001';
  end if;

  v_total := round(p_shares * v_price, 2);
  if v_total < 0.01 then
    raise exception 'Stock order must be at least $0.01.' using errcode = 'P0001';
  end if;

  select coalesce(sum(case
    when type in ('deposit', 'admin_adjustment') and lower(status::text) in ('completed', 'approved', 'complete', 'success', 'succeeded') then amount
    when type in ('withdrawal', 'withdraw', 'transfer') and lower(status::text) in ('pending', 'completed', 'approved', 'complete', 'success', 'succeeded') then -amount
    else 0
  end), 0)
  into v_available
  from public.transactions
  where user_id = p_user_id;

  v_description := 'Stock sale: ' || p_shares::text || ' shares of ' || v_company_name || ' (' || v_symbol || ')';

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'transactions' and column_name = 'profile_id'
  ) then
    execute 'insert into public.transactions
      (user_id, profile_id, type, status, amount, description, method_key, method_label, completed_at)
      values ($1, $1, ''deposit'', ''completed'', $2, $3, ''stocks'', ''Stock sale'', $4)
      returning id'
    into v_transaction_id
    using p_user_id, v_total, v_description, v_now;
  else
    insert into public.transactions
      (user_id, type, status, amount, description, method_key, method_label, completed_at)
    values
      (p_user_id, 'deposit', 'completed', v_total, v_description, 'stocks', 'Stock sale', v_now)
    returning id into v_transaction_id;
  end if;

  insert into public.stock_trades
    (user_id, transaction_id, symbol, company_name, shares, price_per_share, total_amount, side)
  values
    (p_user_id, v_transaction_id, v_symbol, v_company_name, p_shares, v_price, v_total, 'sell')
  returning id into v_trade_id;

  return jsonb_build_object(
    'id', v_trade_id,
    'transaction_id', v_transaction_id,
    'symbol', v_symbol,
    'company_name', v_company_name,
    'side', 'sell',
    'shares', p_shares,
    'price_per_share', v_price,
    'total_amount', v_total,
    'remaining_shares', v_owned_shares - p_shares,
    'available_balance', v_available + v_total,
    'created_at', v_now
  );
end;
$$;

-- PostgREST exposes functions to browser roles by default in some Supabase
-- setups. Explicitly restrict this RPC to the server-only service role.
revoke all on function public.execute_stock_purchase(uuid, text, numeric) from public, anon, authenticated;
revoke all on function public.execute_stock_purchase(uuid, text, numeric, numeric) from public, anon, authenticated;
revoke all on function public.execute_stock_sale(uuid, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.execute_stock_purchase(uuid, text, numeric) to service_role;
grant execute on function public.execute_stock_purchase(uuid, text, numeric, numeric) to service_role;
grant execute on function public.execute_stock_sale(uuid, text, numeric, numeric) to service_role;

notify pgrst, 'reload schema';
