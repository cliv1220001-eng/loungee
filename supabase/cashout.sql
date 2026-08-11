-- Cash-out (withdrawal) — ADMIN-recorded payout.
-- Run this AFTER coins.sql in the Supabase SQL editor. Safe to re-run.
--
-- Model:
--   An admin records a completed payout: they pick the player, the amount, the
--   payout method/account, and attach a proof screenshot (the player's request +
--   proof the admin actually sent the money). In ONE step the coins are debited
--   and the record is marked 'paid'. There is no player-facing request and no
--   separate approval — the admin who records it IS the approver.

-- Allow the cash-out coin_event kind (extends the coins.sql check constraint).
do $$ begin
  alter table coin_events drop constraint if exists coin_events_kind_check;
  alter table coin_events add constraint coin_events_kind_check
    check (kind in ('cashin', 'bet_stake', 'bet_payout', 'adjust', 'cashout'));
end $$;

create table if not exists cashout_requests (
  id           uuid primary key default gen_random_uuid(),
  email        text not null references players(email) on delete cascade,
  ign          text not null,
  amount       integer not null check (amount > 0),
  method       text,                        -- e.g. 'GCash'
  account      text,                        -- payout account number / handle
  proof_path   text,                        -- screenshot in the `cashout-proofs` bucket
  status       text not null default 'paid' check (status in ('paid')),
  note         text,
  reviewed_by  text,                        -- admin who recorded it
  created_at   timestamptz not null default now()
);

create index if not exists cashout_requests_email_idx on cashout_requests (email);
create index if not exists cashout_requests_created_idx on cashout_requests (created_at desc);

-- If the table pre-existed from the old pending/reserve model, reshape it safely.
alter table cashout_requests add column if not exists proof_path text;
do $$ begin
  alter table cashout_requests drop constraint if exists cashout_requests_status_check;
  alter table cashout_requests add constraint cashout_requests_status_check check (status in ('paid'));
exception when others then null; end $$;

-- ---------------------------------------------------------------------------
-- RPC: record a paid cash-out. Debits the coins and files the record in one
-- atomic step. Rejects if the balance is short. Returns the new record id.
-- ---------------------------------------------------------------------------
create or replace function pay_cashout(
  p_email text, p_ign text, p_amount integer,
  p_method text default null, p_account text default null,
  p_proof_path text default null, p_reviewed_by text default null
) returns uuid language plpgsql as $$
declare
  email_l text := lower(p_email);
  bal integer;
  new_id uuid;
begin
  if p_amount <= 0 then
    raise exception 'amount must be positive';
  end if;
  select coins into bal from players where email = email_l;
  if bal is null then
    raise exception 'player not found';
  end if;
  if bal < p_amount then
    raise exception 'insufficient balance: have %, need %', bal, p_amount;
  end if;

  insert into cashout_requests (email, ign, amount, method, account, proof_path, status, reviewed_by)
  values (email_l, p_ign, p_amount, p_method, p_account, p_proof_path, 'paid', p_reviewed_by)
  returning id into new_id;

  insert into coin_events (email, delta, kind, ref, note)
  values (email_l, -p_amount, 'cashout', new_id::text, 'Cash-out paid');

  perform recompute_coins(email_l);
  return new_id;
end $$;

-- Old pending-model RPCs are obsolete; drop them if present.
drop function if exists request_cashout(text, text, integer, text, text);
drop function if exists approve_cashout(uuid, text);
drop function if exists reject_cashout(uuid, text, text);
