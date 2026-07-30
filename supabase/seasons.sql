-- Monthly seasons with a carry-over reset.
--
-- A "season" is one calendar month. At month end the season is CLOSED: each
-- player keeps a fraction (default 30%) of that month's net earned LR as a head
-- start for the next month; the rest is wiped from their all-time total.
--
-- Design (no match history is ever deleted):
--   * lr_events.kind distinguishes real matches from bookkeeping rows:
--       'match' — a real game result (the only kind that counts as a win/loss)
--       'reset' — removes a closed month's earnings from the all-time total
--       'carry' — the head start granted into the next month
--   * Closing month M inserts, per player with net earnings `e` that month:
--       reset row: delta = -e            (timestamped in M, so it never shows
--                                         in month M+1's view)
--       carry row: delta = +round(e*pct) (timestamped on the 1st of M+1, so it
--                                         seeds M+1's "earned"), floored at 0
--   * All-time lr = starting_lr + SUM(delta) still holds, and lands at
--     starting_lr + carry once a month is closed.
--
-- Safe to re-run: create statements are idempotent, and close_month() is keyed
-- on (season, kind) so closing the same month twice is a no-op.

-- 1. Tag existing and future events. Real matches are the default.
alter table lr_events
  add column if not exists kind text not null default 'match';

alter table lr_events
  drop constraint if exists lr_events_kind_chk;
alter table lr_events
  add constraint lr_events_kind_chk check (kind in ('match', 'reset', 'carry'));

create index if not exists lr_events_kind_idx on lr_events (kind);

-- 2. Season registry. `yyyymm` is the month key, e.g. 202507 for July 2025.
create table if not exists seasons (
  yyyymm     integer primary key,           -- YYYYMM
  carry_pct  numeric not null default 0.30, -- fraction carried into next month
  closed_at  timestamptz                    -- null while the season is open
);

-- 3. Close a month: fold each player's net earnings into a carry-over.
--    p_yyyymm    — the month to close, as YYYYMM (e.g. 202507)
--    p_carry_pct — fraction to carry over (default 0.30)
--    p_dry_run   — when true, write ONLY the next-month carry rows and DO NOT
--                  write the reset rows or recompute all-time lr. This lets you
--                  preview how next month's leaderboard will look WITHOUT
--                  changing the closing month's live all-time standings. The
--                  preview is tagged run_id 'season-<next>-preview' so it can be
--                  cleared (see the un-preview snippet at the bottom) and the
--                  real close run later.
--
--    Idempotent per mode: re-running does nothing if that mode's rows exist.
create or replace function close_month(
  p_yyyymm integer,
  p_carry_pct numeric default 0.30,
  p_dry_run boolean default false
)
returns table (players_closed integer, total_carried integer)
language plpgsql as $$
declare
  v_year  int := p_yyyymm / 100;
  v_month int := p_yyyymm % 100;
  v_start timestamptz := make_timestamptz(v_year, v_month, 1, 0, 0, 0, 'UTC');
  v_end   timestamptz := (make_timestamptz(v_year, v_month, 1, 0, 0, 0, 'UTC') + interval '1 month');
  -- reset lands at the last instant of the closing month; carry at the first of next.
  v_reset_at timestamptz := v_end - interval '1 second';
  v_carry_at timestamptz := v_end;
  v_next_yyyymm int := (extract(year from v_end)::int) * 100 + extract(month from v_end)::int;
  v_carry_run text := 'season-' || v_next_yyyymm || (case when p_dry_run then '-preview' else '' end);
begin
  if not p_dry_run then
    insert into seasons (yyyymm, carry_pct) values (p_yyyymm, p_carry_pct)
      on conflict (yyyymm) do update set carry_pct = excluded.carry_pct;
  end if;

  -- Guard: this mode's carry rows already exist → no-op.
  if exists (select 1 from lr_events where run_id = v_carry_run) then
    return query select 0, 0;
    return;
  end if;

  -- Net MATCH earnings per player for the month (ignore prior bookkeeping rows).
  create temp table _month_earned on commit drop as
  select email, sum(delta)::int as earned
  from lr_events
  where kind = 'match' and created_at >= v_start and created_at < v_end
  group by email;

  -- reset: remove the whole month's earnings from the all-time total.
  -- Skipped in a dry run so the closing month's live standings are untouched.
  if not p_dry_run then
    insert into lr_events (run_id, match_id, email, delta, kind, created_at)
    select 'season-' || p_yyyymm, 'reset', email, -earned, 'reset', v_reset_at
    from _month_earned
    where earned <> 0;
  end if;

  -- carry: grant 0 .. p_carry_pct of positive earnings into the next month.
  insert into lr_events (run_id, match_id, email, delta, kind, created_at)
  select v_carry_run, 'carry', email,
         greatest(0, round(earned * p_carry_pct))::int, 'carry', v_carry_at
  from _month_earned
  where round(earned * p_carry_pct) > 0;

  -- Recompute cached lr for everyone touched (real close only; a dry run must
  -- not move all-time lr, so the extra carry rows are intentionally left out of
  -- the cached total until the real close runs).
  if not p_dry_run then
    update players pl
    set lr = pl.starting_lr
           + coalesce((select sum(delta) from lr_events ev where ev.email = pl.email), 0),
        updated_at = now()
    where pl.email in (select email from _month_earned);

    update seasons set closed_at = now() where yyyymm = p_yyyymm;
  end if;

  return query
    select count(*)::int,
           coalesce(sum(greatest(0, round(earned * p_carry_pct)))::int, 0)
    from _month_earned;
end $$;
