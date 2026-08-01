-- Fix the July 2026 season close: it was computed on UTC month boundaries, but
-- the league plays late-night PH time, so games from ~midnight-6am Aug 1 PH
-- (= Jul 31 16:00-22:00 UTC) were wrongly counted as July and reset away.
--
-- This UNDOES the bad close and REDOES it on the PH boundary (Jul 31 16:00 UTC),
-- using the PH-aware close_month(). No match events are deleted or moved — only
-- the season 'reset' rows and the folded 'starting_lr' carry are rebuilt.
--
-- PREREQUISITE: run the updated section 3 of seasons.sql first, so close_month()
-- uses 'Asia/Manila' boundaries. Verify with:
--   SELECT prosrc LIKE '%Asia/Manila%' FROM pg_proc WHERE proname='close_month';
-- (must return true before running this file).

BEGIN;

-- 0. Safety snapshot.
DROP TABLE IF EXISTS players_backup_julyfix;
CREATE TABLE players_backup_julyfix AS SELECT * FROM players;

-- 1. Undo the carry that was folded into starting_lr. The applied carry was
--    max(0, round(utc_july_earned * 0.30)); utc_july_earned == -(reset delta).
WITH undo AS (
  SELECT email,
         greatest(0, round(-sum(delta) * 0.30))::int AS carry
  FROM lr_events
  WHERE kind = 'reset' AND run_id = 'season-202607'
  GROUP BY email
)
UPDATE players p
SET starting_lr = p.starting_lr - u.carry
FROM undo u
WHERE p.email = u.email AND u.carry > 0;

-- 2. Delete the wrong (UTC-based) reset rows.
DELETE FROM lr_events WHERE run_id = 'season-202607';

-- 3. Un-mark the season so close_month will run again (its guard checks for a
--    reset row in the month; we also clear the registry row).
DELETE FROM seasons WHERE yyyymm = 202607;

-- 4. Recompute cached lr for everyone (starting_lr changed; reset rows gone).
UPDATE players pl
SET lr = pl.starting_lr
       + COALESCE((SELECT SUM(delta) FROM lr_events ev WHERE ev.email = pl.email), 0),
    updated_at = now();

-- 5. Re-run the close on the PH boundary. close_month() now windows July as
--    Jul 1 00:00 PH .. Aug 1 00:00 PH (= Jun 30 16:00 UTC .. Jul 31 16:00 UTC),
--    so the Aug-1-PH games stay in August.
SELECT * FROM close_month(202607, 0.30);

-- 6. VERIFY — cached lr must equal starting_lr + all events for everyone.
--    EXPECT 0 ROWS. If any return, run ROLLBACK; instead of COMMIT;
SELECT p.email, p.lr AS cached,
       p.starting_lr + COALESCE((SELECT SUM(delta) FROM lr_events e WHERE e.email = p.email), 0) AS computed
FROM players p
WHERE p.lr <> p.starting_lr
      + COALESCE((SELECT SUM(delta) FROM lr_events e WHERE e.email = p.email), 0);

COMMIT;

-- Rollback (before dropping the backup):
--   DELETE FROM lr_events WHERE run_id = 'season-202607';
--   UPDATE players p SET starting_lr = b.starting_lr, lr = b.lr
--   FROM players_backup_julyfix b WHERE p.email = b.email;
