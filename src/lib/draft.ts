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

import type { Player, Role, Team } from "./types";

/** The five core lanes a proper Dota team fills. */
const CORE_ROLES: Role[] = [1, 2, 3, 4, 5];

/** Lanes the team on the clock still lacks — drives the soft role bias + UI. */
export function neededRoles(team: { players: Player[] }): Set<Role> {
  const have = new Set(team.players.map((p) => p.role).filter((r): r is Role => r != null));
  return new Set(CORE_ROLES.filter((r) => !have.has(r)));
}

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
  /**
   * Ranks players (current LR or raw MMR). Kept on the state so every offer
   * drawn mid-draft uses the same basis the draft started with.
   */
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
 * Draw the next offer: OFFER_SIZE players of SIMILAR strength, with a SOFT lean
 * toward roles the picking team still needs.
 *
 * Strength: sort the pool by rating and take a random contiguous window of
 * adjacent players, so the cards are close in strength and the decision is about
 * role/fit rather than "take the biggest number". The window position is random,
 * so the offer stays unpredictable.
 *
 * Role lean (soft): `neededRoles` are the lanes the team lacks. We nudge the
 * window toward including some, but never force it — the window is still chosen
 * among a few random candidates, just weighted so ones covering a needed role
 * are more likely. Passing an empty/omitted set falls back to pure strength.
 */
export function drawOffer(
  pool: Player[],
  weight: (p: Player) => number,
  neededRoles?: Set<Role>
): Player[] {
  const size = Math.min(OFFER_SIZE, pool.length);
  if (size === 0) return [];
  if (pool.length <= OFFER_SIZE) return shuffled(pool);

  const ranked = [...pool].sort((a, b) => weight(b) - weight(a));
  const lastStart = ranked.length - size;

  // Without a role need, keep the original single random window.
  if (!neededRoles || neededRoles.size === 0) {
    const start = Math.floor(Math.random() * (lastStart + 1));
    return shuffled(ranked.slice(start, start + size));
  }

  // Soft lean: sample a few random windows, keep the one whose coverage-weighted
  // random score is highest (+1 so a zero-cover window can still win sometimes).
  const TRIES = 4;
  let best = ranked.slice(0, size);
  let bestWeight = -1;
  for (let i = 0; i < TRIES; i++) {
    const start = Math.floor(Math.random() * (lastStart + 1));
    const win = ranked.slice(start, start + size);
    const covered = new Set(
      win.map((p) => p.role).filter((r): r is Role => r != null && neededRoles.has(r))
    );
    const w = (covered.size + 1) * Math.random();
    if (w > bestWeight) {
      best = win;
      bestWeight = w;
    }
  }
  return shuffled(best);
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

  // Balance captain strength across teams: the snake already advantages the
  // team that picks first, so seating the STRONGEST captain there would stack
  // that team. Assign captains to teams in random order instead, so captain
  // strength and pick-order advantage aren't correlated.
  const seats = shuffled(captains);

  const state: DraftState = {
    teams: seats.map((captain, i) => ({ id: i + 1, captain, players: [captain] })),
    pool: rest,
    offer: [],
    turn: 0,
    history: [],
    teamSize,
    weight,
  };
  // Draw the opening offer for the team on the clock, leaning to its needs.
  state.offer = drawOffer(rest, weight, neededRoles(state.teams[state.turn]));
  return state;
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
  const need = next.teams[turn] ? neededRoles(next.teams[turn]) : undefined;
  return { ...next, turn, offer: drawOffer(pool, s.weight, need) };
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
  const turn = nextTurn(rewound);
  const need = rewound.teams[turn] ? neededRoles(rewound.teams[turn]) : undefined;
  return { ...rewound, turn, offer: drawOffer(pool, s.weight, need) };
}

/** Convert a finished (or partial) draft into the Team shape the app uses. */
export function toTeams(s: DraftState): Team[] {
  return s.teams.map((t) => ({
    id: t.id,
    players: t.players,
    totalMmr: t.players.reduce((sum, p) => sum + p.mmr, 0),
  }));
}
