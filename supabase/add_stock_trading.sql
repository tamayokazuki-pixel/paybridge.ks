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
  created_at timestamptz not null default now()
);

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
  p_shares numeric
)
returns jsonb
language plpgsql
set search_path = public
as $$
declare
  v_symbol text;
  v_company_name text;
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
     p_shares > 1000000 or p_shares <> round(p_shares, 4) then
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
  into v_company_name, v_price
  from public.stock_quotes
  where symbol = v_symbol and is_active = true
  for share;

  if not found then
    raise exception 'Stock listing is unavailable.' using errcode = 'P0001';
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
    (user_id, transaction_id, symbol, company_name, shares, price_per_share, total_amount)
  values
    (p_user_id, v_transaction_id, v_symbol, v_company_name, p_shares, v_price, v_total)
  returning id into v_trade_id;

  return jsonb_build_object(
    'id', v_trade_id,
    'transaction_id', v_transaction_id,
    'symbol', v_symbol,
    'company_name', v_company_name,
    'shares', p_shares,
    'price_per_share', v_price,
    'total_amount', v_total,
    'available_balance', v_available - v_total,
    'created_at', v_now
  );
end;
$$;

-- PostgREST exposes functions to browser roles by default in some Supabase
-- setups. Explicitly restrict this RPC to the server-only service role.
revoke all on function public.execute_stock_purchase(uuid, text, numeric) from public, anon, authenticated;
grant execute on function public.execute_stock_purchase(uuid, text, numeric) to service_role;

notify pgrst, 'reload schema';
