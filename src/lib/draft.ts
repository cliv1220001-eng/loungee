// Captain's Draft — a blind, organizer-run draft.
//
// Captains (the strongest player per team, by the chosen basis) each seed a
// team. On every turn the pool offers a handful of FACE-DOWN cards: the role and
// the rating are shown, the name is not. The organizer clicks one on the
// captain's behalf; only then is the name revealed and the player joins.
//
// Turn order snakes (1-2-3-3-2-1) so picking last in a round means picking first
// in the next. Unpicked cards go straight back to the pool, so a new random
// offer is drawn every turn.
//
// This module is pure: no React, no network. The UI holds a DraftState and calls
// these functions, which makes the whole flow trivially testable.

import type { Player, Team } from "./types";

/** How many face-down cards are offered on each turn. */
export const OFFER_SIZE = 5;

export interface DraftState {
  /** One entry per team, in team order; each starts with just its captain. */
  teams: { id: number; captain: Player; players: Player[] }[];
  /** Players not yet drafted and not captains. */
  pool: Player[];
  /** The face-down players offered this turn (a subset of the pool). */
  offer: Player[];
  /** Index into `teams` of the captain picking right now. */
  turn: number;
  /** Completed picks, newest last — drives the activity log and undo. */
  history: { teamId: number; player: Player; round: number }[];
  /** How many players each team must end up with (captain included). */
  teamSize: number;
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

/** Draw the next face-down offer: up to OFFER_SIZE random players from the pool. */
export function drawOffer(pool: Player[]): Player[] {
  return shuffled(pool).slice(0, Math.min(OFFER_SIZE, pool.length));
}

/**
 * Whose turn it is for a given pick number, snaking through the captains.
 * Round 0 runs 0..n-1, round 1 runs n-1..0, and so on.
 */
export function snakeTurn(pickIndex: number, numTeams: number): number {
  if (numTeams <= 0) return 0;
  const round = Math.floor(pickIndex / numTeams);
  const slot = pickIndex % numTeams;
  return round % 2 === 0 ? slot : numTeams - 1 - slot;
}

/** Which round (0-based) a pick number falls in. */
export function roundOf(pickIndex: number, numTeams: number): number {
  return numTeams > 0 ? Math.floor(pickIndex / numTeams) : 0;
}

/**
 * Start a draft. The `weight` function ranks players (current LR or raw MMR);
 * the top `numTeams` become captains, one per team, strongest on team 1.
 */
export function startDraft(
  players: Player[],
  numTeams: number,
  weight: (p: Player) => number
): DraftState {
  const ranked = [...players].sort((a, b) => weight(b) - weight(a));
  const captains = ranked.slice(0, numTeams);
  const rest = ranked.slice(numTeams);
  const teamSize = numTeams > 0 ? Math.floor(players.length / numTeams) : 0;

  return {
    teams: captains.map((captain, i) => ({ id: i + 1, captain, players: [captain] })),
    pool: rest,
    offer: drawOffer(rest),
    turn: 0,
    history: [],
    teamSize,
  };
}

/** True once every team has been filled to `teamSize`. */
export function isComplete(s: DraftState): boolean {
  return s.teams.every((t) => t.players.length >= s.teamSize);
}

/**
 * Apply one pick. The chosen player joins the team currently on the clock, the
 * rest of the offer returns to the pool, and a fresh offer is drawn for the next
 * captain that still has room. Returns a NEW state; the input is not mutated.
 */
export function pick(s: DraftState, playerId: string): DraftState {
  const chosen = s.offer.find((p) => p.id === playerId);
  if (!chosen || isComplete(s)) return s;

  const round = roundOf(s.history.length, s.teams.length);
  const teamId = s.teams[s.turn]?.id;
  if (teamId == null) return s;

  const teams = s.teams.map((t) =>
    t.id === teamId ? { ...t, players: [...t.players, chosen] } : t
  );
  // Everything not picked stays available — only the chosen player leaves.
  const pool = s.pool.filter((p) => p.id !== chosen.id);
  const history = [...s.history, { teamId, player: chosen, round }];

  // Advance the snake past any team that is already full.
  const next = { ...s, teams, pool, history };
  const turn = nextTurn(next);
  return { ...next, turn, offer: drawOffer(pool) };
}

/**
 * The next captain on the clock: walk the snake forward from the current pick
 * count and skip teams that are already full. Returns the current turn when no
 * team has room left (the draft is over).
 */
function nextTurn(s: DraftState): number {
  const n = s.teams.length;
  for (let i = 0; i < n * s.teamSize; i++) {
    const t = snakeTurn(s.history.length + i, n);
    if (s.teams[t] && s.teams[t].players.length < s.teamSize) return t;
  }
  return s.turn;
}

/** Undo the most recent pick, returning that player to the pool. */
export function undo(s: DraftState): DraftState {
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
  return { ...rewound, turn: nextTurn(rewound), offer: drawOffer(pool) };
}

/** Convert a finished (or partial) draft into the Team shape the app uses. */
export function toTeams(s: DraftState): Team[] {
  return s.teams.map((t) => ({
    id: t.id,
    players: t.players,
    totalMmr: t.players.reduce((sum, p) => sum + p.mmr, 0),
  }));
}
