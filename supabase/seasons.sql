-- Monthly seasons with a carry-over soft reset.
--
-- A "season" is one calendar month. At month end the season is CLOSED:
--   * each player's net earnings for the month are REMOVED from their all-time
--     total (a 'reset' event dated in the closing month), and
--   * a fraction (default 30%) of those earnings is FOLDED INTO starting_lr as a
--     permanent head start for the new season.
--
-- Net effect: all-time lr drops from (seed + month_earnings) to
-- (seed + 30% of month_earnings). The 30% is a boost to the BASE rating, NOT a
-- match result — so it raises all-time LR but never appears as "LR earned" in
-- any monthly view. The new month's earned column starts at 0 and fills only
-- from real games.
--
-- No match history is ever deleted. 'match' rows (real games) are untouched;
-- past months still show their true earnings because monthly views count only
-- 'match' rows and ignore the 'reset' bookkeeping row.

-- 1. Tag events. Real matches are the default; 'reset' is season bookkeeping.
alter table lr_events
  add column if not exists kind text not null default 'match';

alter table lr_events
  drop constraint if exists lr_events_kind_chk;
alter table lr_events
  add constraint lr_events_kind_chk check (kind in ('match', 'reset', 'carry'));

create index if not exists lr_events_kind_idx on lr_events (kind);

-- 2. Season registry. `yyyymm` is the month key, e.g. 202607 for July 2026.
create table if not exists seasons (
  yyyymm     integer primary key,           -- YYYYMM
  carry_pct  numeric not null default 0.30, -- fraction folded into starting_lr
  closed_at  timestamptz                    -- null while the season is open
);

-- 3. Close a month.
--    p_yyyymm    — the month to close, as YYYYMM (e.g. 202607 = July 2026)
--    p_carry_pct — fraction of net earnings folded into starting_lr (default .30)
--
--    Idempotent: if the month already has a reset row, it does nothing.
--    Returns the number of players closed and total LR carried into their seed.

-- Drop any earlier signature first. CREATE OR REPLACE only replaces a function
-- with the SAME argument list, so an older 3-arg (dry-run) version would linger
-- and make close_month(integer, numeric) ambiguous. Removing it is safe.
drop function if exists close_month(integer, numeric, boolean);

create or replace function close_month(p_yyyymm integer, p_carry_pct numeric default 0.30)
returns table (players_closed integer, total_carried integer)
language plpgsql as $$
declare
  v_year  int := p_yyyymm / 100;
  v_month int := p_yyyymm % 100;
  v_start timestamptz := make_timestamptz(v_year, v_month, 1, 0, 0, 0, 'UTC');
  v_end   timestamptz := (v_start + interval '1 month');
  v_reset_at timestamptz := v_end - interval '1 second';
begin
  insert into seasons (yyyymm, carry_pct) values (p_yyyymm, p_carry_pct)
    on conflict (yyyymm) do update set carry_pct = excluded.carry_pct;

  -- Guard: already closed (a reset row exists for this month) → no-op.
  if exists (
    select 1 from lr_events
    where kind = 'reset' and created_at >= v_start and created_at < v_end
  ) then
    return query select 0, 0;
    return;
  end if;

  -- Net MATCH earnings per player for the month.
  create temp table _month_earned on commit drop as
  select email, sum(delta)::int as earned
  from lr_events
  where kind = 'match' and created_at >= v_start and created_at < v_end
  group by email;

  -- reset: remove the whole month's earnings from the all-time total. Dated
  -- inside the closing month so it never shows in a later month's view.
  insert into lr_events (run_id, match_id, email, delta, kind, created_at)
  select 'season-' || p_yyyymm, 'reset', email, -earned, 'reset', v_reset_at
  from _month_earned
  where earned <> 0;

  -- carry: fold 30% of POSITIVE earnings into starting_lr (a base-rating boost,
  -- not an event — so it lifts all-time LR without touching any monthly earned).
  update players pl
  set starting_lr = pl.starting_lr + greatest(0, round(me.earned * p_carry_pct))::int
  from _month_earned me
  where pl.email = me.email
    and round(me.earned * p_carry_pct) > 0;

  -- Recompute cached lr = new starting_lr + all events (with the reset applied).
  update players pl
  set lr = pl.starting_lr
         + coalesce((select sum(delta) from lr_events ev where ev.email = pl.email), 0),
      updated_at = now()
  where pl.email in (select email from _month_earned);

  update seasons set closed_at = now() where yyyymm = p_yyyymm;

  return query
    select count(*)::int,
           coalesce(sum(greatest(0, round(earned * p_carry_pct)))::int, 0)
    from _month_earned;
end $$;
