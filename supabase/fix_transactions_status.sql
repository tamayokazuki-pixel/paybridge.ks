-- paybridge.ks -- why "Reject" fails in the admin console, and the fix
--
-- SYMPTOM
--   Approving a request works, rejecting it does not. The API answers with a
--   400 and the change is never saved.
--
-- CAUSE
--   The live `transactions` table comes from an older version of this project.
--   Its status CHECK constraint only allows the old vocabulary
--   ('pending', 'completed', 'failed'), but the current app writes:
--       approve -> 'completed'  (allowed on the old table -> works)
--       reject  -> 'rejected'   (NOT allowed on the old table -> fails)
--   Postgres raises 23514 "new row for relation \"transactions\" violates check
--   constraint \"transactions_status_check\"", supabase-js returns it and the
--   route answers 400, so the row stays `pending`.
--   (supabase/schema.sql, meanwhile, declared a third set - 'approved'/'rejected' -
--   which is how the drift started. It now matches the app.)
--
-- THE FIX
--   Run this file once in the Supabase SQL Editor
--   (Dashboard -> SQL Editor -> New query -> paste -> Run).
--   It is safe to run more than once. Each statement commits on its own, so a
--   failure near the end does not undo the fixes above it.

-- ---------------------------------------------------------------------------
-- 1. Columns the application writes that an older table can be missing.
--    A missing column makes PostgREST answer PGRST204 "Could not find the '...'
--    column of 'transactions' in the schema cache" - the same 400 symptom.
-- ---------------------------------------------------------------------------
alter table public.transactions add column if not exists method_key text;
alter table public.transactions add column if not exists method_label text;
alter table public.transactions add column if not exists reference text;
alter table public.transactions add column if not exists admin_note text;
alter table public.transactions add column if not exists completed_at timestamptz;
alter table public.transactions add column if not exists updated_at timestamptz not null default now();
-- Kept because the app writes it for databases that still have the legacy
-- profiles foreign key (lib/transactions.ts drops it automatically elsewhere).
alter table public.transactions add column if not exists profile_id uuid;

-- ---------------------------------------------------------------------------
-- 2. Fold legacy values into the vocabulary the app uses, so history keeps
--    working (a 'failed' row becomes 'rejected', an 'approved' row 'completed').
-- ---------------------------------------------------------------------------
update public.transactions set status = 'completed' where lower(status) in ('approved', 'complete', 'succeeded', 'success');
update public.transactions set status = 'rejected'  where lower(status) in ('failed', 'declined');
update public.transactions set status = 'pending'   where status is null or trim(status) = '';

update public.transactions set type = 'withdrawal' where lower(type) in ('withdraw', 'payout', 'cashout', 'debit');
update public.transactions set type = 'deposit'    where lower(type) in ('credit', 'funding', 'deposit_request');
update public.transactions set type = 'transfer'   where lower(type) in ('send', 'internal_transfer');

-- If `status` is a Postgres enum rather than text, the CHECK constraint steps
-- below do not apply; add the missing labels instead.
do $$
declare
  status_type text;
begin
  select t.typname into status_type
  from pg_attribute a
  join pg_type t on t.oid = a.atttypid
  where a.attrelid = 'public.transactions'::regclass
    and a.attname = 'status'
    and a.attnum > 0
    and not a.attisdropped;

  if status_type is not null
     and exists (select 1 from pg_type where typname = status_type and typtype = 'e') then
    execute format('alter type %I add value if not exists ''rejected''', status_type);
    execute format('alter type %I add value if not exists ''completed''', status_type);
    raise notice 'Added the missing labels to enum type %', status_type;
  end if;
exception when others then
  raise notice 'Enum check skipped (%): %', status_type, sqlerrm;
end
$$;

-- ---------------------------------------------------------------------------
-- 3. Replace the CHECK constraints with the values the app actually writes.
-- ---------------------------------------------------------------------------
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select con.conname
    from pg_constraint con
    where con.conrelid = 'public.transactions'::regclass
      and con.contype = 'c'
      and (
        pg_get_constraintdef(con.oid) ilike '%status%'
        or pg_get_constraintdef(con.oid) ilike '%type%'
      )
  loop
    execute format('alter table public.transactions drop constraint %I', constraint_name);
    raise notice 'Dropped old constraint %', constraint_name;
  end loop;
end
$$;

alter table public.transactions
  add constraint transactions_status_check
  check (status in ('pending', 'completed', 'rejected'));

alter table public.transactions
  add constraint transactions_type_check
  check (type in ('deposit', 'withdrawal', 'transfer', 'admin_adjustment'));

-- ---------------------------------------------------------------------------
-- 4. Keep updated_at fresh (schema.sql sets this trigger up for new projects).
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists transactions_touch_updated_at on public.transactions;
create trigger transactions_touch_updated_at
before update on public.transactions
for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 5. Verify: the first result should list
--    CHECK ((status = ANY (ARRAY['pending'::text, 'completed'::text, 'rejected'::text])))
-- ---------------------------------------------------------------------------
select conname, pg_get_constraintdef(oid) as definition
from pg_constraint
where conrelid = 'public.transactions'::regclass
  and contype = 'c'
order by conname;
