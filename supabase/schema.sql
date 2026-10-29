-- =============================================================================
-- StockPilot — Phase 2 schema for Supabase
-- Run this once in the Supabase SQL editor (Project → SQL Editor → New query).
-- Safe to re-run: tables, indexes, functions and policies are idempotent.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Tables
-- -----------------------------------------------------------------------------

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text,
  role text not null default 'user' check (role in ('admin', 'user')),
  permissions jsonb not null default '[]'::jsonb
    check (jsonb_typeof(permissions) = 'array'),
  status text not null default 'active'
    check (status in ('active', 'invited', 'suspended')),
  created_at timestamptz not null default now(),
  last_active_at timestamptz
);

create unique index if not exists profiles_email_key
  on public.profiles (lower(email));

create table if not exists public.ipos (
  id uuid primary key default gen_random_uuid(),
  company_name text not null,
  type text not null check (type in ('SME', 'Mainboard')),
  sector text,
  price_band_low numeric(12, 2),
  price_band_high numeric(12, 2),
  lot_size integer,
  issue_size text,
  gmp numeric(12, 2) not null default 0,
  gmp_pct numeric(6, 2),
  ai_score numeric(4, 1) not null default 0
    check (ai_score >= 0 and ai_score <= 10),
  verdict text not null default 'WATCH'
    check (verdict in ('APPLY', 'WATCH', 'AVOID')),
  subscription numeric(10, 2) not null default 0,
  open_date date,
  close_date date,
  status text not null default 'Upcoming'
    check (status in ('Open', 'Closing today', 'Upcoming')),
  thesis text,
  created_at timestamptz not null default now()
);

create table if not exists public.portfolio (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  stock_name text not null,
  symbol text,
  sector text,
  quantity integer not null default 0 check (quantity >= 0),
  buy_price numeric(14, 2) not null default 0,
  current_price numeric(14, 2) not null default 0,
  ai_verdict text not null default 'HOLD'
    check (ai_verdict in (
      'STRONG BUY', 'BUY', 'HOLD', 'SELL', 'STRONG SELL'
    )),
  ai_reasoning text,
  ai_source text check (ai_source in ('gemini', 'placeholder')),
  confidence integer check (confidence between 0 and 100),
  purchase_date date,
  last_analyzed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists portfolio_user_id_idx
  on public.portfolio (user_id);

-- Realtime filters need the owning columns in the row image.
alter table public.portfolio replica identity full;
alter table public.ipos replica identity full;

create table if not exists public.sips (
  id uuid primary key default gen_random_uuid(),
  fund_name text not null,
  category text,
  cagr numeric(5, 2) not null default 0,
  three_year numeric(5, 2),
  risk text not null default 'Moderate'
    check (risk in ('Low', 'Moderate', 'High')),
  min_sip integer not null default 500,
  aum text,
  ai_verdict text not null default 'WAIT'
    check (ai_verdict in ('START', 'WAIT')),
  reasoning text,
  sparkline numeric[],
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- 2. Helpers
-- -----------------------------------------------------------------------------

-- Every new auth user gets a non-privileged profile. Permissions are assigned
-- by the admin-create-user Edge Function (service role) after creation.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, role, permissions, status)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(
      nullif(new.raw_user_meta_data ->> 'full_name', ''),
      split_part(coalesce(new.email, ''), '@', 1)
    ),
    'user',
    '[]'::jsonb,
    'active'
  )
  on conflict (id) do update
    set email = excluded.email,
        full_name = coalesce(excluded.full_name, public.profiles.full_name);
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Backfill profiles for accounts that existed before this schema was applied.
insert into public.profiles (id, email, full_name, role, permissions, status)
select
  id,
  coalesce(email, ''),
  split_part(coalesce(email, ''), '@', 1),
  'user',
  '[]'::jsonb,
  'active'
from auth.users
on conflict (id) do nothing;

-- Security-definer helpers avoid recursive RLS lookups on profiles.
-- Both treat a suspended profile as having no access at all.
create or replace function public.is_active_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and coalesce(status, 'active') <> 'suspended'
  );
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.profiles
    where id = auth.uid()
      and role = 'admin'
      and coalesce(status, 'active') <> 'suspended'
  );
$$;

-- Only this column is exposed through the RPC; roles cannot be escalated here.
create or replace function public.touch_last_active()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
  set last_active_at = now()
  where id = auth.uid()
    and coalesce(status, 'active') <> 'suspended';
$$;

revoke all on function public.is_admin() from public;
revoke all on function public.is_active_member() from public;
revoke all on function public.touch_last_active() from public;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_active_member() to authenticated;
grant execute on function public.touch_last_active() to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Row Level Security
-- -----------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.ipos enable row level security;
alter table public.portfolio enable row level security;
alter table public.sips enable row level security;

-- Profiles: read your own row so the app can detect a suspension; admins can
-- read and update every profile, but only while their own profile is active.
-- A suspended member sees nothing else in the database.
drop policy if exists "profiles read own or admin" on public.profiles;
create policy "profiles read own or admin"
  on public.profiles for select to authenticated
  using (
    auth.uid() = id
    or (public.is_active_member() and public.is_admin())
  );

drop policy if exists "profiles admin update" on public.profiles;
create policy "profiles admin update"
  on public.profiles for update to authenticated
  using (public.is_active_member() and public.is_admin())
  with check (public.is_active_member() and public.is_admin());

-- IPOs: every active member can read; only active admins can mutate.
drop policy if exists "ipos read authenticated" on public.ipos;
create policy "ipos read authenticated"
  on public.ipos for select to authenticated
  using (public.is_active_member());

drop policy if exists "ipos admin insert" on public.ipos;
create policy "ipos admin insert"
  on public.ipos for insert to authenticated
  with check (public.is_active_member() and public.is_admin());

drop policy if exists "ipos admin update" on public.ipos;
create policy "ipos admin update"
  on public.ipos for update to authenticated
  using (public.is_active_member() and public.is_admin())
  with check (public.is_active_member() and public.is_admin());

drop policy if exists "ipos admin delete" on public.ipos;
create policy "ipos admin delete"
  on public.ipos for delete to authenticated
  using (public.is_active_member() and public.is_admin());

-- Portfolio: strictly the signed-in owner, and only while the profile is active.
drop policy if exists "portfolio read own" on public.portfolio;
create policy "portfolio read own"
  on public.portfolio for select to authenticated
  using (public.is_active_member() and auth.uid() = user_id);

drop policy if exists "portfolio insert own" on public.portfolio;
create policy "portfolio insert own"
  on public.portfolio for insert to authenticated
  with check (public.is_active_member() and auth.uid() = user_id);

drop policy if exists "portfolio update own" on public.portfolio;
create policy "portfolio update own"
  on public.portfolio for update to authenticated
  using (public.is_active_member() and auth.uid() = user_id)
  with check (public.is_active_member() and auth.uid() = user_id);

drop policy if exists "portfolio delete own" on public.portfolio;
create policy "portfolio delete own"
  on public.portfolio for delete to authenticated
  using (public.is_active_member() and auth.uid() = user_id);

-- SIPs: read for every active member; active admins manage writes.
drop policy if exists "sips read authenticated" on public.sips;
create policy "sips read authenticated"
  on public.sips for select to authenticated
  using (public.is_active_member());

drop policy if exists "sips admin insert" on public.sips;
create policy "sips admin insert"
  on public.sips for insert to authenticated
  with check (public.is_active_member() and public.is_admin());

drop policy if exists "sips admin update" on public.sips;
create policy "sips admin update"
  on public.sips for update to authenticated
  using (public.is_active_member() and public.is_admin())
  with check (public.is_active_member() and public.is_admin());

drop policy if exists "sips admin delete" on public.sips;
create policy "sips admin delete"
  on public.sips for delete to authenticated
  using (public.is_active_member() and public.is_admin());

-- -----------------------------------------------------------------------------
-- 4. API privileges (RLS still applies)
-- -----------------------------------------------------------------------------

grant usage on schema public to authenticated;
grant select, update on public.profiles to authenticated;
grant select, insert, update, delete on public.ipos to authenticated;
grant select, insert, update, delete on public.portfolio to authenticated;
grant select, insert, update, delete on public.sips to authenticated;

-- -----------------------------------------------------------------------------
-- 5. Realtime for the IPO tracker and portfolio hooks
-- -----------------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'ipos'
  ) then
    alter publication supabase_realtime add table public.ipos;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'portfolio'
  ) then
    alter publication supabase_realtime add table public.portfolio;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 6. Seed the current issue pipeline (skip if already present)
-- -----------------------------------------------------------------------------

insert into public.ipos (
  id, company_name, type, sector, price_band_low, price_band_high,
  lot_size, issue_size, gmp, gmp_pct, ai_score, verdict, subscription,
  open_date, close_date, status, thesis
) values
  (
    '11111111-1111-4111-8111-111111111101', 'BLS Poly', 'SME', 'Packaging',
    72, 76, 1600, '₹48.2 Cr', 40, 52.6, 8.5, 'APPLY', 14.8,
    '2026-10-28', '2026-10-30', 'Open',
    'GMP of 53% with a 14.8x SME book, and FY26 margins running 240 bps above the SME packaging median.'
  ),
  (
    '11111111-1111-4111-8111-111111111102', 'NexaGrid Energy', 'Mainboard', 'Renewable energy',
    382, 401, 35, '₹1,840 Cr', 112, 27.9, 9.1, 'APPLY', 22.4,
    '2026-10-27', '2026-10-31', 'Open',
    'Order book covers 2.6x FY26 revenue and anchor allocation is dominated by long-only funds. Strongest issue of the cycle.'
  ),
  (
    '11111111-1111-4111-8111-111111111103', 'Vaidya Lifesciences', 'Mainboard', 'Pharma',
    645, 678, 22, '₹1,210 Cr', 64, 9.4, 7.8, 'APPLY', 8.6,
    '2026-10-29', '2026-11-02', 'Upcoming',
    'Priced at 26x FY26 earnings versus 32x for listed CDMO peers, with 18% revenue CAGR over three years.'
  ),
  (
    '11111111-1111-4111-8111-111111111104', 'Kalyani Precision', 'SME', 'Capital goods',
    118, 124, 1000, '₹36.4 Cr', 18, 14.5, 6.4, 'WATCH', 5.2,
    '2026-10-28', '2026-10-30', 'Closing today',
    'Reasonable business, but the entire float is 4.2% of capital and client concentration above 60% caps conviction.'
  ),
  (
    '11111111-1111-4111-8111-111111111105', 'Suryoday Coatings', 'Mainboard', 'Chemicals',
    246, 259, 57, '₹620 Cr', 28, 10.8, 7.0, 'WATCH', 3.9,
    '2026-10-30', '2026-11-03', 'Upcoming',
    'Volume growth is intact but a 31x asking multiple already prices in the next two quarters of margin expansion.'
  ),
  (
    '11111111-1111-4111-8111-111111111106', 'Arka Logistics', 'SME', 'Logistics',
    94, 99, 1200, '₹21.6 Cr', 6, 6.1, 4.2, 'AVOID', 1.4,
    '2026-10-29', '2026-10-31', 'Upcoming',
    'Working-capital cycle stretched to 118 days and promoter stake drops to 42% post-issue. Skip this cycle.'
  )
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 7. Seed the current SIP shortlist
-- -----------------------------------------------------------------------------

insert into public.sips (
  id, fund_name, category, cagr, three_year, risk, min_sip, aum,
  ai_verdict, reasoning, sparkline
) values
  (
    '22222222-2222-4222-8222-222222222201', 'Nifty 50 Index', 'Index · Large cap',
    14.2, 16.8, 'Moderate', 500, '₹18,420 Cr', 'START',
    'Lowest-cost beta with a 10-year CAGR that beat 68% of active large-cap funds.',
    array[100, 104, 103, 109, 108, 114, 118, 117, 124, 129]::numeric[]
  ),
  (
    '22222222-2222-4222-8222-222222222202', 'Parag Parikh Flexi Cap', 'Flexi cap',
    18.6, 21.4, 'Moderate', 1000, '₹92,680 Cr', 'START',
    'Controlled drawdowns and global diversification suit a seven-year-plus horizon.',
    array[100, 102, 106, 105, 112, 116, 121, 119, 127, 134]::numeric[]
  ),
  (
    '22222222-2222-4222-8222-222222222203', 'HDFC Mid-Cap Opportunities', 'Mid cap',
    22.4, 27.1, 'High', 500, '₹78,240 Cr', 'WAIT',
    'Best-in-class compounding, but mid-cap valuations at 34x call for a staggered entry.',
    array[100, 108, 112, 110, 120, 126, 124, 133, 138, 141]::numeric[]
  ),
  (
    '22222222-2222-4222-8222-222222222204', 'ICICI Pru Short Term', 'Short duration debt',
    7.8, 8.2, 'Low', 500, '₹14,120 Cr', 'START',
    'Ballast for equity-heavy portfolios; duration positioning benefits if rates soften.',
    array[100, 100.6, 101.2, 101.6, 102.4, 103, 103.6, 104.4, 105, 105.8]::numeric[]
  )
on conflict (id) do nothing;

-- -----------------------------------------------------------------------------
-- 8. Market indices (scraper-managed)
-- -----------------------------------------------------------------------------
-- Written by scraper/scraper.py with the service role key; readable by active
-- members. No authenticated write policies on purpose.

create table if not exists public.market_indices (
  id text primary key,
  symbol text not null,
  name text not null,
  value numeric(14, 2) not null,
  change numeric(14, 2) not null default 0,
  change_pct numeric(8, 2) not null default 0,
  day_low numeric(14, 2),
  day_high numeric(14, 2),
  spark numeric[],
  updated_at timestamptz not null default now()
);

alter table public.market_indices enable row level security;

drop policy if exists "market_indices read active" on public.market_indices;
create policy "market_indices read active"
  on public.market_indices for select to authenticated
  using (public.is_active_member());

grant select on public.market_indices to authenticated;

-- -----------------------------------------------------------------------------
-- 9. Telegram bots (admin-managed)
-- -----------------------------------------------------------------------------
-- Treat telegram_bot_token as a secret. Row-level security limits every
-- operation on this table to administrators; the dispatcher reads it
-- server-side with the service role key.

create table if not exists public.bots (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 2 and 80),
  telegram_bot_token text not null,
  chat_id text not null,
  created_by uuid default auth.uid()
    references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.bots enable row level security;

drop policy if exists "bots admin read" on public.bots;
create policy "bots admin read"
  on public.bots for select to authenticated
  using (public.is_active_member() and public.is_admin());

drop policy if exists "bots admin insert" on public.bots;
create policy "bots admin insert"
  on public.bots for insert to authenticated
  with check (public.is_active_member() and public.is_admin());

drop policy if exists "bots admin update" on public.bots;
create policy "bots admin update"
  on public.bots for update to authenticated
  using (public.is_active_member() and public.is_admin())
  with check (public.is_active_member() and public.is_admin());

drop policy if exists "bots admin delete" on public.bots;
create policy "bots admin delete"
  on public.bots for delete to authenticated
  using (public.is_active_member() and public.is_admin());

grant select, insert, update, delete on public.bots to authenticated;

-- -----------------------------------------------------------------------------
-- 10. Manual steps after bootstrapping the first account
-- -----------------------------------------------------------------------------
-- 1) Create your own account in Authentication → Users (Auto Confirm User).
-- 2) Promote it to administrator:
--
--    update public.profiles
--    set role = 'admin',
--        permissions = '["ipo", "portfolio", "sip"]'::jsonb
--    where email = 'you@company.com';
--
-- 3) Optional: seed holdings for that account:
--
--    insert into public.portfolio (
--      user_id, stock_name, symbol, sector, quantity,
--      buy_price, current_price, purchase_date,
--      ai_verdict, ai_reasoning, ai_source, confidence, last_analyzed_at
--    )
--    select id, 'Reliance Industries', 'RELIANCE', 'Energy', 40,
--           2410.50, 2688.40, '2026-04-14',
--           'HOLD',
--           'Strong Jio and retail cash flows, but the current price already discounts the next two quarters.',
--           'gemini', 74, now()
--    from public.profiles
--    where email = 'you@company.com';
-- =============================================================================
