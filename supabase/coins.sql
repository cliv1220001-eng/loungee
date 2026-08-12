-- Virtual-coin betting economy (1 coin = ₱1).
-- Run this once in the Supabase SQL editor. Safe to re-run (idempotent DDL).
--
-- Namespaced `coins` to avoid confusion with the "Bet Game" DRAFT mode
-- (src/lib/bet-draft.ts), which is unrelated to wagering.
--
-- Model (mirrors the LR ledger in schema.sql):
--   coin_events     — append-only ledger, one row per balance change. Authoritative.
--   players.coins   — cached balance = sum(coin_events.delta). Recomputed by RPC,
--                     never the source of truth.
--   cashin_requests — public top-up requests (IGN + payment proof) awaiting admin
--                     approval. Nothing credits until approved.
--   bets            — an admin-recorded wager on which team wins a bracket match.
--                     Even-money 1:1: a winning bet pays back stake + equal winnings.

create extension if not exists "pgcrypto"; -- for gen_random_uuid()

-- Cached coin balance on the player registry (source of truth is coin_events).
alter table players add column if not exists coins integer not null default 0;

-- Append-only coin ledger. `kind` explains the delta; `ref` links to the source
-- row (cash-in request id or bet id) so settlement/approval can stay idempotent.
create table if not exists coin_events (
  id         uuid primary key default gen_random_uuid(),
  email      text not null references players(email) on delete cascade,
  delta      integer not null,
  kind       text not null check (kind in ('cashin', 'bet_stake', 'bet_payout', 'adjust')),
  ref        text,                        -- cash-in request id / bet id / null
  note       text,
  created_at timestamptz not null default now()
);

create index if not exists coin_events_email_idx on coin_events (email);
create index if not exists coin_events_ref_idx on coin_events (ref);

-- Public cash-in requests. `email` is null until an admin resolves the IGN to a
-- registered player at approval time.
create table if not exists cashin_requests (
  id          uuid primary key default gen_random_uuid(),
  ign         text not null,
  email       text references players(email) on delete set null,
  amount      integer not null,           -- coins == pesos
  proof_path  text,                        -- path in the `cashin-proofs` bucket
  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  note        text,
  reviewed_at timestamptz,
  reviewed_by text,
  created_at  timestamptz not null default now()
);

create index if not exists cashin_requests_status_idx on cashin_requests (status, created_at);

-- Admin-recorded wagers on a bracket match's winning team.
--   kind = 'game' — the standard per-game bet; stake must be a fixed tier (20/50/100).
--   kind = 'side' — a side bet on the same match winner, but with NO stake limit.
-- Both pay even-money (win → stake back + equal winnings) and both move balances.
create table if not exists bets (
  id         uuid primary key default gen_random_uuid(),
  run_id     text not null,               -- tournament id
  match_id   text not null,               -- e.g. "wb-r0-m0" / "gf"
  email      text not null references players(email) on delete cascade,
  team_id    integer not null,            -- the team this wager backs
  stake      integer not null check (stake > 0),
  kind       text not null default 'game' check (kind in ('game', 'side')),
  status     text not null default 'open' check (status in ('open', 'won', 'lost', 'void')),
  payout     integer not null default 0,  -- total credited back on a win (0 otherwise)
  created_at timestamptz not null default now(),
  settled_at timestamptz
);

-- If the table pre-existed without `kind`, add it (safe to re-run).
alter table bets add column if not exists kind text not null default 'game';
-- Guard the allowed values without failing when the constraint already exists.
do $$ begin
  alter table bets add constraint bets_kind_check check (kind in ('game', 'side'));
exception when duplicate_object then null; end $$;

-- Links the two legs of a matched side bet so the UI can pair them
-- unambiguously (null for solo/game bets). Settlement is per-leg regardless.
alter table bets add column if not exists pair_id uuid;

create index if not exists bets_run_match_idx on bets (run_id, match_id);
create index if not exists bets_email_idx on bets (email);
create index if not exists bets_pair_idx on bets (pair_id);

-- ---------------------------------------------------------------------------
-- RPCs. All mutate coin_events then recompute the affected players' cached
-- balance, so `players.coins` is always exactly sum(coin_events.delta).
-- ---------------------------------------------------------------------------

-- Recompute one player's cached coin balance from the ledger.
create or replace function recompute_coins(p_email text)
returns void language plpgsql as $$
begin
  update players pl
  set coins = coalesce((select sum(delta) from coin_events ev where ev.email = pl.email), 0),
      updated_at = now()
  where pl.email = lower(p_email);
end $$;

-- Approve a cash-in request: link it to `p_email`, credit `amount` coins ONCE
-- (idempotent via ref = request id), and recompute. No-op if already approved.
create or replace function approve_cashin(p_id uuid, p_email text, p_reviewed_by text default null)
returns void language plpgsql as $$
declare
  r cashin_requests%rowtype;
  email_l text := lower(p_email);
begin
  select * into r from cashin_requests where id = p_id for update;
  if not found then
    raise exception 'cash-in request % not found', p_id;
  end if;
  if r.status = 'approved' then
    return; -- already credited; idempotent
  end if;

  update cashin_requests
  set status = 'approved', email = email_l, reviewed_at = now(), reviewed_by = p_reviewed_by
  where id = p_id;

  -- Guard against a double credit even if status was somehow inconsistent.
  if not exists (select 1 from coin_events where kind = 'cashin' and ref = p_id::text) then
    insert into coin_events (email, delta, kind, ref, note)
    values (email_l, r.amount, 'cashin', p_id::text, 'Cash-in approved');
  end if;

  perform recompute_coins(email_l);
end $$;

-- Reject a cash-in request. Credits nothing.
create or replace function reject_cashin(p_id uuid, p_note text default null, p_reviewed_by text default null)
returns void language plpgsql as $$
begin
  update cashin_requests
  set status = 'rejected', note = p_note, reviewed_at = now(), reviewed_by = p_reviewed_by
  where id = p_id and status <> 'approved';
end $$;

-- Manual balance adjustment (corrections). Positive or negative.
create or replace function adjust_coins(p_email text, p_delta integer, p_note text default null)
returns void language plpgsql as $$
declare email_l text := lower(p_email);
begin
  insert into coin_events (email, delta, kind, note)
  values (email_l, p_delta, 'adjust', p_note);
  perform recompute_coins(email_l);
end $$;

-- Place a bet: debit the stake and open the wager. Rejects if the balance is too
-- low. `p_kind` is 'game' (fixed tiers 20/50/100) or 'side' (any amount).
-- Returns the new bet id.
create or replace function place_bet(
  p_run_id text, p_match_id text, p_email text, p_team_id integer, p_stake integer,
  p_kind text default 'game', p_pair_id uuid default null
) returns uuid language plpgsql as $$
declare
  email_l text := lower(p_email);
  kind_l text := coalesce(p_kind, 'game');
  bal integer;
  new_id uuid;
begin
  if kind_l not in ('game', 'side') then
    raise exception 'invalid bet kind %', kind_l;
  end if;
  if p_stake <= 0 then
    raise exception 'stake must be positive';
  end if;
  -- Game bets are restricted to the fixed tiers; side bets have no limit.
  if kind_l = 'game' and p_stake not in (20, 50, 100) then
    raise exception 'game bets must be 20, 50 or 100';
  end if;
  select coins into bal from players where email = email_l;
  if bal is null then
    raise exception 'player % not found', email_l;
  end if;
  if bal < p_stake then
    raise exception 'insufficient balance: have %, need %', bal, p_stake;
  end if;

  insert into bets (run_id, match_id, email, team_id, stake, kind, pair_id)
  values (p_run_id, p_match_id, email_l, p_team_id, p_stake, kind_l, p_pair_id)
  returning id into new_id;

  insert into coin_events (email, delta, kind, ref, note)
  values (email_l, -p_stake, 'bet_stake', new_id::text, 'Bet placed (' || kind_l || ')');

  perform recompute_coins(email_l);
  return new_id;
end $$;

-- Settle every OPEN bet on a match against the winning team. Winners are paid
-- back stake + equal winnings (even-money). Idempotent: only touches open bets.
create or replace function settle_match(p_run_id text, p_match_id text, p_winning_team_id integer)
returns void language plpgsql as $$
declare
  b bets%rowtype;
  win_pay integer;
begin
  for b in
    select * from bets
    where run_id = p_run_id and match_id = p_match_id and status = 'open'
    for update
  loop
    if b.team_id = p_winning_team_id then
      win_pay := b.stake * 2; -- stake back + equal winnings
      update bets set status = 'won', payout = win_pay, settled_at = now() where id = b.id;
      insert into coin_events (email, delta, kind, ref, note)
      values (b.email, win_pay, 'bet_payout', b.id::text, 'Bet won');
      perform recompute_coins(b.email);
    else
      update bets set status = 'lost', payout = 0, settled_at = now() where id = b.id;
      -- stake was already debited when the bet was placed; nothing to refund.
    end if;
  end loop;
end $$;

-- Void a bet: refund the stake and mark it void (only if still open).
create or replace function void_bet(p_id uuid)
returns void language plpgsql as $$
declare b bets%rowtype;
begin
  select * into b from bets where id = p_id for update;
  if not found or b.status <> 'open' then
    return;
  end if;
  update bets set status = 'void', settled_at = now() where id = p_id;
  insert into coin_events (email, delta, kind, ref, note)
  values (b.email, b.stake, 'bet_payout', b.id::text, 'Bet voided — stake refunded');
  perform recompute_coins(b.email);
end $$;
