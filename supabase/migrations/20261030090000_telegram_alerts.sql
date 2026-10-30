-- =============================================================================
-- Smart notifications: alert bookkeeping columns + the market catalogue the
-- "new buy" alert reads from.
--
-- Run in the Supabase SQL editor, or `supabase db push`. Safe to re-run:
-- every statement below is idempotent.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. ipos — one-shot flags so each IPO alert fires exactly once
-- -----------------------------------------------------------------------------
-- lot_size already ships with the baseline schema; the guard keeps older
-- projects that created the table before it existed in step.
alter table public.ipos
  add column if not exists lot_size integer;

alter table public.ipos
  add column if not exists notified_1day boolean not null default false;

alter table public.ipos
  add column if not exists notified_10min boolean not null default false;

comment on column public.ipos.notified_1day is
  'True once the T-1 (day before opening) Telegram alert has been delivered.';
comment on column public.ipos.notified_10min is
  'True once the T-10 minute (09:50-09:59 IST) Telegram alert has been delivered.';

-- -----------------------------------------------------------------------------
-- 2. portfolio — the last verdict the alert stream reported to the member
-- -----------------------------------------------------------------------------
-- Alerts only go out when ai_verdict moves away from this value, which is what
-- stops the 1.5% price trigger from re-messaging the same call every run.
alter table public.portfolio
  add column if not exists last_ai_verdict text;

comment on column public.portfolio.last_ai_verdict is
  'Verdict most recently delivered to the member. A mismatch with ai_verdict means a new alert is due.';

-- Existing holdings start aligned with their current verdict: history becomes
-- the baseline instead of firing a burst of "changed" alerts on the first run.
update public.portfolio
set last_ai_verdict = ai_verdict
where last_ai_verdict is null;

-- -----------------------------------------------------------------------------
-- 3. profiles — where a member wants their Telegram messages
-- -----------------------------------------------------------------------------
alter table public.profiles
  add column if not exists telegram_chat_id text;

comment on column public.profiles.telegram_chat_id is
  'Optional Telegram chat id for this member. Falls back to the bot default chat.';

-- -----------------------------------------------------------------------------
-- 4. market_catalog — priced universe behind the "New Buy Opportunity" alert
-- -----------------------------------------------------------------------------
create table if not exists public.market_catalog (
  id uuid primary key default gen_random_uuid(),
  symbol text not null unique,
  stock_name text not null,
  sector text,
  current_price numeric(14, 2) not null default 0,
  ai_verdict text check (ai_verdict in (
    'STRONG BUY', 'BUY', 'HOLD', 'SELL', 'STRONG SELL'
  )),
  ai_reasoning text,
  ai_source text check (ai_source in ('gemini', 'placeholder')),
  confidence integer check (confidence between 0 and 100),
  last_analyzed_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.market_catalog is
  'Tracked NSE universe refreshed by the market scraper. Verdicts come from analyze-holding in stockId mode.';

alter table public.market_catalog enable row level security;

drop policy if exists "market_catalog read active" on public.market_catalog;
create policy "market_catalog read active"
  on public.market_catalog for select to authenticated
  using (public.is_active_member());

grant select on public.market_catalog to authenticated;

-- Starter universe (NSE large caps). current_price is 0 until the first quote
-- lands, and ai_verdict stays null until analyze-holding scores the row, so no
-- alert can be produced from seed data alone.
insert into public.market_catalog (symbol, stock_name, sector)
values
  ('HDFCBANK', 'HDFC Bank', 'Financials'),
  ('ICICIBANK', 'ICICI Bank', 'Financials'),
  ('RELIANCE', 'Reliance Industries', 'Energy'),
  ('BHARTIARTL', 'Bharti Airtel', 'Telecom'),
  ('HAL', 'Hindustan Aeronautics', 'Defence'),
  ('SUNPHARMA', 'Sun Pharmaceutical', 'Pharma'),
  ('TITAN', 'Titan Company', 'Consumer'),
  ('INFY', 'Infosys', 'Information technology'),
  ('LT', 'Larsen & Toubro', 'Capital goods'),
  ('DIXON', 'Dixon Technologies', 'Electronics'),
  ('TCS', 'Tata Consultancy Services', 'Information technology'),
  ('TATASTEEL', 'Tata Steel', 'Metals'),
  ('MARUTI', 'Maruti Suzuki', 'Automobile'),
  ('ASIANPAINT', 'Asian Paints', 'Consumer'),
  ('TATAMOTORS', 'Tata Motors', 'Automobile')
on conflict (symbol) do nothing;
