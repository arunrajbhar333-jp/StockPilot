-- =============================================================================
-- StockPilot — Market indices snapshot for the Python scraper
--
-- Run after the suspended-access migration. Idempotent.
--
-- The scraper writes this table with the service role key; signed-in active
-- members can read it. There are deliberately no insert/update/delete policies
-- for authenticated users: the table is a server-managed feed.
-- =============================================================================

begin;

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

-- Realtime is ready for when the Dashboard switch to this feed lands.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'market_indices'
  ) then
    alter publication supabase_realtime add table public.market_indices;
  end if;
end $$;

commit;
