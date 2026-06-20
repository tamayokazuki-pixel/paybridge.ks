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
