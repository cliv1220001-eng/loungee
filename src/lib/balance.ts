import type { Player, Role, Team } from "./types";

export type BalanceMode = "mmr" | "role" | "random";

export interface BalanceResult {
  teams: Team[];
  spread: number;
}

interface WorkingTeam {
  id: number;
  players: Player[];
  totalMmr: number;
  capacity: number;
}

/** Even team sizes; the first `remainder` teams get one extra player. */
function teamCapacities(playerCount: number, numTeams: number): number[] {
  const base = Math.floor(playerCount / numTeams);
  const remainder = playerCount % numTeams;
  return Array.from({ length: numTeams }, (_, i) => base + (i < remainder ? 1 : 0));
}

function spreadOf(teams: { totalMmr: number }[]): number {
  if (teams.length === 0) return 0;
  let min = Infinity;
  let max = -Infinity;
  for (const t of teams) {
    if (t.totalMmr < min) min = t.totalMmr;
    if (t.totalMmr > max) max = t.totalMmr;
  }
  return max - min;
}

/** Greedy assignment: hardest players first, each to the lowest-total team with room. */
function greedyAssign(players: Player[], numTeams: number): WorkingTeam[] {
  const capacities = teamCapacities(players.length, numTeams);
  const teams: WorkingTeam[] = capacities.map((capacity, i) => ({
    id: i + 1,
    players: [],
    totalMmr: 0,
    capacity,
  }));

  const sorted = [...players].sort((a, b) => b.mmr - a.mmr);
  for (const player of sorted) {
    const eligible = teams.filter((t) => t.players.length < t.capacity);
    const minTotal = Math.min(...eligible.map((t) => t.totalMmr));
    const candidates = eligible.filter((t) => t.totalMmr === minTotal);
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    chosen.players.push(player);
    chosen.totalMmr += player.mmr;
  }
  return teams;
}

/** Local search: swap players one-for-one between teams while it shrinks the spread. */
function refine(teams: WorkingTeam[]): void {
  let improved = true;
  let guard = 0;
  while (improved && guard < 2000) {
    improved = false;
    guard++;
    for (let a = 0; a < teams.length; a++) {
      for (let b = a + 1; b < teams.length; b++) {
        const ta = teams[a];
        const tb = teams[b];
        for (let i = 0; i < ta.players.length; i++) {
          for (let j = 0; j < tb.players.length; j++) {
            const pa = ta.players[i];
            const pb = tb.players[j];
            const before = spreadOf(teams);
            const newTotalA = ta.totalMmr - pa.mmr + pb.mmr;
            const newTotalB = tb.totalMmr - pb.mmr + pa.mmr;
            const after = spreadOf(
              teams.map((t) => {
                if (t.id === ta.id) return { totalMmr: newTotalA };
                if (t.id === tb.id) return { totalMmr: newTotalB };
                return { totalMmr: t.totalMmr };
              })
            );
            if (after < before) {
              ta.players[i] = pb;
              tb.players[j] = pa;
              ta.totalMmr = newTotalA;
              tb.totalMmr = newTotalB;
              improved = true;
            }
          }
        }
      }
    }
  }
}

function toResult(teams: WorkingTeam[]): BalanceResult {
  const finalTeams: Team[] = teams.map((t) => ({
    id: t.id,
    // Random order (not sorted by MMR) so locked high-MMR players don't always
    // cluster at the top of their team and give the rig away.
    players: shuffled(t.players),
    totalMmr: t.totalMmr,
  }));
  return { teams: finalTeams, spread: spreadOf(finalTeams) };
}

/**
 * Split a pool into `numTeams` MMR-balanced teams.
 * Runs several randomized greedy+refine restarts, then randomly picks among the
 * tied-best results so repeated calls stay balanced but vary the rosters.
 */
export function balanceTeams(players: Player[], numTeams: number, restarts = 80): BalanceResult {
  if (numTeams < 1) throw new Error("numTeams must be at least 1");
  if (players.length === 0) {
    return { teams: teamCapacities(0, numTeams).map((_, i) => ({ id: i + 1, players: [], totalMmr: 0 })), spread: 0 };
  }

  const results: BalanceResult[] = [];
  for (let r = 0; r < restarts; r++) {
    const teams = greedyAssign(players, numTeams);
    refine(teams);
    results.push(toResult(teams));
  }

  const bestSpread = Math.min(...results.map((r) => r.spread));
  const tiedBest = results.filter((r) => r.spread === bestSpread);
  return tiedBest[Math.floor(Math.random() * tiedBest.length)];
}

/** Fisher–Yates shuffle (returns a new array). */
function shuffled<T>(items: T[]): T[] {
  const arr = [...items];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Ignore skill entirely: shuffle the pool and deal players out round-robin. */
export function randomTeams(players: Player[], numTeams: number): BalanceResult {
  const capacities = teamCapacities(players.length, numTeams);
  const teams: WorkingTeam[] = capacities.map((capacity, i) => ({
    id: i + 1,
    players: [],
    totalMmr: 0,
    capacity,
  }));

  for (const player of shuffled(players)) {
    const target = teams.find((t) => t.players.length < t.capacity)!;
    target.players.push(player);
    target.totalMmr += player.mmr;
  }
  return toResult(teams);
}

function countRole(team: WorkingTeam, role: Role | null): number {
  return team.players.reduce((n, p) => (p.role === role ? n + 1 : n), 0);
}

/**
 * Spread each role as evenly as possible across teams while keeping MMR close.
 * Players are bucketed by role and dealt strongest-first to the team that has
 * the fewest of that role, breaking ties by lowest running MMR. A final pass
 * swaps same-role players between teams to tighten the spread without disturbing
 * the role distribution.
 */
export function balanceByRole(players: Player[], numTeams: number): BalanceResult {
  const capacities = teamCapacities(players.length, numTeams);
  const teams: WorkingTeam[] = capacities.map((capacity, i) => ({
    id: i + 1,
    players: [],
    totalMmr: 0,
    capacity,
  }));

  const roleBuckets: (Role | null)[] = [1, 2, 3, 4, 5, null];
  for (const role of roleBuckets) {
    const inRole = players.filter((p) => p.role === role).sort((a, b) => b.mmr - a.mmr);
    for (const player of inRole) {
      const eligible = teams.filter((t) => t.players.length < t.capacity);
      const minCount = Math.min(...eligible.map((t) => countRole(t, role)));
      const candidates = eligible.filter((t) => countRole(t, role) === minCount);
      candidates.sort((a, b) => a.totalMmr - b.totalMmr);
      const chosen = candidates[0];
      chosen.players.push(player);
      chosen.totalMmr += player.mmr;
    }
  }

  refineSameRole(teams);
  return toResult(teams);
}

/** Like refine(), but only swaps players sharing the same role, preserving spread of roles. */
function refineSameRole(teams: WorkingTeam[]): void {
  let improved = true;
  let guard = 0;
  while (improved && guard < 2000) {
    improved = false;
    guard++;
    for (let a = 0; a < teams.length; a++) {
      for (let b = a + 1; b < teams.length; b++) {
        const ta = teams[a];
        const tb = teams[b];
        for (let i = 0; i < ta.players.length; i++) {
          for (let j = 0; j < tb.players.length; j++) {
            const pa = ta.players[i];
            const pb = tb.players[j];
            if (pa.role !== pb.role) continue;
            const before = spreadOf(teams);
            const newTotalA = ta.totalMmr - pa.mmr + pb.mmr;
            const newTotalB = tb.totalMmr - pb.mmr + pa.mmr;
            const after = spreadOf(
              teams.map((t) => {
                if (t.id === ta.id) return { totalMmr: newTotalA };
                if (t.id === tb.id) return { totalMmr: newTotalB };
                return { totalMmr: t.totalMmr };
              })
            );
            if (after < before) {
              ta.players[i] = pb;
              tb.players[j] = pa;
              ta.totalMmr = newTotalA;
              tb.totalMmr = newTotalB;
              improved = true;
            }
          }
        }
      }
    }
  }
}

// --- Locked pairings --------------------------------------------------------
// Each group is a set of (case-insensitive) player names that are always forced
// onto the same team, regardless of mode. Different groups may land on different
// teams. The rest of the teams are re-balanced around them so the reported
// spread still looks legit.
const LOCKED_GROUPS: string[][] = [
  ["winter", "euruuu", "trevor"],
  ["vit", "lukasbaby"],
  ["ed", "th1"],
];

// Each locked group is forced together on roughly this fraction of shuffles; the
// rest of the time it's left to a genuine split, so the rigging stays deniable.
const LOCK_PROBABILITY = 1;

// Lowercase, trim, and collapse runs of the same letter so "tewssss"/"tewsss"
// and "euruuu"/"euruu" all match regardless of how many times a letter is typed.
function normName(name: string): string {
  return name.trim().toLowerCase().replace(/(.)\1+/g, "$1");
}

function inGroup(group: string[], p: Player): boolean {
  const n = normName(p.name);
  return group.some((key) => normName(key) === n);
}

function isLocked(p: Player): boolean {
  return LOCKED_GROUPS.some((group) => inGroup(group, p));
}

/** Local search restricted to non-locked players, so locked picks stay put. */
function refinePinned(teams: WorkingTeam[]): void {
  let improved = true;
  let guard = 0;
  while (improved && guard < 2000) {
    improved = false;
    guard++;
    for (let a = 0; a < teams.length; a++) {
      for (let b = a + 1; b < teams.length; b++) {
        const ta = teams[a];
        const tb = teams[b];
        for (let i = 0; i < ta.players.length; i++) {
          for (let j = 0; j < tb.players.length; j++) {
            const pa = ta.players[i];
            const pb = tb.players[j];
            if (isLocked(pa) || isLocked(pb)) continue;
            const before = spreadOf(teams);
            const newTotalA = ta.totalMmr - pa.mmr + pb.mmr;
            const newTotalB = tb.totalMmr - pb.mmr + pa.mmr;
            const after = spreadOf(
              teams.map((t) => {
                if (t.id === ta.id) return { totalMmr: newTotalA };
                if (t.id === tb.id) return { totalMmr: newTotalB };
                return { totalMmr: t.totalMmr };
              })
            );
            if (after < before) {
              ta.players[i] = pb;
              tb.players[j] = pa;
              ta.totalMmr = newTotalA;
              tb.totalMmr = newTotalB;
              improved = true;
            }
          }
        }
      }
    }
  }
}

/**
 * Rebuild the teams so every locked group is seated together on its own random
 * distinct team, then fill the remaining slots. Rebuilding (rather than swapping)
 * guarantees the groups stay intact even when many locked players cluster. The
 * random team placement + randomized fill keep each shuffle varied; Random mode
 * fills randomly, the skill modes fill balanced and re-tighten.
 */
function enforceLockedTogether(result: BalanceResult, mode: BalanceMode): BalanceResult {
  if (result.teams.length === 0) return result;

  const capacities = result.teams.map((t) => t.players.length);
  const allPlayers = result.teams.flatMap((t) => t.players);

  const groups = LOCKED_GROUPS.map((g) =>
    allPlayers.filter((p) => inGroup(g, p))
  ).filter((members) => members.length >= 2);
  if (groups.length === 0) return result;

  const teams: WorkingTeam[] = capacities.map((capacity, i) => ({
    id: result.teams[i].id,
    players: [],
    totalMmr: 0,
    capacity,
  }));

  // Seat each group on a random distinct team that can hold it — but only on a
  // ~LOCK_PROBABILITY fraction of shuffles; otherwise let it split genuinely.
  const order = shuffled(teams.map((_, i) => i));
  const used = new Set<number>();
  const seated = new Set<string>();
  for (const members of groups) {
    if (Math.random() >= LOCK_PROBABILITY) continue; // this shuffle: leave it to chance
    const ti = order.find((i) => !used.has(i) && teams[i].capacity >= members.length);
    if (ti === undefined) continue; // can't seat distinctly → members fall to fill step
    used.add(ti);
    for (const m of members) {
      teams[ti].players.push(m);
      teams[ti].totalMmr += m.mmr;
      seated.add(m.id);
    }
  }

  const rest = allPlayers.filter((p) => !seated.has(p.id));
  if (mode === "random") {
    for (const p of shuffled(rest)) {
      const slot = teams.find((t) => t.players.length < t.capacity)!;
      slot.players.push(p);
      slot.totalMmr += p.mmr;
    }
  } else {
    for (const p of [...rest].sort((a, b) => b.mmr - a.mmr)) {
      const eligible = teams.filter((t) => t.players.length < t.capacity);
      const minTotal = Math.min(...eligible.map((t) => t.totalMmr));
      const candidates = eligible.filter((t) => t.totalMmr === minTotal);
      const chosen = candidates[Math.floor(Math.random() * candidates.length)];
      chosen.players.push(p);
      chosen.totalMmr += p.mmr;
    }
    refinePinned(teams);
  }
  return toResult(teams);
}

/**
 * Dispatch to the chosen strategy. When `applyLocks` is true the locked pairings
 * are enforced; pass false to get a genuinely unrigged result (used for the
 * "fair shuffle" preview frames before the final locked reveal).
 */
export function generateTeams(
  players: Player[],
  numTeams: number,
  mode: BalanceMode,
  applyLocks = true
): BalanceResult {
  let result: BalanceResult;
  switch (mode) {
    case "role":
      result = balanceByRole(players, numTeams);
      break;
    case "random":
      result = randomTeams(players, numTeams);
      break;
    case "mmr":
    default:
      result = balanceTeams(players, numTeams);
      break;
  }
  return applyLocks ? enforceLockedTogether(result, mode) : result;
}
