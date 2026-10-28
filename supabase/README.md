# StockPilot backend setup

The frontend now uses Supabase Auth plus five tables: `profiles`, `ipos`,
`portfolio`, `sips` and `bots`. Run the steps below in the Supabase project that
StockPilot should use.

## 1. Environment variables

Add these to the host's Keys / API keys panel. Never put the service role key in
a `VITE_` variable — it would ship to the browser.

```env
VITE_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
VITE_SUPABASE_ANON_KEY=YOUR-ANON-KEY
```

Until both values are present, the sign-in screen shows a configuration notice.
A real `.env` file is not committed.

## 2. Create the schema

Open **SQL Editor → New query**, paste the contents of
[`schema.sql`](./schema.sql), and run it. It creates:

- Tables, checks and indexes for profiles, IPOs, portfolio holdings, SIPs and
  Telegram bots.
- `handle_new_user()` so every Auth user gets a profile row.
- `is_admin()` and `touch_last_active()` security-definer helpers.
- Row Level Security: portfolio rows are visible only to their owner; IPOs and
  SIPs are readable by signed-in members and writable only by admins. The
  `bots` table is admin-only in every direction because it stores bot tokens.
- Realtime publication for `ipos` and `portfolio`.
- Seed rows for the six current IPOs and four SIP recommendations.

The `bots` table is defined in section 8 of `schema.sql`. If you already ran an
earlier version of the schema, re-running the whole file is safe: it only adds
the new table, policies and grants.

## 3. Create the first administrator

The app has no public sign-up. Bootstrap your own account:

1. In **Authentication → Users**, add your email and password and enable
   **Auto Confirm User**.
2. Promote the generated profile (use your real email):

```sql
update public.profiles
set role = 'admin',
    permissions = '["ipo", "portfolio", "sip"]'::jsonb
where email = 'you@company.com';
```

Every additional teammate should be created from **Admin Panel → Create user**
once the function below is deployed. The trigger assigns them the standard
`user` role and the Edge Function writes their module permissions.

## 4. Deploy the admin Edge Functions

Creating or deleting an Auth user requires the service role key, which cannot
live in the browser. Both functions check the caller's `profiles.role` before
calling the Supabase admin API. `admin-delete-user` also blocks self-deletion.

```bash
supabase functions deploy admin-create-user
supabase functions deploy admin-delete-user
```

Supabase injects `SUPABASE_URL`, `SUPABASE_ANON_KEY` and
`SUPABASE_SERVICE_ROLE_KEY` into deployed functions automatically. No extra
secrets are required.

Until these functions are deployed, the Create user and Remove user actions
will report that the function is unreachable.

## 5. Optional holdings seed

Portfolio rows are scoped to a single user. Replace the email with a real
account before running:

```sql
insert into public.portfolio (
  user_id, stock_name, symbol, sector, quantity,
  buy_price, current_price, ai_verdict, reasoning, confidence
)
select id, 'Reliance Industries', 'RELIANCE', 'Energy', 40,
       2410.50, 2688.40, 'HOLD',
       'Strong Jio and retail cash flows, but the current price already discounts the next two quarters.', 74
from public.profiles
where email = 'you@company.com';
```

## Notes

- IPO, portfolio and SIP screens read from Supabase through React Query.
  `ipos` and `portfolio` also subscribe to Postgres changes, so edits appear
  without a refresh.
- The Admin Panel's **Bot management** tab writes to `bots` and masks tokens in
  the UI. The Hinglish message builders live in
  `src/lib/notification-templates.ts`; they are formatting helpers until the
  dispatcher is connected.
- Bot tokens are stored as text because the dispatcher must authenticate with
  Telegram. RLS limits access to administrators, but database backups and admin
  accounts should still be treated as sensitive.
- Market indices, AI sentiment, desk alerts and the market catalogue are still
  local reference data. They will move to the scraper/Gemini jobs in the next
  phase.
- Keep the Supabase project's **Confirm email** setting in mind: accounts made
  from the Admin Panel are pre-confirmed by the Edge Function. Accounts created
  manually in the dashboard need **Auto Confirm User** (or a confirmed email)
  before they can sign in.
- The service role key must never be added to the frontend environment.
