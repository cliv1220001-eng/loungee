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

/**
 * Forced groups, keyed by player name (case-insensitive). When a group is
 * applied, its members are pinned to the same team for that shuffle.
 * Edit this list to configure which players get grouped.
 */
const FORCED_GROUPS: string[][] = [
  ["euruuu", "mona"],
  ["vit", "Lukasbaby"],
];

/** Fraction of shuffles in which each forced group is actually applied (0–1). */
const FORCE_PROBABILITY = 1;

/**
 * Tag the named players of each forced group with a shared lockGroup so the
 * balancer keeps them together — but only for a `FORCE_PROBABILITY` share of
 * calls, so the rest come out as ordinary balanced teams.
 */
function applyForcedGroups(players: Player[]): Player[] {
  if (FORCED_GROUPS.length === 0) return players;
  const tags = new Map<string, string>();
  FORCED_GROUPS.forEach((names, i) => {
    if (Math.random() >= FORCE_PROBABILITY) return; // skip this group this time
    for (const name of names) tags.set(name.trim().toLowerCase(), `forced-${i}`);
  });
  if (tags.size === 0) return players;
  return players.map((p) => {
    const tag = tags.get(p.name.trim().toLowerCase());
    return tag ? { ...p, lockGroup: tag } : p;
  });
}

/** A single player, or a set of locked-together players, placed as one atomic block. */
interface Unit {
  members: Player[];
  mmr: number;
  size: number;
}

/** Bundle locked-together players into atomic units; everyone else is a unit of one. */
function buildUnits(players: Player[]): Unit[] {
  const groups = new Map<string, Player[]>();
  const units: Unit[] = [];
  for (const p of players) {
    if (p.lockGroup) {
      const g = groups.get(p.lockGroup);
      if (g) g.push(p);
      else groups.set(p.lockGroup, [p]);
    } else {
      units.push({ members: [p], mmr: p.mmr, size: 1 });
    }
  }
  for (const members of groups.values()) {
    units.push({
      members,
      mmr: members.reduce((s, p) => s + p.mmr, 0),
      size: members.length,
    });
  }
  return units;
}

function freeSeats(team: WorkingTeam): number {
  return team.capacity - team.players.length;
}

function placeUnit(team: WorkingTeam, unit: Unit): void {
  for (const p of unit.members) team.players.push(p);
  team.totalMmr += unit.mmr;
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

  // Hardest units first; larger (locked) units before singles so they secure
  // their seats while teams still have room. With no locks every unit is size 1,
  // so this collapses to the original hardest-player-first ordering.
  const units = buildUnits(players).sort((a, b) => b.size - a.size || b.mmr - a.mmr);
  for (const unit of units) {
    const eligible = teams.filter((t) => freeSeats(t) >= unit.size);
    const pool = eligible.length > 0 ? eligible : teams; // fallback, shouldn't happen
    const minTotal = Math.min(...pool.map((t) => t.totalMmr));
    const candidates = pool.filter((t) => t.totalMmr === minTotal);
    const chosen = candidates[Math.floor(Math.random() * candidates.length)];
    placeUnit(chosen, unit);
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
            // Never move a locked player — that would split it from its group.
            if (pa.lockGroup || pb.lockGroup) continue;
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

  // Bigger (locked) units first so they grab seats before space fragments,
  // then drop each into a random team that still has room.
  const units = shuffled(buildUnits(players)).sort((a, b) => b.size - a.size);
  for (const unit of units) {
    const eligible = teams.filter((t) => freeSeats(t) >= unit.size);
    const pool = eligible.length > 0 ? eligible : teams;
    const target = pool[Math.floor(Math.random() * pool.length)];
    placeUnit(target, unit);
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

  // Pre-pass — keep locked groups intact: drop each group whole onto the
  // neediest team with room, resolving any "Any" members to a missing lane.
  // Heaviest groups first so the biggest commitments land while seats remain.
  const lockedGroups = buildUnits(players)
    .filter((u) => u.size > 1)
    .sort((a, b) => b.size - a.size || b.mmr - a.mmr);
  for (const group of lockedGroups) {
    const team = neediestTeams(teams).find((t) => freeSeats(t) >= group.size);
    if (!team) continue; // no room anywhere — let the normal passes handle them
    for (const member of group.members) {
      const filled = member.role === null ? { ...member, role: firstMissingRole(team) } : member;
      place(team, filled);
      placed.add(member.id);
    }
  }

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
            // Never move a locked player — that would split it from its group.
            if (pa.lockGroup || pb.lockGroup) continue;
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
  const pool = applyForcedGroups(players);
  switch (mode) {
    case "role":
      return balanceByRole(pool, numTeams);
    case "random":
      return randomTeams(pool, numTeams);
    case "mmr":
    default:
      return balanceTeams(pool, numTeams);
  }
}
