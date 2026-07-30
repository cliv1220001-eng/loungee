import type { Player, Role, Team } from "./types";

export type BalanceMode = "mmr" | "role" | "random";

/**
 * What team strength is measured by. "lr" weights by each player's current
 * LoungeE Rating (form-aware); "mmr" weights by their raw peak MMR. Independent
 * of BalanceMode — either basis works with any strategy.
 */
export type BalanceBasis = "lr" | "mmr";

export interface BalanceResult {
  teams: Team[];
  spread: number;
}

/**
 * Tuning for how much the balancer trades exactness for variety.
 *   tolerance  — fraction above the best spread still treated as "good enough";
 *                any result within [best, best*(1+tolerance)] is a candidate, so
 *                near-equal partitions all become eligible instead of only the
 *                single tightest one (which is nearly unique and made the same
 *                teams appear every reshuffle).
 *   repeatPenalty — spread-equivalent cost charged per recently-teamed pair a
 *                result recreates, so reshuffles actively break up prior duos.
 */
export interface BalanceOptions {
  tolerance?: number;
  repeatPenalty?: number;
  /**
   * Pairs teamed on a previous generation, each as "idA|idB" with idA < idB.
   * Results that re-pair these are penalized so rosters churn between shuffles.
   */
  recentPairs?: Set<string>;
}

const DEFAULT_TOLERANCE = 0.03; // 3%
const DEFAULT_REPEAT_PENALTY = 200; // MMR-equivalent cost per repeated pair

/** Canonical key for an unordered pair of player ids. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Every within-team pair in a result, as canonical "idA|idB" keys. */
export function pairsOf(teams: Team[]): Set<string> {
  const pairs = new Set<string>();
  for (const t of teams) {
    for (let i = 0; i < t.players.length; i++) {
      for (let j = i + 1; j < t.players.length; j++) {
        pairs.add(pairKey(t.players[i].id, t.players[j].id));
      }
    }
  }
  return pairs;
}

/** How many of `recent` this result reproduces — the anti-repeat cost driver. */
function repeatedPairs(teams: Team[], recent: Set<string> | undefined): number {
  if (!recent || recent.size === 0) return 0;
  let n = 0;
  for (const key of pairsOf(teams)) if (recent.has(key)) n++;
  return n;
}

/**
 * Pick among near-optimal results for variety. `cost(r)` is a result's spread
 * plus its repeat penalty; every result within `tolerance` of the best cost is a
 * candidate, and one is chosen at random. This is what turns "same teams every
 * time" into a genuinely different-but-still-fair split each reshuffle.
 */
function chooseVaried(
  results: BalanceResult[],
  opts: BalanceOptions | undefined,
  extraCost: (r: BalanceResult) => number
): BalanceResult {
  const tolerance = opts?.tolerance ?? DEFAULT_TOLERANCE;
  const cost = (r: BalanceResult) => r.spread + extraCost(r);
  const best = Math.min(...results.map(cost));
  // Allow an absolute floor too, so a best cost of 0 still admits near-ties.
  const ceiling = best * (1 + tolerance) + 1e-9;
  const candidates = results.filter((r) => cost(r) <= ceiling);
  const pool = candidates.length > 0 ? candidates : results;

  // Dedupe by team composition so the random pick chooses among GENUINELY
  // distinct arrangements — otherwise many identical partitions in the pool bias
  // selection toward whichever the restarts happened to find most often.
  const bySig = new Map<string, BalanceResult>();
  for (const r of pool) {
    const sig = r.teams
      .map((t) => t.players.map((p) => p.id).sort().join(","))
      .sort()
      .join("|");
    if (!bySig.has(sig)) bySig.set(sig, r);
  }
  const distinct = [...bySig.values()];
  return distinct[Math.floor(Math.random() * distinct.length)];
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
];

const FORCE_PROBABILITY = 1;

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
export function balanceTeams(
  players: Player[],
  numTeams: number,
  restarts = 200,
  opts?: BalanceOptions
): BalanceResult {
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

  // Pick among near-optimal splits (within tolerance), preferring ones that
  // recreate the fewest recent pairings — so reshuffles vary AND break up duos.
  const penalty = opts?.repeatPenalty ?? DEFAULT_REPEAT_PENALTY;
  return chooseVaried(results, opts, (r) => penalty * repeatedPairs(r.teams, opts?.recentPairs));
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

/**
 * Teams with room, neediest first (most missing lanes), then lowest running MMR.
 * Ties on BOTH keys are broken randomly so repeated builds explore different
 * assignments (the caller runs several restarts and keeps the best).
 */
function neediestTeams(teams: WorkingTeam[]): WorkingTeam[] {
  return teams
    .filter((t) => t.players.length < t.capacity)
    .map((t) => ({ t, r: Math.random() }))
    .sort(
      (a, b) =>
        missingCoreRoles(b.t) - missingCoreRoles(a.t) ||
        a.t.totalMmr - b.t.totalMmr ||
        a.r - b.r
    )
    .map((x) => x.t);
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
export function balanceByRole(
  players: Player[],
  numTeams: number,
  restarts = 200,
  opts?: BalanceOptions
): BalanceResult {
  if (numTeams < 1) throw new Error("numTeams must be at least 1");
  if (players.length === 0) {
    return {
      teams: teamCapacities(0, numTeams).map((_, i) => ({ id: i + 1, players: [], totalMmr: 0 })),
      spread: 0,
    };
  }

  // Role-completeness is this mode's whole point, so it's the hard filter: only
  // among the layouts with the FEWEST missing lanes do we then pick for variety
  // (tolerance on spread + anti-repeat), instead of always the single tightest.
  const builds = Array.from({ length: restarts }, () => {
    const teams = buildRoleTeams(players, numTeams);
    refineSameRole(teams);
    return teams;
  });

  const missingOf = (t: WorkingTeam[]) => t.reduce((n, x) => n + missingCoreRoles(x), 0);
  const fewestMissing = Math.min(...builds.map(missingOf));
  const proper = builds.filter((t) => missingOf(t) === fewestMissing);

  const results = proper.map(toResult);
  const penalty = opts?.repeatPenalty ?? DEFAULT_REPEAT_PENALTY;
  return chooseVaried(results, opts, (r) => penalty * repeatedPairs(r.teams, opts?.recentPairs));
}

/** One randomized role-first build (no refine). See balanceByRole for the strategy. */
function buildRoleTeams(players: Player[], numTeams: number): WorkingTeam[] {
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

  return teams;
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
  mode: BalanceMode,
  opts?: BalanceOptions
): BalanceResult {
  const pool = applyForcedGroups(players);
  switch (mode) {
    case "role":
      return balanceByRole(pool, numTeams, 200, opts);
    case "random":
      return randomTeams(pool, numTeams);
    case "mmr":
    default:
      return balanceTeams(pool, numTeams, 200, opts);
  }
}
