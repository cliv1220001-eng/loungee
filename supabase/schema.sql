-- LoungeE Rating (LR) storage.
-- Run this once in the Supabase SQL editor (or via the CLI). Safe to re-run.
--
-- Model:
--   players    — the registry, keyed by email (source of truth). IGN/MMR/position
--                are display fields that can change; `starting_lr` is set once and
--                `lr` is the cached current rating = starting_lr + sum of events.
--   lr_events  — one row per (bracket run, match, player). Each bracket run is
--                fully re-synced on every match pick, so LR always reflects the
--                current bracket state (undo/reshuffle safe).

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

create table if not exists players (
  email       text primary key,
  ign         text not null default '',
  peak_mmr    integer not null default 0,
  position    smallint,                 -- 1..5, or null for "Any"
  starting_lr integer not null,         -- set once, from peak MMR at first registration
  lr          integer not null,         -- cached: starting_lr + sum(lr_events.delta)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists lr_events (
  id         uuid primary key default gen_random_uuid(),
  run_id     text not null,
  match_id   text not null,
  email      text not null references players(email) on delete cascade,
  delta      integer not null,
  created_at timestamptz not null default now(),
  unique (run_id, match_id, email)
);

create index if not exists lr_events_email_idx on lr_events (email);
create index if not exists lr_events_run_idx on lr_events (run_id);

-- Register/refresh players. Keeps starting_lr immutable once set; bumps peak_mmr
-- to the max seen; refreshes ign/position; recomputes cached lr.
create or replace function register_players(p_players jsonb)
returns void language plpgsql as $$
begin
  insert into players (email, ign, peak_mmr, position, starting_lr, lr)
  select
    lower(p->>'email'),
    coalesce(p->>'ign', ''),
    coalesce((p->>'mmr')::int, 0),
    nullif(p->>'position', '')::smallint,
    coalesce((p->>'starting_lr')::int, 0),
    coalesce((p->>'starting_lr')::int, 0)
  from jsonb_array_elements(p_players) p
  where coalesce(p->>'email', '') <> ''
  on conflict (email) do update
    set ign      = excluded.ign,
        peak_mmr = greatest(players.peak_mmr, excluded.peak_mmr),
        position = excluded.position,
        updated_at = now();

  update players pl
  set lr = pl.starting_lr
         + coalesce((select sum(delta) from lr_events ev where ev.email = pl.email), 0),
      updated_at = now()
  where pl.email in (
    select lower(p->>'email') from jsonb_array_elements(p_players) p
    where coalesce(p->>'email', '') <> ''
  );
end $$;

-- Full-replace one bracket run's LR events, then recompute cached LR for everyone
-- whose events changed. Registers any not-yet-seen players first (FK safety).
create or replace function sync_run_lr(p_run_id text, p_players jsonb, p_events jsonb)
returns void language plpgsql as $$
declare
  affected text[];
begin
  perform register_players(p_players);

  select array_agg(distinct email) into affected from (
    select email from lr_events where run_id = p_run_id
    union
    select lower(e->>'email') from jsonb_array_elements(p_events) e
  ) s;

  delete from lr_events where run_id = p_run_id;

  insert into lr_events (run_id, match_id, email, delta)
  select p_run_id, e->>'match_id', lower(e->>'email'), (e->>'delta')::int
  from jsonb_array_elements(p_events) e
  where coalesce(e->>'email', '') <> '';

  update players pl
  set lr = pl.starting_lr
         + coalesce((select sum(delta) from lr_events ev where ev.email = pl.email), 0),
      updated_at = now()
  where pl.email = any(coalesce(affected, array[]::text[]));
end $$;
