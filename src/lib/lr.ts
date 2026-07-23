// LoungeE Rating (LR) — a persistent, per-player ladder rating.
//
// A player's *starting* LR is derived once from their peak MMR (see the merged
// table below). From then on every match played moves it: +40 for a win, −40 for
// a loss, and +60 (instead of +40) for winning the championship match. LR is
// keyed by email in the registry so it survives IGN changes.

export const WIN_LR = 40;
export const LOSS_LR = -40;
/**
 * Winning the championship match of a bracket with MORE THAN TWO teams is worth
 * this instead of WIN_LR. A two-team bracket is a single match, so its "final"
 * is just an ordinary win and pays WIN_LR — there was no field to beat.
 */
export const CHAMPION_LR = 80;

/**
 * Peak MMR → starting LR and rank, on a flat 1,000-MMR grid.
 *
 * Each band carries BOTH its starting LR and its rank name, so the two can never
 * drift apart: rescaling LR is a matter of editing the `lr` column here, and the
 * ranks keep working (they are not keyed by the LR value).
 *
 * Bands are listed high-to-low; the first one the MMR clears wins.
 *
 * NOTE: these values must stay in sync with the seeded `players.starting_lr` in
 * Supabase — see supabase/reseed-lr.sql. Changing them here without re-running
 * that migration leaves newly-registered players on a different scale.
 */
const BANDS: { minMmr: number; lr: number; rank: string }[] = [
  { minMmr: 10000, lr: 5300, rank: "Immortal" },
  { minMmr: 8000, lr: 4600, rank: "Legend" },
  { minMmr: 7000, lr: 3950, rank: "Grandmaster" },
  { minMmr: 6000, lr: 3350, rank: "Master" },
  { minMmr: 5000, lr: 2800, rank: "Diamond" },
  { minMmr: 4000, lr: 2300, rank: "Platinum" },
  { minMmr: 3000, lr: 1850, rank: "Gold" },
  { minMmr: 2000, lr: 1450, rank: "Silver" },
  { minMmr: 1000, lr: 1100, rank: "Bronze" },
  { minMmr: 0, lr: 800, rank: "Recruit" },
];

/** The band a peak MMR falls into (never null — the last band starts at 0). */
function bandOf(peakMmr: number) {
  const mmr = Number.isFinite(peakMmr) ? peakMmr : 0;
  return BANDS.find((b) => mmr >= b.minMmr) ?? BANDS[BANDS.length - 1];
}

/** The LR a player starts with, based on their peak MMR. */
export function startingLr(peakMmr: number): number {
  return bandOf(peakMmr).lr;
}

export function rankOf(peakMmr: number): string {
  return bandOf(peakMmr).rank;
}

/**
 * LR change for one match result.
 *
 * Winning the championship match pays CHAMPION_LR (+80), but ONLY when the
 * bracket had more than two teams. With exactly two teams the whole bracket is
 * one match, so winning it is an ordinary win (+40) — there is no field to
 * outlast. Losses are always LOSS_LR.
 *
 * `teamCount` defaults to a multi-team bracket so existing callers that don't
 * pass it keep the champion bonus.
 */
export function matchDelta(won: boolean, championMatch: boolean, teamCount = 3): number {
  if (!won) return LOSS_LR;
  return championMatch && teamCount > 2 ? CHAMPION_LR : WIN_LR;
}
