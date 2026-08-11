# Betting system — one-time Supabase setup

Run these in the Supabase **SQL editor** (Dashboard → SQL), in order. Each file is
idempotent (safe to re-run).

## 1. Apply the SQL migrations (in this order)

1. `coins.sql` — coin ledger, cash-in requests, bets, and their RPCs.
   *(Already applied in this project — the tables exist. Re-run only if you edited it.)*
2. `cashout.sql` — cash-out (withdrawal) requests + RPCs. **Not yet applied.**
3. `users.sql` — admin accounts (`users`) + `audit_log`. **Not yet applied.**
4. `users-seed.sql` — seeds the 7 accounts (scrypt password hashes, no plaintext).
   **Not yet applied.** Run this AFTER `users.sql`.

Paste each file's contents into the SQL editor and run it.

## 2. Storage bucket (already created)

The private `cashin-proofs` bucket already exists (created via the API). Nothing
to do. If you ever need to recreate it: Storage → New bucket → name `cashin-proofs`,
**Private**, 5 MB limit, image mime types only.

## 3. Accounts

Seeded by `users-seed.sql`:

| Username  | Role   | Can edit balances directly? |
|-----------|--------|-----------------------------|
| euruuu    | owner  | ✅ (placeholder password — change it) |
| kiela     | owner  | ✅ |
| namnam    | owner  | ✅ |
| tonya     | admin  | ❌ |
| ryla      | admin  | ❌ |
| mimasaur  | admin  | ❌ |
| cliv      | admin  | ❌ |

- **owners** can directly adjust balances (the Adjust button on Balances).
- **admins** can do everything else: approve cash-in/out, place/settle/void bets,
  create tournaments. All actions are recorded in Audit Logs.
- **euruuu** was seeded with a PLACEHOLDER password `changeme-euruuu`. Change it:
  sign in, or reset it by re-running the seed with a new password (ask the dev to
  regenerate the hash — never store plaintext).

To change any password later, regenerate that user's `pw_hash` and update the
`users` row. (The hash format is `scrypt$salt$hash`; see `src/lib/password.ts`.)

## 4. Public pages (no login)

- `/cashin` — players submit a top-up with payment proof (→ pending queue).
- `/cashout` — players request a withdrawal by exact IGN (coins reserved on submit).

Both are deliberately public (allow-listed in `src/proxy.ts`). Everything else stays
behind login.

## Notes

- Coins are a **separate ledger** from LR — betting never touches `lr_events`.
- Balances are always `sum(coin_events.delta)`, recomputed by RPC — never edited blind.
- Cash-out reserves coins immediately; rejecting refunds them.
