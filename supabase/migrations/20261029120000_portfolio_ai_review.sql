-- =============================================================================
-- StockPilot — Phase 3: strong AI verdicts for portfolio holdings
--
-- Run once in the Supabase SQL editor after the Phase 2 schema, or let the CLI
-- apply it with `supabase db push`. Every statement is idempotent, so re-running
-- it is safe. Fresh projects that run the current schema.sql already include
-- these columns and do not need this file.
-- =============================================================================

begin;

-- 1. Allow the two stronger calls alongside BUY / HOLD / SELL.
alter table public.portfolio
  drop constraint if exists portfolio_ai_verdict_check;

alter table public.portfolio
  add constraint portfolio_ai_verdict_check
  check (ai_verdict in ('STRONG BUY', 'BUY', 'HOLD', 'SELL', 'STRONG SELL'));

-- 2. Date of purchase, so the AI can weigh the holding period.
alter table public.portfolio
  add column if not exists purchase_date date;

-- 3. Timestamp of the most recent AI run.
alter table public.portfolio
  add column if not exists last_analyzed_at timestamptz;

-- 4. `reasoning` becomes `ai_reasoning` to match the analysis payload.
do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'portfolio'
      and column_name = 'reasoning'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'portfolio'
      and column_name = 'ai_reasoning'
  ) then
    alter table public.portfolio rename column reasoning to ai_reasoning;
  end if;
end $$;

alter table public.portfolio
  add column if not exists ai_reasoning text;

-- 5. Give already-analysed rows a review timestamp.
update public.portfolio
set last_analyzed_at = coalesce(last_analyzed_at, created_at)
where ai_reasoning is not null
  and last_analyzed_at is null;

commit;
