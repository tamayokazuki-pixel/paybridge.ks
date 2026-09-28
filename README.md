# paybridge.ks Next.js App

This project converts the original static HTML banking demo into a full Next.js application for paybridge.ks with Supabase authentication, Google sign-in, protected dashboard pages, deposit and withdrawal requests (including cheques), admin approvals, payment-method settings, and persistent database records. The root-level `*.html` files are archived localStorage demos; the live website is under `app/`.

## Stack

- Next.js App Router
- TypeScript
- Tailwind CSS
- Supabase Auth and database
- Google OAuth through Supabase
- Next.js API routes for backend actions

## Setup

1. Create a Supabase project.
2. In Supabase SQL Editor, run `supabase/schema.sql` for a **new** database. For an existing database, run `supabase/add_cheques.sql` instead (see below).
3. Create `.env.local` with the Supabase values (never commit this file):

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
```

Only the server should have access to the service role key.

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

## Cheque requests

- Customers use **Dashboard → Cheques** (also linked from Add Money and Withdraw). A deposit requires a cheque number, issuing bank, payer, date, amount (min $50), and **front and endorsed-back images** (JPEG/PNG/WebP, max 5 MB each). A withdrawal requires the amount, payee, and full mailing address; submitting it reserves the funds immediately.
- Cheque requests appear in **Admin → Cheques**, as well as the normal Requests queue. Admins can inspect the private scans or mailing details, filter requests, and approve/reject them. A cheque deposit only credits the account after manual verification and approval. A withdrawal approval requires a cheque/dispatch reference; a rejection requires a reason and releases the hold. Customers can view their own request details and rejection reasons from Transactions.
- Cheques are `deposit`/`withdrawal` rows in the **same ledger** as other methods, with `method_key = 'cheque'` and `cheque_details` metadata. A database trigger serializes withdrawal holds across all methods so simultaneous requests cannot reserve the same funds twice. The scans live in a **private Supabase Storage bucket**, not the database or a public URL. Only the owner or a verified admin can request 5-minute signed links; audit any pre-existing broad `storage.objects` policies before using real scans. Duplicate pending/completed deposits for the same user's bank and cheque number are blocked by a database index.
- **Existing Supabase projects must run `supabase/add_cheques.sql`** in the SQL Editor before using the new UI. This idempotent migration adds cheque metadata and the private bucket, and removes older browser-write policies that allowed forging completed deposits or changing one's role/status. New installations get the same setup via `supabase/schema.sql`. If rejection fails due to an old status CHECK constraint, also run `supabase/fix_transactions_status.sql`.
- Processing is **manual**: this demo does not clear/verify a cheque with a bank, print or mail cheques, or reconcile delivery. Only approve a deposit after independently confirming cleared funds, and only approve a withdrawal after arranging the cheque. Check your host's multipart request-size limit for two 5 MB images, and apply your organization's retention policy to stored scans before using real customer data.

Run automated checks with `npm test`, `npm run lint`, and `npm run build` (builds require the three Supabase environment variables above).

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
