-- Apply to an existing project that already has stock trading installed
-- (supabase/add_stock_trading.sql or a current supabase/schema.sql).
--
-- This adds buy/sell sides to the trade ledger, lets the trusted Next.js API
-- pass its server-calculated paper-market multiplier to the purchase RPC,
-- and adds an atomic sale RPC that converts owned shares back into the
-- account's available cash balance. Existing trade rows are buys.
--
-- The browser cannot call these RPCs: execution is granted only to the
-- server-side service_role. The stored stock_quotes price remains the
-- anchor, and both RPCs reject a multiplier outside 0.90x-1.10x that anchor.

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

  -- This row lock serializes purchases and sales with pending withdrawals,
  -- cheque holds, and other stock trades for the same account.
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

  -- Match the shared ledger rules in lib/balance.ts and the withdrawal
  -- trigger: settled deposits/admin credits add cash; pending and settled
  -- withdrawals subtract cash. A stock purchase is a completed withdrawal.
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

-- Keep both execution paths server-only.
revoke all on function public.execute_stock_purchase(uuid, text, numeric) from public, anon, authenticated;
revoke all on function public.execute_stock_purchase(uuid, text, numeric, numeric) from public, anon, authenticated;
revoke all on function public.execute_stock_sale(uuid, text, numeric, numeric) from public, anon, authenticated;
grant execute on function public.execute_stock_purchase(uuid, text, numeric) to service_role;
grant execute on function public.execute_stock_purchase(uuid, text, numeric, numeric) to service_role;
grant execute on function public.execute_stock_sale(uuid, text, numeric, numeric) to service_role;

notify pgrst, 'reload schema';
