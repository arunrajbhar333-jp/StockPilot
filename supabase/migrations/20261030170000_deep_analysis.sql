-- =============================================================================
-- Deep macro & fundamental analysis: the structured half of the analyze-holding
-- response, stored next to the verdict it belongs to.
--
-- ai_breakdown holds the six pillars as JSON:
--   [{"label": "India Macro", "value": "..."}, ...]
--
-- Run in the Supabase SQL editor or `supabase db push`. Idempotent.
-- =============================================================================

alter table public.portfolio
  add column if not exists ai_action text
    check (ai_action in ('BUY', 'HOLD', 'SELL')),
  add column if not exists ai_urgent boolean not null default false,
  add column if not exists ai_timeline text,
  add column if not exists ai_breakdown jsonb;

comment on column public.portfolio.ai_action is
  'Plain BUY / HOLD / SELL instruction derived from the six-pillar analysis.';
comment on column public.portfolio.ai_urgent is
  'True when the analysis says the member should act today (typically a SELL).';
comment on column public.portfolio.ai_timeline is
  'Suggested review horizon, e.g. "3-6 Months". Set for HOLD and BUY calls.';
comment on column public.portfolio.ai_breakdown is
  'Six-pillar JSON breakdown: fundamentals, India macro, crude, global, news, verdict.';

-- Existing rows keep their verdict and gain an action that matches it, so the
-- UI can render the new banner and timeline before the next analysis run.
update public.portfolio
set ai_action = case
  when ai_verdict in ('STRONG BUY', 'BUY') then 'BUY'
  when ai_verdict in ('SELL', 'STRONG SELL') then 'SELL'
  else 'HOLD'
end
where ai_action is null;

update public.portfolio
set ai_urgent = ai_action = 'SELL'
where ai_action is not null and ai_urgent = false and ai_verdict in ('SELL', 'STRONG SELL');

update public.portfolio
set ai_timeline = '3-6 Months'
where ai_action = 'HOLD' and ai_timeline is null;

-- market_catalog gets the same shape: the chat assistant reads both tables.
alter table public.market_catalog
  add column if not exists ai_action text
    check (ai_action in ('BUY', 'HOLD', 'SELL')),
  add column if not exists ai_urgent boolean not null default false,
  add column if not exists ai_timeline text,
  add column if not exists ai_breakdown jsonb;
