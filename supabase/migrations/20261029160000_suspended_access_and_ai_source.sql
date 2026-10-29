-- =============================================================================
-- StockPilot — Suspended access lockdown + AI source marker
--
-- Run once in the Supabase SQL editor after the portfolio AI migration, or let
-- the CLI apply it with `supabase db push`. Idempotent: safe to re-run.
--
-- 1. A profile with status = 'suspended' is denied on every table.
--    The only row it can still read is its own profile, which the app needs to
--    detect the suspension and sign the user out immediately.
-- 2. public.is_admin() now returns false for suspended admins.
-- 3. portfolio.ai_source records whether the verdict came from Gemini or from
--    the deterministic placeholder, so the UI can label it honestly.
-- =============================================================================

begin;

-- -----------------------------------------------------------------------------
-- 1. AI source marker
-- -----------------------------------------------------------------------------

alter table public.portfolio
  add column if not exists ai_source text;

alter table public.portfolio
  drop constraint if exists portfolio_ai_source_check;

alter table public.portfolio
  add constraint portfolio_ai_source_check
  check (ai_source in ('gemini', 'placeholder'));

-- Backfill rows written before the marker existed.
update public.portfolio
set ai_source = case
  when ai_reasoning ilike '%placeholder%' or ai_reasoning ilike '%gemini was unreachable%'
    then 'placeholder'
  else 'gemini'
end
where ai_source is null
  and ai_reasoning is not null;

-- -----------------------------------------------------------------------------
-- 2. Status-aware helpers
-- -----------------------------------------------------------------------------

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

revoke all on function public.is_active_member() from public;
revoke all on function public.is_admin() from public;
revoke all on function public.touch_last_active() from public;
grant execute on function public.is_active_member() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.touch_last_active() to authenticated;

-- -----------------------------------------------------------------------------
-- 3. Policies: every table requires an active profile
-- -----------------------------------------------------------------------------

-- Profiles: own row is always readable so the client can detect a suspension.
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

-- IPOs
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

-- Portfolio
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

-- SIPs
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

-- Telegram bots
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

commit;
