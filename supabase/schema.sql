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

create table if not exists public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  type text not null check (type in ('deposit', 'withdrawal', 'transfer', 'admin_adjustment')),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  amount numeric(14,2) not null check (amount >= 0),
  description text not null,
  method_key text,
  method_label text,
  reference text,
  admin_note text,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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

drop policy if exists "Users can update own profile" on public.users;
create policy "Users can update own profile"
on public.users for update
to authenticated
using (id = auth.uid())
with check (id = auth.uid());

drop policy if exists "Users can insert own profile" on public.users;
create policy "Users can insert own profile"
on public.users for insert
to authenticated
with check (id = auth.uid());

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

drop policy if exists "Users can create own transactions" on public.transactions;
create policy "Users can create own transactions"
on public.transactions for insert
to authenticated
with check (user_id = auth.uid());

drop policy if exists "Users can read own activity logs" on public.activity_logs;
create policy "Users can read own activity logs"
on public.activity_logs for select
to authenticated
using (user_id = auth.uid() or actor_id = auth.uid());

-- After creating your first account, run this once with that account's email:
-- update public.users set role = 'admin', is_verified = true where email = 'you@example.com';
