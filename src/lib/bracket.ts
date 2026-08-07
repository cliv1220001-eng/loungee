export type BracketFormat = "single" | "double";
export type Side = "a" | "b";

/** A match slot is filled by a fixed team, a bye, or the winner/loser of another match. */
export type Slot =
  | { kind: "team"; teamId: number }
  | { kind: "bye" }
  | { kind: "winner"; matchId: string }
  | { kind: "loser"; matchId: string };

export interface Match {
  id: string;
  a: Slot;
  b: Slot;
}

export interface BracketColumn {
  id: string;
  group: "wb" | "lb" | "gf";
  title: string;
  matchIds: string[];
}

export interface Bracket {
  format: BracketFormat;
  matches: Record<string, Match>;
  columns: BracketColumn[];
  /** Winner of this match is the tournament champion. */
  championMatchId: string;
}

function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p *= 2;
  return Math.max(2, p);
}

/** Standard single-elimination seed positions (1-indexed) for a bracket of `size`. */
function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const sum = order.length * 2 + 1;
    const next: number[] = [];
    for (const p of order) {
      next.push(p);
      next.push(sum - p);
    }
    order = next;
  }
  return order;
}

function roundTitle(round: number): string {
  return `Round ${round + 1}`;
}

/** Build the winners-bracket rounds. Returns each round's match ids in order. */
function buildWinners(
  teamIds: number[],
  matches: Record<string, Match>,
  labelPrefix: string
): string[][] {
  const n = teamIds.length;
  const size = nextPow2(n);
  const order = seedOrder(size);
  const totalRounds = Math.log2(size);
  const roundIds: string[][] = [];

  for (let r = 0; r < totalRounds; r++) {
    const matchCount = size / 2 ** (r + 1);
    const ids: string[] = [];
    for (let m = 0; m < matchCount; m++) {
      const id = `${labelPrefix}-r${r}-m${m}`;
      let a: Slot;
      let b: Slot;
      if (r === 0) {
        const seedA = order[2 * m] - 1;
        const seedB = order[2 * m + 1] - 1;
        a = seedA < n ? { kind: "team", teamId: teamIds[seedA] } : { kind: "bye" };
        b = seedB < n ? { kind: "team", teamId: teamIds[seedB] } : { kind: "bye" };
      } else {
        a = { kind: "winner", matchId: roundIds[r - 1][2 * m] };
        b = { kind: "winner", matchId: roundIds[r - 1][2 * m + 1] };
      }
      matches[id] = { id, a, b };
      ids.push(id);
    }
    roundIds.push(ids);
  }
  return roundIds;
}

function buildSingle(teamIds: number[]): Bracket {
  const matches: Record<string, Match> = {};
  const wb = buildWinners(teamIds, matches, "wb");
  const columns: BracketColumn[] = wb.map((ids, r) => ({
    id: `wb-${r}`,
    group: "wb",
    title: roundTitle(r),
    matchIds: ids,
  }));
  return {
    format: "single",
    matches,
    columns,
    championMatchId: wb[wb.length - 1][0],
  };
}

function buildDouble(teamIds: number[]): Bracket {
  const matches: Record<string, Match> = {};
  const wb = buildWinners(teamIds, matches, "wb");
  const k = wb.length;
  const totalRounds = k;

  const columns: BracketColumn[] = wb.map((ids, r) => ({
    id: `wb-${r}`,
    group: "wb",
    title: r === totalRounds - 1 ? "WB Final" : `WB Round ${r + 1}`,
    matchIds: ids,
  }));

  // Slot that feeds the grand final's lower seat.
  let lbFinalSlot: Slot;

  if (k === 1) {
    // Two teams: the WB final loser is the lower-bracket finalist by default.
    lbFinalSlot = { kind: "loser", matchId: wb[0][0] };
  } else {
    let lbRound = 0;
    const lbColumns: BracketColumn[] = [];

    const pushColumn = (ids: string[]) => {
      lbColumns.push({
        id: `lb-${lbRound}`,
        group: "lb",
        title: `Losers Round ${lbRound + 1}`,
        matchIds: ids,
      });
      lbRound++;
    };

    // Minor round 1: pair the losers of WB round 0.
    let advancers: string[] = [];
    {
      const wb0 = wb[0];
      const ids: string[] = [];
      for (let m = 0; m < wb0.length / 2; m++) {
        const id = `lb-r${lbRound}-m${m}`;
        matches[id] = {
          id,
          a: { kind: "loser", matchId: wb0[2 * m] },
          b: { kind: "loser", matchId: wb0[2 * m + 1] },
        };
        ids.push(id);
      }
      pushColumn(ids);
      advancers = ids;
    }

    // For each remaining WB round: a major round (vs new WB losers), then a minor consolidation round.
    for (let r = 1; r < k; r++) {
      const wbLosers = [...wb[r]].reverse();
      const majorIds: string[] = [];
      for (let m = 0; m < advancers.length; m++) {
        const id = `lb-r${lbRound}-m${m}`;
        matches[id] = {
          id,
          a: { kind: "winner", matchId: advancers[m] },
          b: { kind: "loser", matchId: wbLosers[m] },
        };
        majorIds.push(id);
      }
      pushColumn(majorIds);
      advancers = majorIds;

      if (advancers.length > 1) {
        const minorIds: string[] = [];
        for (let m = 0; m < advancers.length / 2; m++) {
          const id = `lb-r${lbRound}-m${m}`;
          matches[id] = {
            id,
            a: { kind: "winner", matchId: advancers[2 * m] },
            b: { kind: "winner", matchId: advancers[2 * m + 1] },
          };
          minorIds.push(id);
        }
        pushColumn(minorIds);
        advancers = minorIds;
      }
    }

    columns.push(...lbColumns);
    lbFinalSlot = { kind: "winner", matchId: advancers[0] };
  }

  // Grand final: WB champion vs LB champion.
  const wbFinal = wb[k - 1][0];
  matches["gf"] = {
    id: "gf",
    a: { kind: "winner", matchId: wbFinal },
    b: lbFinalSlot,
  };
  columns.push({ id: "gf", group: "gf", title: "Grand Final", matchIds: ["gf"] });

  return { format: "double", matches, columns, championMatchId: "gf" };
}

export function buildBracket(teamIds: number[], format: BracketFormat): Bracket {
  return format === "double" ? buildDouble(teamIds) : buildSingle(teamIds);
}

// --- Resolution -----------------------------------------------------------

export interface ResolvedSlot {
  teamId: number | null;
  bye: boolean;
}

export interface ResolvedMatch {
  id: string;
  a: ResolvedSlot;
  b: ResolvedSlot;
  winner: Side | null;
  /** True once the winner is known (user pick or automatic bye advance). */
  decided: boolean;
}

const PENDING: ResolvedSlot = { teamId: null, bye: false };

/**
 * Walk the match graph and resolve every slot to a concrete team (or bye/pending),
 * applying byes automatically and user picks where both sides are real teams.
 */
export function resolveBracket(
  bracket: Bracket,
  winners: Record<string, Side>
): Record<string, ResolvedMatch> {
  const cache: Record<string, ResolvedMatch> = {};

  function resolveSlot(slot: Slot): ResolvedSlot {
    switch (slot.kind) {
      case "team":
        return { teamId: slot.teamId, bye: false };
      case "bye":
        return { teamId: null, bye: true };
      case "winner": {
        const rm = resolveMatch(slot.matchId);
        if (!rm.decided) return PENDING;
        return rm.winner === "a" ? rm.a : rm.b;
      }
      case "loser": {
        const rm = resolveMatch(slot.matchId);
        if (!rm.decided) return PENDING;
        return rm.winner === "a" ? rm.b : rm.a;
      }
    }
  }

  function resolveMatch(id: string): ResolvedMatch {
    const cached = cache[id];
    if (cached) return cached;

    const m = bracket.matches[id];
    const a = resolveSlot(m.a);
    const b = resolveSlot(m.b);

    let winner: Side | null = null;
    if (a.bye && b.teamId != null) winner = "b";
    else if (b.bye && a.teamId != null) winner = "a";
    else if (a.teamId != null && b.teamId != null && winners[id]) winner = winners[id];

    const rm: ResolvedMatch = { id, a, b, winner, decided: winner != null };
    cache[id] = rm;
    return rm;
  }

  for (const id in bracket.matches) resolveMatch(id);
  return cache;
}

/** Match ids that (transitively) depend on the result of `matchId`. */
function dependentsOf(bracket: Bracket, matchId: string): Set<string> {
  const deps = new Set<string>();
  const refsMatch = (slot: Slot, target: string) =>
    (slot.kind === "winner" || slot.kind === "loser") && slot.matchId === target;

  let frontier = [matchId];
  while (frontier.length) {
    const next: string[] = [];
    for (const id of Object.keys(bracket.matches)) {
      if (deps.has(id)) continue;
      const m = bracket.matches[id];
      if (frontier.some((t) => refsMatch(m.a, t) || refsMatch(m.b, t))) {
        deps.add(id);
        next.push(id);
      }
    }
    frontier = next;
  }
  return deps;
}

/** Record a winner and clear any downstream picks that depended on the old result. */
export function setWinner(
  bracket: Bracket,
  winners: Record<string, Side>,
  matchId: string,
  side: Side
): Record<string, Side> {
  const next = { ...winners, [matchId]: side };
  for (const dep of dependentsOf(bracket, matchId)) delete next[dep];
  return next;
}

/** Remove a winner and clear any downstream picks that depended on it. */
export function clearWinner(
  bracket: Bracket,
  winners: Record<string, Side>,
  matchId: string
): Record<string, Side> {
  const next = { ...winners };
  delete next[matchId];
  for (const dep of dependentsOf(bracket, matchId)) delete next[dep];
  return next;
}

export function getChampion(
  bracket: Bracket,
  resolved: Record<string, ResolvedMatch>
): number | null {
  const final = resolved[bracket.championMatchId];
  if (!final || !final.decided) return null;
  // Both finalists must be real teams — never crown a champion from a bye or an
  // unfilled (pending) slot, which can happen transiently while the bracket is
  // still building or in odd-team-count brackets with byes.
  if (final.a.teamId == null || final.b.teamId == null) return null;
  return final.winner === "a" ? final.a.teamId : final.b.teamId;
}
