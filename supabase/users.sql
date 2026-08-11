-- Admin accounts + audit log.
-- Run this in the Supabase SQL editor. Seed the accounts with users-seed.sql
-- (generated separately so password hashes — never plaintext — live there).
--
-- Model:
--   users     — named admin accounts. `pw_hash` is a scrypt hash (see
--               src/lib/password.ts). `role` gates balance editing:
--                 'owner'  → can directly adjust balances (euruuu, kiela, namnam)
--                 'admin'  → everything else (approve cash-in/out, bets, tourneys)
--   audit_log — append-only record of who did what, for accountability.

create table if not exists users (
  username   text primary key,
  pw_hash    text not null,
  role       text not null default 'admin' check (role in ('owner', 'admin')),
  created_at timestamptz not null default now()
);

create table if not exists audit_log (
  id         uuid primary key default gen_random_uuid(),
  actor      text not null,               -- username who did it
  action     text not null,               -- e.g. 'cashin.approve', 'coins.adjust'
  target     text,                        -- affected player email / tournament id / bet id
  detail     jsonb,                       -- action-specific payload (amount, etc.)
  created_at timestamptz not null default now()
);

create index if not exists audit_log_created_idx on audit_log (created_at desc);
create index if not exists audit_log_actor_idx on audit_log (actor);
create index if not exists audit_log_action_idx on audit_log (action);
