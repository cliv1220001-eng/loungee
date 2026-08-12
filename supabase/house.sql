-- House ("Admin") account + fees + admin prop bets. Bet Game only.
-- Run AFTER coins.sql in the Supabase SQL editor. Safe to re-run.
--
-- Model:
--   The house is a normal player row with ign 'Admin' / email 'admin@house.local'.
--   It collects fees and is the counterparty for admin prop bets. Its balance is
--   just sum(coin_events) like any player, so everything stays auditable.
--
--   Fees (bet game only):
--     Team bet — a flat HOUSE_FEE per player, TAKEN FROM the stake. A 50 bet debits
--                50: (50-fee) is wagered, `fee` goes to the house. Even money on the
--                wagered part → winner nets +(stake-fee), loser nets -stake.
--     Side bet — 5% of the pot, taken from the WINNER at settle. Winner nets +0.9·S.
--     Admin prop bets — NO fee (user vs house directly).

-- The flat per-player team-bet fee (pesos == coins).
-- (Kept in the RPCs below; documented here for reference.)

create extension if not exists "pgcrypto";

-- Seed the house account. starting_lr uses the existing startingLr(0) band; it
-- never plays, so LR is irrelevant. Idempotent.
insert into players (email, ign, peak_mmr, position, starting_lr, lr, coins)
values ('admin@house.local', 'Admin', 0, null, 0, 0, 0)
on conflict (email) do nothing;

-- Extend coin_event kinds for fees and prop bets.
do $$ begin
  alter table coin_events drop constraint if exists coin_events_kind_check;
  alter table coin_events add constraint coin_events_kind_check
    check (kind in (
      'cashin', 'bet_stake', 'bet_payout', 'adjust', 'cashout',
      'fee', 'prop_stake', 'prop_payout'
    ));
end $$;

-- Per-bet fee (0 for no-fee bets). Lets settle credit the house exactly.
alter table bets add column if not exists fee integer not null default 0;

-- ---------------------------------------------------------------------------
-- Admin prop bets — a wager between one player and the house on a rune event.
--   market: '6min'|'8min'|'10min' (location Top/Bottom, pays 1:1)
--           '12min' (rune type, pays 1:3)
--   pick:   the player's guess (e.g. 'Top' / 'DD')
--   payout_mult: profit multiple on a win (1 or 3)
-- ---------------------------------------------------------------------------
create table if not exists admin_bets (
  id          uuid primary key default gen_random_uuid(),
  run_id      text not null,
  email       text not null references players(email) on delete cascade,
  market      text not null check (market in ('6min','8min','10min','12min')),
  pick        text not null,
  stake       integer not null check (stake > 0),
  payout_mult integer not null,            -- 1 (location) or 3 (rune type)
  status      text not null default 'open' check (status in ('open','won','lost','void')),
  outcome     text,                        -- the actual result, set at settle
  created_at  timestamptz not null default now(),
  settled_at  timestamptz
);
create index if not exists admin_bets_run_idx on admin_bets (run_id);
create index if not exists admin_bets_email_idx on admin_bets (email);

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

-- Place ONE team bet with a flat fee taken from the stake. `p_fee` coins go to
-- the house; (stake - fee) is the wagered amount. Debits the full stake from the
-- player. Rejects if the player can't afford the full stake. Returns bet id.
create or replace function place_team_bet(
  p_run_id text, p_match_id text, p_email text, p_team_id integer,
  p_stake integer, p_fee integer
) returns uuid language plpgsql as $$
declare
  email_l text := lower(p_email);
  bal integer;
  new_id uuid;
begin
  if p_stake <= 0 then raise exception 'stake must be positive'; end if;
  if p_fee < 0 or p_fee >= p_stake then raise exception 'bad fee'; end if;
  select coins into bal from players where email = email_l;
  if bal is null then raise exception 'player % not found', email_l; end if;
  if bal < p_stake then
    raise exception 'insufficient balance: have %, need %', bal, p_stake;
  end if;

  insert into bets (run_id, match_id, email, team_id, stake, kind, fee)
  values (p_run_id, p_match_id, email_l, p_team_id, p_stake, 'game', p_fee)
  returning id into new_id;

  -- Debit the full stake, then send the fee to the house immediately.
  insert into coin_events (email, delta, kind, ref, note)
  values (email_l, -p_stake, 'bet_stake', new_id::text, 'Team bet placed');
  if p_fee > 0 then
    insert into coin_events (email, delta, kind, ref, note)
    values ('admin@house.local', p_fee, 'fee', new_id::text, 'Team bet fee');
    perform recompute_coins('admin@house.local');
  end if;

  perform recompute_coins(email_l);
  return new_id;
end $$;

-- Settle every OPEN bet on a match against the winning team, fee-aware.
--   game/team bets: winner is paid 2*(stake - fee) → net +(stake-fee); loser 0.
--                   (the fee was already taken to the house at placement.)
--   side bets: winner is paid pot - 5% of pot; the 5% goes to the house.
-- Idempotent: only touches open bets. REPLACES the coins.sql settle_match.
create or replace function settle_match(p_run_id text, p_match_id text, p_winning_team_id integer)
returns void language plpgsql as $$
declare
  b bets%rowtype;
  wagered integer;
  win_pay integer;
  side_fee integer;
begin
  for b in
    select * from bets
    where run_id = p_run_id and match_id = p_match_id and status = 'open'
    for update
  loop
    if b.team_id = p_winning_team_id then
      if b.kind = 'side' then
        -- pot = 2*stake; house takes 5% of the pot from the winnings.
        side_fee := floor(b.stake * 2 * 0.05);
        win_pay := b.stake * 2 - side_fee;
        update bets set status = 'won', payout = win_pay, settled_at = now() where id = b.id;
        insert into coin_events (email, delta, kind, ref, note)
        values (b.email, win_pay, 'bet_payout', b.id::text, 'Side bet won');
        if side_fee > 0 then
          insert into coin_events (email, delta, kind, ref, note)
          values ('admin@house.local', side_fee, 'fee', b.id::text, 'Side bet fee (5%)');
          perform recompute_coins('admin@house.local');
        end if;
        perform recompute_coins(b.email);
      else
        -- team/game bet: even money on the fee-adjusted wager.
        wagered := b.stake - b.fee;
        win_pay := wagered * 2;
        update bets set status = 'won', payout = win_pay, settled_at = now() where id = b.id;
        insert into coin_events (email, delta, kind, ref, note)
        values (b.email, win_pay, 'bet_payout', b.id::text, 'Team bet won');
        perform recompute_coins(b.email);
      end if;
    else
      update bets set status = 'lost', payout = 0, settled_at = now() where id = b.id;
      -- stake (incl. fee) already left the player at placement; nothing to refund.
    end if;
  end loop;
end $$;

-- Place an admin prop bet (user vs house). Debits the stake from the player and
-- escrows the house's potential payout is handled at settle. `p_mult` is 1 or 3.
create or replace function place_prop_bet(
  p_run_id text, p_email text, p_market text, p_pick text, p_stake integer, p_mult integer
) returns uuid language plpgsql as $$
declare
  email_l text := lower(p_email);
  bal integer;
  new_id uuid;
begin
  if p_stake <= 0 then raise exception 'stake must be positive'; end if;
  if p_mult not in (1, 3) then raise exception 'bad payout multiple'; end if;
  if p_market not in ('6min','8min','10min','12min') then raise exception 'bad market'; end if;
  select coins into bal from players where email = email_l;
  if bal is null then raise exception 'player % not found', email_l; end if;
  if bal < p_stake then
    raise exception 'insufficient balance: have %, need %', bal, p_stake;
  end if;

  insert into admin_bets (run_id, email, market, pick, stake, payout_mult)
  values (p_run_id, email_l, p_market, p_pick, p_stake, p_mult)
  returning id into new_id;

  -- Debit the stake to the house (the house holds it until settle).
  insert into coin_events (email, delta, kind, ref, note)
  values (email_l, -p_stake, 'prop_stake', new_id::text, 'Prop bet placed');
  insert into coin_events (email, delta, kind, ref, note)
  values ('admin@house.local', p_stake, 'prop_stake', new_id::text, 'Prop bet stake to house');
  perform recompute_coins(email_l);
  perform recompute_coins('admin@house.local');
  return new_id;
end $$;

-- Settle one prop bet with the actual outcome.
--   win  → player gets stake back + stake*mult profit, paid by the house.
--   lose → the house keeps the stake it already holds.
-- Idempotent (only touches an open bet).
create or replace function settle_prop_bet(p_id uuid, p_outcome text)
returns void language plpgsql as $$
declare
  a admin_bets%rowtype;
  pay integer;
begin
  select * into a from admin_bets where id = p_id for update;
  if not found or a.status <> 'open' then return; end if;

  if lower(a.pick) = lower(p_outcome) then
    -- Player wins: return stake + profit (mult*stake), all from the house.
    pay := a.stake + a.stake * a.payout_mult;
    update admin_bets set status = 'won', outcome = p_outcome, settled_at = now() where id = p_id;
    insert into coin_events (email, delta, kind, ref, note)
    values (a.email, pay, 'prop_payout', a.id::text, 'Prop bet won');
    insert into coin_events (email, delta, kind, ref, note)
    values ('admin@house.local', -pay, 'prop_payout', a.id::text, 'Prop bet payout from house');
    perform recompute_coins(a.email);
    perform recompute_coins('admin@house.local');
  else
    update admin_bets set status = 'lost', outcome = p_outcome, settled_at = now() where id = p_id;
    -- house already holds the stake; nothing more to move.
  end if;
end $$;

-- Void a prop bet: refund the player's stake from the house.
create or replace function void_prop_bet(p_id uuid)
returns void language plpgsql as $$
declare a admin_bets%rowtype;
begin
  select * into a from admin_bets where id = p_id for update;
  if not found or a.status <> 'open' then return; end if;
  update admin_bets set status = 'void', settled_at = now() where id = p_id;
  insert into coin_events (email, delta, kind, ref, note)
  values (a.email, a.stake, 'prop_payout', a.id::text, 'Prop bet voided — refunded');
  insert into coin_events (email, delta, kind, ref, note)
  values ('admin@house.local', -a.stake, 'prop_payout', a.id::text, 'Prop refund from house');
  perform recompute_coins(a.email);
  perform recompute_coins('admin@house.local');
end $$;
