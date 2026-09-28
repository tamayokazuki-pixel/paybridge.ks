-- Apply ONCE to an existing Supabase project before enabling cheque requests.
-- New projects running schema.sql already have these definitions. Safe to re-run.
-- Cheques use the existing deposit/withdrawal transaction types and approval
-- routes; no balance migration or new transaction statuses are needed.

alter table public.transactions add column if not exists method_key text;
alter table public.transactions add column if not exists method_label text;
alter table public.transactions add column if not exists cheque_details jsonb;
alter table public.transactions add column if not exists reference text;
alter table public.transactions add column if not exists admin_note text;
alter table public.transactions add column if not exists completed_at timestamptz;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.transactions'::regclass
      and conname = 'transactions_cheque_details_check'
  ) then
    alter table public.transactions add constraint transactions_cheque_details_check check (
      method_key is distinct from 'cheque' or (
        cheque_details is not null and jsonb_typeof(cheque_details) = 'object' and
        ((type = 'deposit' and coalesce(cheque_details->>'kind', '') = 'deposit') or
         (type = 'withdrawal' and coalesce(cheque_details->>'kind', '') = 'withdrawal'))
      )
    );
  end if;
end;
$$;

create unique index if not exists transactions_unique_cheque_deposit
on public.transactions (user_id, lower(cheque_details->>'bankName'), lower(regexp_replace(cheque_details->>'chequeNumber', '[ -]', '', 'g')))
where method_key = 'cheque' and type = 'deposit' and status in ('pending', 'completed', 'approved');

-- Lock the user's account row while checking their ledger and inserting any
-- pending withdrawal. This covers cheque AND non-cheque requests and prevents
-- concurrent withdrawals from reserving the same balance twice.
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

-- Cheque scans must never be served from a public bucket. No user-facing
-- Storage policies are added: only service-role uploads and signed reads.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('cheque-images', 'cheque-images', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']::text[])
on conflict (id) do update
  set public = false, file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The app always writes via server-side, authenticated API routes. These old
-- direct browser policies allowed forged completed deposits, self-promotion
-- to admin and bypassing a suspended account's status.
drop policy if exists "Users can create own transactions" on public.transactions;
drop policy if exists "Users can update own profile" on public.users;
drop policy if exists "Users can insert own profile" on public.users;

notify pgrst, 'reload schema';
