-- Re-seed players.starting_lr onto the new peak-MMR → LR scale.
--
-- SAFETY: this migration NEVER touches lr_events. All earned/lost LR lives in
-- that table as one row per (match, player); this script only rewrites the
-- SEED (starting_lr) and then recomputes the cached total as
--     lr = starting_lr + SUM(lr_events.delta)
-- so every win and loss is carried over exactly. A player's earned LR
-- (lr - starting_lr) is identical before and after.
--
-- Keep the CASE below in sync with BANDS in src/lib/lr.ts.
--
-- Run the whole file in the Supabase SQL editor. Step 4 must return 0 rows.

BEGIN;

-- 1. Rollback snapshot (drop it once you're happy with the result).
DROP TABLE IF EXISTS players_backup_reseed;
CREATE TABLE players_backup_reseed AS SELECT * FROM players;

-- 2. Record each player's TRUE earned LR (summed from lr_events) before the
--    change, so step 4 can prove every win/loss carried over.
--
--    NOTE: 7 players currently have a cached `lr` that disagrees with their own
--    event history (phantom +-40s, caused by malformed -80 events where two
--    results collapsed into one row). Recomputing from lr_events CORRECTS them,
--    so step 4 compares against the event history -- the authoritative source --
--    rather than the stale cached value.
DROP TABLE IF EXISTS earned_before_reseed;
CREATE TEMP TABLE earned_before_reseed AS
SELECT p.email,
       COALESCE((SELECT SUM(delta) FROM lr_events ev WHERE ev.email = p.email), 0) AS earned
FROM players p;

-- 3. Re-seed starting_lr from peak_mmr, then recompute the cached lr from the
--    UNTOUCHED lr_events history.
UPDATE players SET starting_lr = CASE
  WHEN peak_mmr >= 10000 THEN 5300
  WHEN peak_mmr >=  8000 THEN 4600
  WHEN peak_mmr >=  7000 THEN 3950
  WHEN peak_mmr >=  6000 THEN 3350
  WHEN peak_mmr >=  5000 THEN 2800
  WHEN peak_mmr >=  4000 THEN 2300
  WHEN peak_mmr >=  3000 THEN 1850
  WHEN peak_mmr >=  2000 THEN 1450
  WHEN peak_mmr >=  1000 THEN 1100
  ELSE 800
END;

UPDATE players pl
SET lr = pl.starting_lr
       + COALESCE((SELECT SUM(delta) FROM lr_events ev WHERE ev.email = pl.email), 0),
    updated_at = now();

-- 4. VERIFY — every player's earned LR must equal the sum of their events.
--    EXPECT 0 ROWS. If this returns anything, run ROLLBACK; instead of COMMIT;
SELECT p.email,
       b.earned AS earned_from_events,
       p.lr - p.starting_lr AS earned_after
FROM players p
JOIN earned_before_reseed b ON b.email = p.email
WHERE b.earned IS DISTINCT FROM (p.lr - p.starting_lr);

-- 5. REPORT — the players whose cached lr was corrected by the rebuild.
--    Expect the 7 known drifted rows (James, Merbs, despair, Beks, zhenya,
--    Chsn, Raia). Informational only; their event history is unchanged.
SELECT b.ign, b.lr AS lr_before, p.lr AS lr_after,
       (p.lr - p.starting_lr) - (b.lr - b.starting_lr) AS earned_correction
FROM players p
JOIN players_backup_reseed b ON b.email = p.email
WHERE (p.lr - p.starting_lr) IS DISTINCT FROM (b.lr - b.starting_lr)
ORDER BY b.ign;

COMMIT;

-- Rollback (only if needed, and only before the backup table is dropped):
--   UPDATE players p SET starting_lr = b.starting_lr, lr = b.lr
--   FROM players_backup_reseed b WHERE p.email = b.email;
