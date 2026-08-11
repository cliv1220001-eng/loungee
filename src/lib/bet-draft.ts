// Captain's Draft (Bet Game) — a coin-toss, alternating 1-1 captain draft.
//
// How it differs from the regular Captain's Draft (./draft.ts):
//   • EXACTLY 10 players total: the 2 highest-rated by the chosen basis (LR by
//     default) are the captains, the other 8 form the draft pool. Each team ends
//     up with 5 players (1 captain + 4 picks).
//   • A COIN TOSS decides who picks first. The toss winner picks 1st, the loser
//     2nd, the winner 3rd, the loser 4th… straight alternation — NOT snake.
//   • Each turn shows ALL remaining pool players (lowest-rated first); the captain
//     picks whoever they want from the full board.
//
// Pure module: no React, no network. The UI holds a BetDraftState and calls these
// functions, which keeps the whole flow testable.

import type { Player, Team } from "./types";

/** Total players required for a Bet Game: 2 captains + 8 pool = 10. */
export const BET_TOTAL_PLAYERS = 10;
/** Number of pool players (10 total minus the 2 captains). */
export const BET_POOL_SIZE = BET_TOTAL_PLAYERS - 2;

/** Which captain won the coin toss — "a" is team 1 (first listed), "b" is team 2. */
export type CoinSide = "a" | "b";

export interface BetDraftState {
  /** Exactly two teams, each seeded with its captain. Index 0 = "a", 1 = "b". */
  teams: { id: number; captain: Player; players: Player[]; side: CoinSide }[];
  /** Players not yet drafted and not captains. */
  pool: Player[];
  /** The (up to) 3 lowest-rated players offered this turn. */
  offer: Player[];
  /** Index into `teams` of the captain picking right now (0 or 1). */
  turn: number;
  /** The coin-toss winner; they take the very first pick. */
  first: CoinSide;
  /** Completed picks, newest last — drives the activity log and undo. */
  history: { teamId: number; player: Player }[];
  /** How many players each team must end up with (captain included) = 5. */
  teamSize: number;
  /** Ranks players (current LR or raw MMR), frozen at draft start. */
  weight: (p: Player) => number;
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

/**
 * The offer: ALL remaining pool players, sorted lowest-rated first so the
 * cheapest options read at the front. The captain sees the whole board and picks
 * whoever they want.
 */
export function drawOffer(pool: Player[], weight: (p: Player) => number): Player[] {
  return [...pool].sort((a, b) => weight(a) - weight(b));
}

/**
 * The team index picking for a given pick number, given who won the toss.
 * Straight alternation: winner, loser, winner, loser… The toss winner ("a"→0,
 * "b"→1) takes even pick indices; the loser takes odd ones.
 */
export function alternatingTurn(pickIndex: number, first: CoinSide): number {
  const firstIdx = first === "a" ? 0 : 1;
  return pickIndex % 2 === 0 ? firstIdx : 1 - firstIdx;
}

/**
 * Start a Bet Game draft. Requires exactly {@link BET_TOTAL_PLAYERS} players; the
 * two highest-rated by `weight` become the captains (team "a" is the toss winner
 * — but which side actually won is passed in from the coin toss).
 *
 * `first` is the coin-toss result: the winning side picks first.
 */
export function startBetDraft(
  players: Player[],
  weight: (p: Player) => number,
  first: CoinSide
): BetDraftState {
  const ranked = [...players].sort((a, b) => weight(b) - weight(a));
  const captains = ranked.slice(0, 2);
  const pool = ranked.slice(2);

  // Team "a" is the coin-toss winner and picks first; "b" is the loser. The two
  // captains are seated randomly so captain strength isn't correlated with the
  // first-pick advantage the toss confers.
  const seatedCaptains = shuffled(captains);
  const teams: BetDraftState["teams"] = [
    { id: 1, captain: seatedCaptains[0], players: [seatedCaptains[0]], side: "a" },
    { id: 2, captain: seatedCaptains[1], players: [seatedCaptains[1]], side: "b" },
  ];

  const teamSize = Math.floor(players.length / 2); // 10 / 2 = 5 (captain + 4 picks)
  const turn = first === "a" ? 0 : 1;

  return {
    teams,
    pool,
    offer: drawOffer(pool, weight),
    turn,
    first,
    history: [],
    teamSize,
    weight,
  };
}

/** True once both teams are filled to `teamSize`. */
export function isComplete(s: BetDraftState): boolean {
  return s.teams.every((t) => t.players.length >= s.teamSize);
}

/**
 * The next captain on the clock: continue the alternation from the current pick
 * count, skipping a team that is already full. Returns the current turn when no
 * team has room (the draft is over).
 */
function nextTurn(s: BetDraftState): number {
  for (let i = 0; i < s.teams.length * s.teamSize; i++) {
    const t = alternatingTurn(s.history.length + i, s.first);
    if (s.teams[t] && s.teams[t].players.length < s.teamSize) return t;
  }
  return s.turn;
}

/**
 * Apply one pick. The chosen player joins the team on the clock; the rest of the
 * offer stays in the pool, the turn alternates, and a fresh 3-lowest offer is
 * drawn. Returns a NEW state; the input is not mutated.
 */
export function pick(s: BetDraftState, playerId: string): BetDraftState {
  const chosen = s.offer.find((p) => p.id === playerId);
  if (!chosen || isComplete(s)) return s;

  const teamId = s.teams[s.turn]?.id;
  if (teamId == null) return s;

  const teams = s.teams.map((t) =>
    t.id === teamId ? { ...t, players: [...t.players, chosen] } : t
  );
  const pool = s.pool.filter((p) => p.id !== chosen.id);
  const history = [...s.history, { teamId, player: chosen }];

  const next = { ...s, teams, pool, history };
  const turn = nextTurn(next);
  return { ...next, turn, offer: drawOffer(pool, s.weight) };
}

/** Undo the most recent pick, returning that player to the pool. */
export function undo(s: BetDraftState): BetDraftState {
  const last = s.history[s.history.length - 1];
  if (!last) return s;

  const teams = s.teams.map((t) =>
    t.id === last.teamId
      ? { ...t, players: t.players.filter((p) => p.id !== last.player.id) }
      : t
  );
  const pool = [...s.pool, last.player];
  const history = s.history.slice(0, -1);
  const rewound = { ...s, teams, pool, history };
  const turn = nextTurn(rewound);
  return { ...rewound, turn, offer: drawOffer(pool, s.weight) };
}

/** Convert a finished (or partial) draft into the Team shape the app uses. */
export function toTeams(s: BetDraftState): Team[] {
  return s.teams.map((t) => ({
    id: t.id,
    players: t.players,
    totalMmr: t.players.reduce((sum, p) => sum + p.mmr, 0),
  }));
}
