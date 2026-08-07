import { useCallback, useSyncExternalStore } from "react";
import type { Team } from "./types";

const TEAMS_KEY = "dota-balancer:teams";

// --- Bracket run ------------------------------------------------------------
// A "run" is one trip through the bracket for a set of teams. It has a stable
// id so LoungeE Rating changes can be attributed to it (and re-synced on every
// pick), plus the persisted bracket UI state so results survive navigation.

export const BRACKET_RUN_KEY = "dota-balancer:run";

export interface BracketRun {
  runId: string;
  format: "single" | "double";
  seed: number;
  /** matchId -> winning side. */
  winners: Record<string, "a" | "b">;
  /**
   * Optional LR bet for this tournament. When > 0, every match win/loss pays
   * ±stake instead of the standard +40/−40/+80 scale.
   */
  stake?: number;
  /**
   * The champion team's id, written by the bracket once the final is decided
   * (and cleared if it's un-decided). Lets the Teams page show a "complete"
   * state without re-deriving the whole bracket.
   */
  championTeamId?: number | null;
}

/** Deterministic default (no id yet) so SSR/hydration match; a real run is
 *  minted client-side by startBracketRun() or lazily on the bracket page. */
export const EMPTY_BRACKET_RUN: BracketRun = { runId: "", format: "single", seed: 0, winners: {}, stake: 0 };

/**
 * Mint a fresh bracket run (called when new teams are sent to the bracket).
 * Pass the tournament id so its LR/match history is grouped under that
 * tournament; without one a random id is used. `stake` carries the LR bet.
 */
export function startBracketRun(runId?: string, stake = 0): void {
  try {
    const run: BracketRun = {
      runId: runId && runId.trim() !== "" ? runId : crypto.randomUUID(),
      format: "single",
      seed: Math.floor(Math.random() * 2 ** 31),
      winners: {},
      stake: stake > 0 ? stake : 0,
    };
    localStorage.setItem(BRACKET_RUN_KEY, JSON.stringify(run));
  } catch {
    // localStorage unavailable — the bracket page will mint one on load.
  }
}

/**
 * Point the bracket at a tournament by writing ONLY the {runId, stake} pointer.
 * Bracket STATE (winners/seed/format/champion) is never stored here — the bracket
 * page loads that from the DB — so two admins on different devices never conflict.
 * Called when a tournament is loaded from history. `saved` is only used for stake.
 */
export function restoreBracketRun(
  runId: string,
  saved: Partial<Omit<BracketRun, "runId">> | null | undefined
): void {
  try {
    const run: BracketRun = {
      runId,
      format: "single",
      seed: 0,
      winners: {},
      stake: saved?.stake ?? 0,
    };
    localStorage.setItem(BRACKET_RUN_KEY, JSON.stringify(run));
  } catch {
    // localStorage unavailable — bracket page mints a fresh run on load.
  }
}

/** Persist the balanced teams so the bracket page can pick them up. */
export function saveTeams(teams: Team[]): void {
  try {
    localStorage.setItem(TEAMS_KEY, JSON.stringify(teams));
  } catch {
    // localStorage may be unavailable (private mode) — fail silently.
  }
}

export function loadTeams(): Team[] | null {
  try {
    const raw = localStorage.getItem(TEAMS_KEY);
    return parse(raw);
  } catch {
    return null;
  }
}

export function clearTeams(): void {
  try {
    localStorage.removeItem(TEAMS_KEY);
  } catch {
    // ignore
  }
}

function parse(raw: string | null): Team[] | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Team[];
    return Array.isArray(value) && value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

// --- React subscription -----------------------------------------------------
// Cache the parsed snapshot so useSyncExternalStore gets a stable reference
// while the underlying string is unchanged.
let cachedRaw: string | null = null;
let cachedTeams: Team[] | null = null;

function getSnapshot(): Team[] | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(TEAMS_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedTeams = parse(raw);
  }
  return cachedTeams;
}

/** `undefined` during SSR / hydration so the UI can show a loading state. */
function getServerSnapshot(): undefined {
  return undefined;
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
}

/** Read the saved teams reactively: `undefined` = loading, `null` = none saved. */
export function useTeams(): Team[] | null | undefined {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

// --- Generic persisted state ------------------------------------------------
// A localStorage-backed store per key, read through useSyncExternalStore so it
// stays SSR/hydration-safe (server + first paint use the fallback, then the
// stored value swaps in) without ever calling setState inside an effect.

interface PersistStore<T> {
  getSnapshot: () => T;
  getServerSnapshot: () => T;
  write: (value: T) => void;
  subscribe: (onChange: () => void) => () => void;
}

function createPersistStore<T>(key: string, fallback: T): PersistStore<T> {
  const listeners = new Set<() => void>();
  let cachedRaw: string | null = null;
  let cached: T = fallback;
  let initialized = false;

  return {
    getSnapshot() {
      let raw: string | null = null;
      try {
        raw = localStorage.getItem(key);
      } catch {
        raw = null;
      }
      if (!initialized || raw !== cachedRaw) {
        initialized = true;
        cachedRaw = raw;
        if (raw == null) {
          cached = fallback;
        } else {
          try {
            cached = JSON.parse(raw) as T;
          } catch {
            cached = fallback;
          }
        }
      }
      return cached;
    },
    getServerSnapshot() {
      return fallback;
    },
    write(value: T) {
      cached = value;
      initialized = true;
      try {
        const raw = JSON.stringify(value);
        cachedRaw = raw;
        localStorage.setItem(key, raw);
      } catch {
        // ignore write failures
      }
      listeners.forEach((l) => l());
    },
    subscribe(onChange: () => void) {
      listeners.add(onChange);
      window.addEventListener("storage", onChange);
      return () => {
        listeners.delete(onChange);
        window.removeEventListener("storage", onChange);
      };
    },
  };
}

const persistStores = new Map<string, PersistStore<unknown>>();

function getPersistStore<T>(key: string, fallback: T): PersistStore<T> {
  let store = persistStores.get(key) as PersistStore<T> | undefined;
  if (!store) {
    store = createPersistStore<T>(key, fallback);
    persistStores.set(key, store as PersistStore<unknown>);
  }
  return store;
}

/**
 * State backed by localStorage under `key`, surviving reloads.
 * Pass a stable `fallback` (module constant). Returns `[value, setValue]`
 * where `setValue` accepts a value or an updater function.
 */
export function usePersistentState<T>(
  key: string,
  fallback: T
): [T, (updater: T | ((prev: T) => T)) => void] {
  const store = getPersistStore<T>(key, fallback);
  const value = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getServerSnapshot);
  const set = useCallback(
    (updater: T | ((prev: T) => T)) => {
      const current = store.getSnapshot();
      const next = typeof updater === "function" ? (updater as (prev: T) => T)(current) : updater;
      store.write(next);
    },
    [store]
  );
  return [value, set];
}
