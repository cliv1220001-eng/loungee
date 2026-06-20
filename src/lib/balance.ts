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
    // Random order (not sorted by MMR) so teams don't always present strongest-first.
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

/** The five lanes that make up a "proper" Dota team. */
const CORE_ROLES: Role[] = [1, 2, 3, 4, 5];

/** How many of the five core lanes this team is still missing (0 = proper). */
function missingCoreRoles(team: WorkingTeam): number {
  return CORE_ROLES.reduce((n, r) => (countRole(team, r) === 0 ? n + 1 : n), 0);
}

/** The lowest-numbered core lane this team lacks, or null if it already has all five. */
function firstMissingRole(team: WorkingTeam): Role | null {
  return CORE_ROLES.find((r) => countRole(team, r) === 0) ?? null;
}

function place(team: WorkingTeam, player: Player): void {
  team.players.push(player);
  team.totalMmr += player.mmr;
}

/** Teams with room, neediest first (most missing lanes), then lowest running MMR. */
function neediestTeams(teams: WorkingTeam[]): WorkingTeam[] {
  return teams
    .filter((t) => t.players.length < t.capacity)
    .sort((a, b) => missingCoreRoles(b) - missingCoreRoles(a) || a.totalMmr - b.totalMmr);
}

/**
 * Build teams with a complete, proper set of roles, prioritizing the teams that
 * still lack the most lanes.
 *
 * Pass 1 hands each of the five lanes (strongest first) to the teams that don't
 * yet have it, so every team works toward one Carry / Mid / Offlane / Soft / Hard
 * before any team doubles up. Pass 2 spends the leftovers — extra fixed-role
 * players plus "Any" (no preference) players — on the neediest teams; an "Any"
 * player adopts whatever lane its team is still missing so the roster comes out
 * proper. A final pass swaps same-role players to tighten MMR without disturbing
 * the role layout.
 */
export function balanceByRole(players: Player[], numTeams: number): BalanceResult {
  const capacities = teamCapacities(players.length, numTeams);
  const teams: WorkingTeam[] = capacities.map((capacity, i) => ({
    id: i + 1,
    players: [],
    totalMmr: 0,
    capacity,
  }));

  const placed = new Set<string>();

  // Pass 1 — give every team one of each core lane before anyone doubles up.
  for (const role of CORE_ROLES) {
    const queue = players
      .filter((p) => p.role === role && !placed.has(p.id))
      .sort((a, b) => b.mmr - a.mmr);
    for (const team of neediestTeams(teams)) {
      if (countRole(team, role) > 0) continue; // this team already has the lane
      const player = queue.shift();
      if (!player) break; // no more players of this lane to hand out
      place(team, player);
      placed.add(player.id);
    }
  }

  // Pass 2 — leftovers fill remaining seats on the neediest teams. An "Any"
  // player takes on whichever lane its team still lacks so the team comes out proper.
  const leftovers = players.filter((p) => !placed.has(p.id)).sort((a, b) => b.mmr - a.mmr);
  for (const player of leftovers) {
    const team = neediestTeams(teams)[0];
    if (!team) break;
    const filled = player.role === null ? { ...player, role: firstMissingRole(team) } : player;
    place(team, filled);
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

/** Dispatch to the chosen balancing strategy. */
export function generateTeams(
  players: Player[],
  numTeams: number,
  mode: BalanceMode
): BalanceResult {
  switch (mode) {
    case "role":
      return balanceByRole(players, numTeams);
    case "random":
      return randomTeams(players, numTeams);
    case "mmr":
    default:
      return balanceTeams(players, numTeams);
  }
}
