// LoungeE Rating (LR) — a persistent, per-player ladder rating.
//
// A player's *starting* LR is derived once from their peak MMR (see the merged
// table below). From then on every match played moves it: +40 for a win, −40 for
// a loss, and +60 (instead of +40) for winning the championship match. LR is
// keyed by email in the registry so it survives IGN changes.

export const WIN_LR = 40;
export const LOSS_LR = -40;
/** Winning the championship match is worth this instead of WIN_LR. */
export const CHAMPION_LR = 60;

/**
 * Starting LR from peak MMR — the MERGED scale:
 *   • below 5,600 MMR → the ranked table (bands of 1,000: 800 … 1,300)
 *   • 5,600 MMR and up → the high-MMR table (1,300 … 1,700)
 * Bands are listed high-to-low; the first one the MMR clears wins.
 */
const STARTING_LR_BANDS: { minMmr: number; lr: number }[] = [
  // high-MMR table (governs from 5,600 up)
  { minMmr: 10000, lr: 1700 },
  { minMmr: 8500, lr: 1600 },
  { minMmr: 7500, lr: 1500 },
  { minMmr: 6500, lr: 1400 },
  { minMmr: 5600, lr: 1300 },
  // ranked table (governs below 5,600)
  { minMmr: 5000, lr: 1300 },
  { minMmr: 4000, lr: 1200 },
  { minMmr: 3000, lr: 1100 },
  { minMmr: 2000, lr: 1000 },
  { minMmr: 1000, lr: 900 },
  { minMmr: 0, lr: 800 },
];

/** The LR a player starts with, based on their peak MMR. */
export function startingLr(peakMmr: number): number {
  const mmr = Number.isFinite(peakMmr) ? peakMmr : 0;
  const band = STARTING_LR_BANDS.find((b) => mmr >= b.minMmr);
  return band ? band.lr : 800;
}

/**
 * Rank names map 1:1 onto the starting-LR tiers (Recruit at 800 … Immortal at
 * 1700). Deriving rank from starting LR means it follows the merged MMR→LR scale
 * automatically, so a high-MMR player's rank matches their (high-MMR-table) LR.
 */
const RANK_BY_LR: Record<number, string> = {
  1700: "Immortal",
  1600: "Legend",
  1500: "Grandmaster",
  1400: "Master",
  1300: "Diamond",
  1200: "Platinum",
  1100: "Gold",
  1000: "Silver",
  900: "Bronze",
  800: "Recruit",
};

export function rankOf(peakMmr: number): string {
  return RANK_BY_LR[startingLr(peakMmr)] ?? "Recruit";
}

/** LR change for one match result. `championMatch` upgrades a win to +60. */
export function matchDelta(won: boolean, championMatch: boolean): number {
  if (!won) return LOSS_LR;
  return championMatch ? CHAMPION_LR : WIN_LR;
}
