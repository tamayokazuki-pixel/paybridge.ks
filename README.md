# paybridge.ks Next.js App

This project converts the original static HTML banking demo into a full Next.js application for paybridge.ks with Supabase authentication, Google sign-in, protected dashboard pages, deposit requests, admin approvals, payment-method settings, and persistent database records.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth and database
- Google OAuth through Supabase
- Next.js API routes for backend actions

## Setup

1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase/schema.sql`.
3. Copy `.env.example` to `.env` (or `.env.local` if you prefer that naming) and fill in the Supabase values.
4. In Supabase Auth providers, enable Google and email OTP sign-in.
5. Add this callback URL in Supabase Auth settings:

```text
http://localhost:3000/auth/callback
```

6. Register your first user, then run:

```sql
update public.users
set role = 'admin', is_verified = true
where email = 'you@example.com';
```

7. Install dependencies and run the app:

```bash
npm install
npm run dev
```

Then open `http://localhost:3000`.

## Troubleshooting

### The admin console cannot reject a transaction (approve works)

Databases created before `supabase/schema.sql` was corrected only allow the
legacy status values `pending`, `completed`, `failed`. The reject route writes
`rejected`, so Postgres refuses the update:

```text
new row for relation "transactions" violates check constraint "transactions_status_check"
```

Fix it by running **`supabase/fix_transactions_status.sql`** once in the Supabase
SQL editor (Dashboard → SQL Editor → New query). It adds any missing columns,
folds legacy values (`failed` → `rejected`, `approved` → `completed`) into the
current vocabulary and replaces the CHECK constraints. It is safe to re-run.

To confirm the state of a database first:

```bash
node scripts/db_tests/diagnose_reject.js            # read-only report
node scripts/db_tests/diagnose_reject.js --probe    # also test the reject UPDATE
```

`lib/transactions.ts` additionally retries writes without columns the live table
is missing and falls back to the legacy status value, so the admin console keeps
working until the SQL above has been applied.
