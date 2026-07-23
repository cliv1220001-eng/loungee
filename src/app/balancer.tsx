"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { BalanceBasis, BalanceMode, BalanceResult } from "@/lib/balance";
import {
  OFFER_SIZE,
  isComplete as draftComplete,
  pick as draftPick,
  startDraft,
  toTeams as draftToTeams,
  undo as draftUndo,
  type DraftState,
} from "@/lib/draft";
import DraftReveal from "./draft-reveal";
import { startingLr } from "@/lib/lr";
import { saveTeams, startBracketRun, usePersistentState } from "@/lib/store";
import { ROLE_LABELS, type Role, type Team } from "@/lib/types";

interface DraftPlayer {
  id: string;
  name: string;
  mmr: string;
  role: Role | null;
  /** Hidden registry key — LR is tracked per email. Set via bulk paste. */
  email: string | null;
}

/** Registry payload derived from teams (only players that carry an email). */
function registryFromTeams(teams: Team[]) {
  return teams
    .flatMap((t) => t.players)
    .filter((p) => (p.email ?? "").trim() !== "")
    .map((p) => ({
      email: (p.email ?? "").trim().toLowerCase(),
      ign: p.name,
      mmr: p.mmr,
      position: p.role,
    }));
}

/** Fire-and-forget: register/refresh players so the leaderboard knows them. */
function registerPlayers(players: ReturnType<typeof registryFromTeams>): void {
  if (players.length === 0) return;
  void fetch("/api/players", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ players }),
  }).catch(() => {});
}

const ROLES: Role[] = [1, 2, 3, 4, 5];

// Strategies. What they weight by (LR or MMR) is chosen separately — see BASES.
// "draft" is not a server balancing mode: it runs entirely client-side as an
// interactive draft (see @/lib/draft) and produces teams the same shape.
type PageMode = BalanceMode | "draft";

const MODES: { key: PageMode; label: string; hint: string }[] = [
  { key: "mmr", label: "Balance", hint: "Closest team totals" },
  { key: "role", label: "Spread Roles", hint: "Even roles + balanced" },
  { key: "random", label: "Random", hint: "Shuffle without weighting" },
  { key: "draft", label: "Captain's Draft", hint: "Captains pick blind" },
];

/** The measure of strength the balancer weights by (ignored by Random). */
const BASES: { key: BalanceBasis; label: string; hint: string }[] = [
  { key: "lr", label: "LR", hint: "Current ladder rating" },
  { key: "mmr", label: "MMR", hint: "Raw peak MMR" },
];

const TEAM_ACCENTS = [
  "#5a7fa8",
  "#5a9a78",
  "#b08a4a",
  "#b0605a",
  "#7a86a0",
];

// Fixed MMR bands, highest first. tierOf returns the first band a player clears.
const TIERS: { n: number; range: string; min: number }[] = [
  { n: 1, range: "7000+", min: 7000 },
  { n: 2, range: "5500–6999", min: 5500 },
  { n: 3, range: "4000–5499", min: 4000 },
  { n: 4, range: "2500–3999", min: 2500 },
  { n: 5, range: "below 2500", min: 0 },
];

function tierOf(mmr: string): number | null {
  const v = parseInt(mmr, 10);
  if (Number.isNaN(v)) return null;
  return TIERS.find((t) => v >= t.min)!.n;
}

// Newly-added rows get a collision-proof id (restored rows keep their stored ids).
function makeRow(): DraftPlayer {
  return { id: crypto.randomUUID(), name: "", mmr: "", role: null, email: null };
}
// Default rows use deterministic ids so server and client first render match.
function blankRows(n: number): DraftPlayer[] {
  return Array.from({ length: n }, (_, i) => ({ id: `row-${i}`, name: "", mmr: "", role: null, email: null }));
}

interface BalancerSession {
  rows: DraftPlayer[];
  mode: PageMode;
  /** Weight teams by current LR (default) or raw peak MMR. */
  basis?: BalanceBasis;
  result: BalanceResult | null;
  /** The untouched generated teams, kept so manual edits can be reverted. */
  generated?: BalanceResult | null;
  /** The basis the current result was generated with, so totals stay truthful. */
  resultBasis?: BalanceBasis;
}

const SESSION_KEY = "dota-balancer:session";
const DEFAULT_SESSION: BalancerSession = {
  rows: blankRows(10),
  mode: "mmr",
  basis: "lr",
  result: null,
  generated: null,
  resultBasis: "lr",
};

// The tournament currently being worked on. Its roster/teams auto-save under this
// name so it can be reloaded from history later.
interface CurrentTournament {
  id: string | null;
  name: string;
}
const CURRENT_KEY = "dota-balancer:tournament";
const NO_TOURNAMENT: CurrentTournament = { id: null, name: "" };

// NOTE: team generation — including balancing and any team-shaping rules — runs
// server-side in /api/teams so that logic never ships to the browser bundle.

function parseRole(token: string | undefined): Role | null {
  if (!token) return null;
  const t = token.trim().toLowerCase();
  if (!t) return null;
  const num = parseInt(t, 10);
  if (num >= 1 && num <= 5) return num as Role;
  if (t.includes("carry") || t.includes("safe") || t === "pos 1") return 1;
  if (t.includes("mid")) return 2;
  if (t.includes("off")) return 3;
  if (t.includes("soft") || t.includes("pos 4")) return 4;
  if (t.includes("hard") || t.includes("pos 5")) return 5;
  if (t.includes("sup")) return 4;
  return null;
}

interface BulkRow {
  email: string | null;
  name: string;
  mmr: string;
  role: Role | null;
}

/**
 * Parse pasted spreadsheet rows. Preferred format (from the host):
 *   Email <TAB> IGN <TAB> MMR <TAB> Position
 * A leading email column is auto-detected (contains "@"); rows without one fall
 * back to the legacy "IGN <TAB> MMR <TAB> Role". Accepts tab or comma; a plain
 * "IGN MMR Role" single-space line is also understood (no email).
 */
function parseBulk(text: string): BulkRow[] {
  const out: BulkRow[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    let cols: string[];
    let delimited = true;
    if (line.includes("\t")) cols = line.split("\t");
    else if (line.includes(",")) cols = line.split(",");
    else {
      delimited = false;
      const m = line.match(/^(.*?)\s+(\d{1,5})\s*(.*)$/);
      cols = m ? [m[1], m[2], m[3]] : [line];
    }
    cols = cols.map((c) => c.trim());

    // Skip a header row (any cell literally "mmr").
    if (cols.some((c) => /^mmr$/i.test(c))) continue;

    const hasEmail = delimited && cols[0].includes("@");
    const email = hasEmail ? cols[0].toLowerCase() : null;
    const name = hasEmail ? cols[1] ?? "" : cols[0];
    const mmrCol = hasEmail ? cols[2] : cols[1];
    const roleCol = hasEmail ? cols[3] : cols[2];
    if (!name) continue;

    const mmr = (mmrCol ?? "").replace(/[^0-9]/g, "").slice(0, 5);
    out.push({ email, name, mmr, role: parseRole(roleCol) });
  }
  return out;
}

export default function Balancer() {
  const router = useRouter();
  // Persisted across reloads (roster, chosen mode, last result).
  const [session, setSession] = usePersistentState<BalancerSession>(SESSION_KEY, DEFAULT_SESSION);
  const { rows, mode, result } = session;
  const generated = session.generated ?? null;
  const basis: BalanceBasis = session.basis ?? "lr";
  // Sessions saved before the basis toggle existed were all LR-based.
  const resultBasis: BalanceBasis = session.resultBasis ?? "lr";
  const setRows = (updater: DraftPlayer[] | ((prev: DraftPlayer[]) => DraftPlayer[])) =>
    setSession((s) => ({ ...s, rows: typeof updater === "function" ? updater(s.rows) : updater }));
  const setMode = (next: PageMode) => setSession((s) => ({ ...s, mode: next }));
  const setBasis = (next: BalanceBasis) => setSession((s) => ({ ...s, basis: next }));
  const setResult = (next: BalanceResult | null) => setSession((s) => ({ ...s, result: next }));

  // Transient UI state (not persisted).
  const [shuffleKey, setShuffleKey] = useState(0);
  const [shuffling, setShuffling] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");
  const [genError, setGenError] = useState<string | null>(null);
  /** Free-text roster filter — matches player name (blank shows everyone). */
  const [search, setSearch] = useState("");
  /** Guard so a stray click can't wipe a large roster. */
  const [confirmReset, setConfirmReset] = useState(false);

  // Saved tournaments (Supabase-backed).
  const [current, setCurrent] = usePersistentState<CurrentTournament>(CURRENT_KEY, NO_TOURNAMENT);
  const [newName, setNewName] = useState("");
  const [savedList, setSavedList] = useState<{ id: string; name: string; created_at: string }[] | null>(null);
  /** Tournament id awaiting delete confirmation (guards an irreversible action). */
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [tourneyBusy, setTourneyBusy] = useState(false);
  const [tourneyMsg, setTourneyMsg] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Current LR per email, so the results cards can show LR in place of MMR.
  const [lrByEmail, setLrByEmail] = useState<Map<string, number>>(new Map());
  const refreshLr = useCallback(() => {
    fetch("/api/players")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!b?.players) return;
        const m = new Map<string, number>();
        for (const p of b.players as { email: string; lr: number }[]) m.set(p.email, p.lr);
        setLrByEmail(m);
      })
      .catch(() => {});
  }, []);
  const lrOf = useCallback(
    (mmr: number, email: string | null | undefined) => {
      const key = (email ?? "").trim().toLowerCase();
      return key && lrByEmail.has(key) ? lrByEmail.get(key)! : startingLr(mmr);
    },
    [lrByEmail]
  );

  // --- Manual roster edits (drag & drop) ------------------------------------
  // The player currently being dragged, identified by team + player id.
  const [dragging, setDragging] = useState<{ teamId: number; playerId: string } | null>(null);
  const [dragOver, setDragOver] = useState<{ teamId: number; playerId: string | null } | null>(null);
  /** Click-to-swap selection — the touch-friendly path (HTML5 drag has no
   *  touch support, so tapping one player then another swaps them). */
  const [picked, setPicked] = useState<{ teamId: number; playerId: string } | null>(null);

  /** One player's weight under the basis the current teams were built with. */
  const weightOf = useCallback(
    (p: { mmr: number; email?: string | null }) =>
      resultBasis === "mmr" ? p.mmr : lrOf(p.mmr, p.email),
    [resultBasis, lrOf]
  );

  /** Team total in the active basis — what the cards show and balancing targets. */
  const teamLr = useCallback(
    (t: Team) => t.players.reduce((s, p) => s + weightOf(p), 0),
    [weightOf]
  );

  /** Widest gap between team totals — the measure the balancer minimizes. */
  const lrSpread = useCallback(
    (teams: Team[]) => {
      if (teams.length === 0) return 0;
      const totals = teams.map(teamLr);
      return Math.max(...totals) - Math.min(...totals);
    },
    [teamLr]
  );

  /** Unit label for the active basis, used across the results UI. */
  const unit = resultBasis === "mmr" ? "MMR" : "LR";

  /**
   * Apply a manual drag: move `src` onto `dst`. Dropping onto another player
   * SWAPS them (keeping both teams at their current size, so 5v5 stays intact);
   * dropping onto a team's empty space moves the player only if that team has
   * fewer players than the source team, which can only happen with uneven teams.
   */
  function applyDrop(
    src: { teamId: number; playerId: string },
    dst: { teamId: number; playerId: string | null }
  ) {
    if (!result) return;
    if (src.teamId === dst.teamId && (dst.playerId === null || dst.playerId === src.playerId)) return;

    const teams = result.teams.map((t) => ({ ...t, players: [...t.players] }));
    const from = teams.find((t) => t.id === src.teamId);
    const to = teams.find((t) => t.id === dst.teamId);
    if (!from || !to) return;

    const si = from.players.findIndex((p) => p.id === src.playerId);
    if (si === -1) return;
    const moved = from.players[si];

    if (dst.playerId) {
      // Swap with the dropped-on player.
      const di = to.players.findIndex((p) => p.id === dst.playerId);
      if (di === -1) return;
      const target = to.players[di];
      from.players[si] = target;
      to.players[di] = moved;
    } else {
      // Move into open space — only when it won't unbalance team sizes.
      if (to.players.length >= from.players.length) return;
      from.players.splice(si, 1);
      to.players.push(moved);
    }

    // Keep totalMmr truthful (it is a real-MMR sum; LR is derived via lrOf).
    for (const t of teams) t.totalMmr = t.players.reduce((s, p) => s + p.mmr, 0);
    setResult({ ...result, teams, spread: lrSpread(teams) });
  }

  /**
   * Tap/click a player to select, tap another to swap them. Works on touch,
   * where HTML5 drag-and-drop does nothing. Tapping the same player deselects.
   */
  function pickPlayer(teamId: number, playerId: string) {
    if (!picked) {
      setPicked({ teamId, playerId });
      return;
    }
    if (picked.playerId === playerId) {
      setPicked(null); // tapped the same one again — cancel
      return;
    }
    applyDrop(picked, { teamId, playerId });
    setPicked(null);
  }

  /** Throw away manual edits and restore the teams exactly as generated. */
  function revertTeams() {
    if (generated) setResult(generated);
    setPicked(null);
  }

  // --- Captain's Draft -------------------------------------------------------
  // Runs entirely in the browser: no server round-trip, so the organizer can
  // undo freely. Cards stay face-down (role + rating only) until picked.
  // NOTE: the handlers live further down, after `ready` / `numTeams` are derived.
  const [draft, setDraft] = useState<DraftState | null>(null);
  /**
   * The pick currently being celebrated. Held separately from the draft state
   * because the player leaves the offer the instant they're picked, and the
   * overlay needs their details for the full reveal animation.
   */
  const [reveal, setReveal] = useState<{
    key: number;
    name: string;
    role: Role | null;
    rating: number;
    teamId: number;
    accent: string;
  } | null>(null);

  // True once the roster differs from what was generated.
  const edited = useMemo(() => {
    if (!result || !generated) return false;
    const sig = (r: BalanceResult) =>
      r.teams.map((t) => `${t.id}:${t.players.map((p) => p.id).sort().join(",")}`).join("|");
    return sig(result) !== sig(generated);
  }, [result, generated]);

  // Spread of the teams on screen vs. the generated baseline, both measured in
  // LR so the number matches the per-team LR the cards show.
  const liveSpread = useMemo(() => (result ? lrSpread(result.teams) : 0), [result, lrSpread]);
  const baseSpread = useMemo(
    () => (generated ? lrSpread(generated.teams) : 0),
    [generated, lrSpread]
  );

  // Load the saved tournament list + current LR on mount.
  useEffect(() => {
    refreshLr();
    let active = true;
    fetch("/api/tournaments")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (active && b) setSavedList(b.tournaments ?? []);
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, [refreshLr]);

  // Auto-save the working session to the current tournament (debounced) so its
  // history is always up to date and reloadable.
  useEffect(() => {
    if (!current.id) return;
    const t = window.setTimeout(async () => {
      setSaveState("saving");
      try {
        const res = await fetch(`/api/tournaments/${current.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name: current.name, data: session }),
        });
        if (!res.ok) throw new Error();
        setSaveState("saved");
      } catch {
        setSaveState("error");
      }
    }, 1200);
    return () => window.clearTimeout(t);
  }, [session, current.id, current.name]);

  const ready = useMemo(() => {
    const valid = rows.filter(
      (r) => r.name.trim() !== "" && r.mmr.trim() !== "" && !Number.isNaN(Number(r.mmr))
    );
    // Drop duplicates (keep first) so no one is counted or placed twice. Email is
    // the identity when present (IGNs can repeat / change); otherwise fall back to name.
    const seen = new Set<string>();
    return valid.filter((r) => {
      const key = (r.email ?? "").trim().toLowerCase() || r.name.trim().toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [rows]);

  // Roster health — surfaces the rows that would be silently dropped by `ready`
  // (a blank name or MMR excludes a row) plus duplicates, so a 100+ player paste
  // can be checked at a glance instead of by scrolling every tier column.
  const rosterIssues = useMemo(() => {
    const filled = rows.filter((r) => r.name.trim() !== "" || r.mmr.trim() !== "");
    const missingMmr = filled.filter((r) => r.name.trim() !== "" && r.mmr.trim() === "");
    const missingName = filled.filter((r) => r.name.trim() === "" && r.mmr.trim() !== "");
    const noEmail = filled.filter((r) => (r.email ?? "").trim() === "" && r.name.trim() !== "");
    const seen = new Set<string>();
    const dupes: DraftPlayer[] = [];
    for (const r of filled) {
      const k = (r.email ?? "").trim().toLowerCase() || r.name.trim().toLowerCase();
      if (!k) continue;
      if (seen.has(k)) dupes.push(r);
      seen.add(k);
    }
    return { filled: filled.length, missingMmr, missingName, noEmail, dupes };
  }, [rows]);

  /** Rows matching the search box (name match, case-insensitive). */
  const matchesSearch = useCallback(
    (r: DraftPlayer) => {
      const q = search.trim().toLowerCase();
      return q === "" || r.name.toLowerCase().includes(q);
    },
    [search]
  );

  // Dota teams are 5 players each — the team count follows the player count.
  const TEAM_SIZE = 5;
  const playerCount = ready.length;
  const numTeams = Math.floor(playerCount / TEAM_SIZE);
  const remainder = playerCount % TEAM_SIZE;
  const canGenerate = numTeams >= 2;

  // Captain's Draft handlers — defined here so they read the derived roster
  // values (`ready`, `numTeams`, `canGenerate`) after those exist.

  /** Begin a draft from the ready roster, ranking captains by the chosen basis. */
  function beginDraft() {
    if (!canGenerate) return;
    const players = ready.map((r) => ({
      id: r.id,
      name: r.name.trim(),
      mmr: Math.round(Number(r.mmr)),
      role: r.role,
      email: (r.email ?? "").trim().toLowerCase() || null,
    }));
    const weight = (p: { mmr: number; email?: string | null }) =>
      basis === "mmr" ? p.mmr : lrOf(p.mmr, p.email);
    setDraft(startDraft(players, numTeams, weight));
    setSession((s) => ({ ...s, result: null, generated: null, resultBasis: basis }));
    setRevealed(false);
    setGenError(null);
  }

  /**
   * Organizer clicks a face-down card on the captain's behalf. The card's
   * identity is captured BEFORE applying the pick (it leaves the offer
   * immediately) so the celebration overlay can show who it was.
   */
  function takePick(playerId: string) {
    if (!draft) return;
    const chosen = draft.offer.find((p) => p.id === playerId);
    if (!chosen) return;
    const teamIndex = draft.turn;
    setReveal({
      key: draft.history.length, // unique per pick → remounts the confetti
      name: chosen.name,
      role: chosen.role,
      rating: weightOf(chosen),
      teamId: draft.teams[teamIndex]?.id ?? 0,
      accent: TEAM_ACCENTS[teamIndex % TEAM_ACCENTS.length],
    });
    setDraft(draftPick(draft, playerId));
    // Matches the reveal-name animation duration in globals.css.
    window.setTimeout(() => setReveal(null), 2000);
  }

  /** Push the finished draft into the normal result flow (bracket, LR, etc). */
  function finishDraft() {
    if (!draft) return;
    const teams = draftToTeams(draft);
    const totals = teams.map((t) => t.players.reduce((s, p) => s + weightOf(p), 0));
    const res: BalanceResult = {
      teams,
      spread: totals.length ? Math.max(...totals) - Math.min(...totals) : 0,
    };
    setSession((s) => ({ ...s, result: res, generated: res, resultBasis: basis }));
    setRevealed(true);
    setDraft(null);
  }

  const teamNote: { tone: "info" | "warn" | "ok"; text: string } = (() => {
    if (playerCount === 0) {
      return { tone: "info", text: "Add players to get started — 5 per team." };
    }
    if (numTeams < 2) {
      const need = 2 * TEAM_SIZE - playerCount;
      return {
        tone: "warn",
        text: `Add ${need} more ${need === 1 ? "player" : "players"} to form 2 teams.`,
      };
    }
    if (remainder !== 0) {
      const need = TEAM_SIZE - remainder;
      return {
        tone: "warn",
        text: `Add ${need} more ${need === 1 ? "player" : "players"} to make ${numTeams + 1} teams.`,
      };
    }
    return { tone: "ok", text: `${numTeams} even teams of ${TEAM_SIZE}.` };
  })();

  function update(id: string, patch: Partial<DraftPlayer>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((prev) => [...prev, makeRow()]);
  }
  function removeRow(id: string) {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.id !== id) : prev));
  }

  function applyBulk() {
    const parsed = parseBulk(bulkText);
    if (parsed.length === 0) {
      setBulkOpen(false);
      return;
    }
    const added = parsed.map((p) => ({ ...makeRow(), name: p.name, mmr: p.mmr, role: p.role, email: p.email }));
    setRows((prev) => {
      const filled = prev.filter((r) => r.name.trim() !== "" || r.mmr.trim() !== "");
      return [...filled, ...added];
    });
    // Register the pasted players by email so their IGN/LR persist across events.
    registerPlayers(
      added
        .filter((r) => (r.email ?? "").trim() !== "" && r.name.trim() !== "")
        .map((r) => ({
          email: (r.email ?? "").trim().toLowerCase(),
          ign: r.name.trim(),
          mmr: Math.round(Number(r.mmr) || 0),
          position: r.role,
        }))
    );
    setBulkText("");
    setBulkOpen(false);
  }
  function reset() {
    setRows(blankRows(10));
    setSession((s) => ({ ...s, result: null, generated: null }));
    setConfirmReset(false);
    setSearch("");
  }

  async function generate() {
    if (!canGenerate || shuffling) return;
    const players = ready.map((r) => ({
      id: r.id,
      name: r.name.trim(),
      mmr: Math.round(Number(r.mmr)),
      role: r.role,
      email: (r.email ?? "").trim().toLowerCase() || null,
    }));

    setShuffling(true);
    setRevealed(false); // keep the new teams hidden until the user reveals them
    setGenError(null);
    try {
      // Team generation runs on the server (/api/teams). The response is the exact
      // Team shape the bracket + LR sync already consume — nothing else changes.
      const res = await fetch("/api/teams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // "draft" is client-side only and never reaches the balancer.
        body: JSON.stringify({
          players,
          numTeams,
          mode: mode === "draft" ? "mmr" : mode,
          basis,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not generate teams.");
      // Keep a pristine copy alongside the working one so manual edits can be
      // reverted, and pin the basis these teams were built with so the totals on
      // screen keep describing how they were actually balanced.
      const fresh = body as BalanceResult;
      setSession((s) => ({ ...s, result: fresh, generated: fresh, resultBasis: basis }));
      setShuffleKey((k) => k + 1);
    } catch (e) {
      setGenError(e instanceof Error ? e.message : "Could not generate teams.");
    }
    setShuffling(false);
  }

  function sendToBracket() {
    if (!result) return;
    saveTeams(result.teams);
    // Group this bracket's LR/match history under the tournament id.
    startBracketRun(current.id ?? undefined);
    registerPlayers(registryFromTeams(result.teams));
    router.push("/bracket");
  }

  async function refreshList() {
    try {
      const res = await fetch("/api/tournaments");
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not load list.");
      setSavedList(body.tournaments ?? []);
    } catch (e) {
      setSavedList([]);
      setTourneyMsg(e instanceof Error ? e.message : "Could not load list.");
    }
  }

  // Create a fresh tournament and make it the active one (blank roster).
  async function startTournament() {
    const name = newName.trim();
    if (!name || tourneyBusy) return;
    setTourneyBusy(true);
    setTourneyMsg(null);
    try {
      const fresh: BalancerSession = { rows: blankRows(10), mode: "mmr", result: null };
      const res = await fetch("/api/tournaments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, data: fresh }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Could not create tournament.");
      setSession(fresh);
      setRevealed(false);
      setNewName("");
      setSaveState("saved");
      setCurrent({ id: body.tournament.id, name: body.tournament.name });
    } catch (e) {
      setTourneyMsg(e instanceof Error ? e.message : "Create failed.");
    }
    setTourneyBusy(false);
  }

  // Force an immediate save of the current tournament.
  async function saveNow() {
    if (!current.id) return;
    setSaveState("saving");
    try {
      const res = await fetch(`/api/tournaments/${current.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: current.name, data: session }),
      });
      if (!res.ok) throw new Error();
      setSaveState("saved");
    } catch {
      setSaveState("error");
    }
  }

  // Leave the current tournament and go back to the picker (work stays saved).
  function switchTournament() {
    setCurrent(NO_TOURNAMENT);
    void refreshList();
  }

  async function loadTournament(id: string, name: string) {
    setTourneyBusy(true);
    setTourneyMsg(null);
    try {
      const res = await fetch(`/api/tournaments/${id}`);
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? "Load failed.");
      const data = body.tournament?.data as BalancerSession | undefined;
      if (data && Array.isArray(data.rows)) {
        setSession({ rows: data.rows, mode: data.mode ?? "mmr", result: data.result ?? null });
        setRevealed(Boolean(data.result));
        setSaveState("saved");
        setCurrent({ id, name });
      } else {
        setTourneyMsg("That tournament has no saved roster.");
      }
    } catch (e) {
      setTourneyMsg(e instanceof Error ? e.message : "Load failed.");
    }
    setTourneyBusy(false);
  }

  async function deleteTournament(id: string) {
    setTourneyBusy(true);
    try {
      await fetch(`/api/tournaments/${id}`, { method: "DELETE" });
      setSavedList((prev) => (prev ? prev.filter((t) => t.id !== id) : prev));
      if (current.id === id) setCurrent(NO_TOURNAMENT);
    } catch {
      setTourneyMsg("Delete failed.");
    }
    setTourneyBusy(false);
  }

  // One compact, editable player card — used in the tier columns and the
  // not-yet-tiered strip. A card's tier is derived from its MMR, so it lives in
  // whichever column its MMR falls into and moves when the MMR crosses a band.
  const renderCard = (row: DraftPlayer): ReactNode => (
    <div
      key={row.id}
      className="flex items-center gap-1.5 rounded-lg border border-[var(--panel-border)] bg-white/[0.02] p-1.5"
    >
      <input
        value={row.name}
        onChange={(e) => update(row.id, { name: e.target.value })}
        placeholder="Player name"
        className="field min-w-0 flex-1 rounded-md px-2 py-1.5 text-[12px]"
      />
      <input
        value={row.mmr}
        onChange={(e) =>
          update(row.id, { mmr: e.target.value.replace(/[^0-9]/g, "").slice(0, 5) })
        }
        inputMode="numeric"
        maxLength={5}
        placeholder="MMR"
        className="field w-12 shrink-0 rounded-md px-1 py-1.5 text-center text-[12px] tabular-nums"
      />
      <select
        value={row.role ?? ""}
        onChange={(e) =>
          update(row.id, { role: e.target.value ? (Number(e.target.value) as Role) : null })
        }
        className="field w-16 shrink-0 rounded-md px-1 py-1.5 text-[11px]"
      >
        <option value="">Any</option>
        {ROLES.map((r) => (
          <option key={r} value={r}>
            POS {r}
          </option>
        ))}
      </select>
      <button
        onClick={() => removeRow(row.id)}
        aria-label="Remove player"
        className="shrink-0 rounded px-0.5 text-sm leading-none text-zinc-500 transition-colors hover:text-red-400"
      >
        ✕
      </button>
    </div>
  );

  const unrankedRows = rows.filter((r) => tierOf(r.mmr) === null);

  // Gate: pick or create a tournament before building a roster.
  if (!current.id) {
    return (
      <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
        <header className="flex flex-col gap-3 text-center">
          <h1 className="gradient-text text-4xl font-extrabold tracking-tight sm:text-5xl">
            New Tournament
          </h1>
          <p className="text-zinc-400">
            Loungee Tournament
          </p>
        </header>

        <div className="panel flex flex-col gap-3 rounded-2xl p-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void startTournament();
            }}
            className="flex flex-wrap items-center gap-2"
          >
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="e.g. Micro Tournament #1"
              autoFocus
              className="field min-w-48 flex-1 rounded-lg px-3 py-2.5 text-sm"
            />
            <button
              type="submit"
              disabled={tourneyBusy || newName.trim() === ""}
              className="btn-neon rounded-full px-6 py-2.5 text-sm"
            >
              Start →
            </button>
          </form>
          {tourneyMsg && <p className="text-xs text-red-300">{tourneyMsg}</p>}
        </div>

        <div className="panel flex flex-col gap-1.5 rounded-2xl p-5">
          <span className="px-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
            History
          </span>
          {savedList === null ? (
            <p className="text-sm text-zinc-500">Loading…</p>
          ) : savedList.length === 0 ? (
            <p className="text-sm text-zinc-500">No saved tournaments yet.</p>
          ) : (
            savedList.map((t) => (
              <div
                key={t.id}
                className="group flex items-center gap-2 rounded-md text-sm transition-colors hover:bg-white/5"
              >
                <button
                  onClick={() => loadTournament(t.id, t.name)}
                  disabled={tourneyBusy}
                  className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-2 text-left"
                >
                  <span className="truncate font-semibold">{t.name}</span>
                  <span className="ml-auto shrink-0 text-xs text-zinc-500">
                    {new Date(t.created_at).toLocaleDateString()}
                  </span>
                </button>
                <button
                  onClick={() => {
                    if (confirmDelete === t.id) deleteTournament(t.id);
                    else setConfirmDelete(t.id);
                  }}
                  onBlur={() => setConfirmDelete(null)}
                  disabled={tourneyBusy}
                  aria-label={confirmDelete === t.id ? "Confirm delete" : "Delete tournament"}
                  className={`shrink-0 rounded-md px-2 py-2 text-xs font-semibold transition-colors ${
                    confirmDelete === t.id
                      ? "text-red-400"
                      : "text-zinc-600 hover:text-red-400 group-hover:text-zinc-400"
                  }`}
                >
                  {confirmDelete === t.id ? "Sure?" : "✕"}
                </button>
              </div>
            ))
          )}
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-10 px-6 py-12">
      <header className="flex flex-col gap-3 text-center sm:text-left">
        <h1 className="gradient-text text-4xl font-extrabold tracking-tight sm:text-5xl">
          Build Balanced Teams
        </h1>
        <p className="max-w-xl text-zinc-400">
          Loungee Tournament Organizer.
        </p>
      </header>

      {/* Active tournament */}
      <div className="panel flex flex-wrap items-center gap-3 rounded-2xl p-4">
        <div className="flex min-w-0 flex-col">
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Tournament
          </span>
          <span className="truncate text-lg font-bold text-zinc-100">{current.name}</span>
        </div>
        <span
          className={`flex items-center gap-1.5 text-xs ${
            saveState === "error" ? "text-amber-300" : "text-zinc-500"
          }`}
        >
          {saveState === "saving" && (
            <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-zinc-400" />
          )}
          {saveState === "saved" && <span className="text-emerald-400">✓</span>}
          {saveState === "saving"
            ? "Saving…"
            : saveState === "saved"
              ? "All changes saved"
              : saveState === "error"
                ? "Save failed — retrying on next edit"
                : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={saveNow}
            disabled={saveState === "saving"}
            className="rounded-full border border-[var(--panel-border)] px-4 py-2 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/5"
          >
            Save now
          </button>
          <button
            onClick={switchTournament}
            className="rounded-full border border-[var(--panel-border)] px-4 py-2 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/5"
          >
            Switch
          </button>
        </div>
      </div>

      {/* Strategy + basis. The mode decides HOW teams are built; the basis
          decides WHAT strength is measured by. Random ignores the basis. */}
      <div className="flex flex-col gap-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {MODES.map((m) => {
            const active = mode === m.key;
            return (
              <button
                key={m.key}
                onClick={() => setMode(m.key)}
                aria-pressed={active}
                className={`panel flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-all ${
                  active
                    ? "ring-1 ring-[var(--accent)]"
                    : "opacity-70 hover:opacity-100"
                }`}
              >
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${
                    active ? "bg-[var(--accent)]" : "bg-zinc-600"
                  }`}
                />
                <span className="flex flex-col">
                  <span className="font-semibold">{m.label}</span>
                  <span className="text-xs text-zinc-400">
                    {m.key === "random"
                      ? m.hint
                      : m.key === "draft"
                        ? `Top ${basis === "lr" ? "LR" : "MMR"} captains`
                        : `${m.hint} · by ${basis === "lr" ? "LR" : "MMR"}`}
                  </span>
                </span>
              </button>
            );
          })}
        </div>

        <div
          className={`flex flex-wrap items-center gap-3 transition-opacity ${
            mode === "random" ? "opacity-40" : ""
          }`}
        >
          <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
            Balance by
          </span>
          <div className="panel flex rounded-full p-1">
            {BASES.map((b) => (
              <button
                key={b.key}
                onClick={() => setBasis(b.key)}
                disabled={mode === "random"}
                title={b.hint}
                aria-pressed={basis === b.key}
                className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
                  basis === b.key ? "btn-neon" : "text-zinc-400 hover:text-white"
                }`}
              >
                {b.label}
              </button>
            ))}
          </div>
          <span className="text-xs text-zinc-500">
            {mode === "random"
              ? "Random ignores skill entirely."
              : mode === "draft"
                ? `Captains are the top ${basis === "lr" ? "LR" : "MMR"} players; cards show ${basis === "lr" ? "LR" : "MMR"}.`
                : BASES.find((b) => b.key === basis)?.hint}
          </span>
        </div>
      </div>

      {/* Player roster input — players auto-sort into MMR tier columns.
          Breaks out of the centered column to use the full screen width so the
          five tier columns stay wide enough to read player names. */}
      <section className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen px-6">
        <div className="panel mx-auto flex max-w-[1800px] flex-col gap-4 rounded-2xl p-4">
        {/* Roster toolbar: search + live health counts */}
        <div className="flex flex-wrap items-center gap-3 border-b border-[var(--panel-border)] pb-3">
          <div className="relative">
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search players…"
              className="field w-56 rounded-lg py-1.5 pl-8 pr-8 text-sm"
            />
            <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-zinc-500">
              ⌕
            </span>
            {search !== "" && (
              <button
                onClick={() => setSearch("")}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-zinc-500 hover:text-white"
              >
                ✕
              </button>
            )}
          </div>

          <span className="text-sm text-zinc-400">
            <span className="font-bold tabular-nums text-zinc-100">{playerCount}</span> ready
            {rosterIssues.filled !== playerCount && (
              <span className="text-zinc-500"> · {rosterIssues.filled} rows</span>
            )}
          </span>

          {/* Only the problems that actually drop a player from the pool. */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            {rosterIssues.missingMmr.length > 0 && (
              <span className="rounded-full bg-amber-400/10 px-2 py-0.5 font-semibold text-amber-300">
                {rosterIssues.missingMmr.length} missing MMR
              </span>
            )}
            {rosterIssues.missingName.length > 0 && (
              <span className="rounded-full bg-amber-400/10 px-2 py-0.5 font-semibold text-amber-300">
                {rosterIssues.missingName.length} missing name
              </span>
            )}
            {rosterIssues.dupes.length > 0 && (
              <span className="rounded-full bg-red-400/10 px-2 py-0.5 font-semibold text-red-300">
                {rosterIssues.dupes.length} duplicate
              </span>
            )}
            {rosterIssues.noEmail.length > 0 && (
              <span
                title="Players without an email are not tracked on the LR leaderboard."
                className="rounded-full bg-white/5 px-2 py-0.5 font-semibold text-zinc-400"
              >
                {rosterIssues.noEmail.length} no email
              </span>
            )}
          </div>

          <div className="ml-auto flex items-center gap-3">
            <button
              onClick={addRow}
              className="text-sm font-semibold text-[var(--lg-glow)] transition-opacity hover:opacity-80"
            >
              + Add player
            </button>
            <button
              onClick={() => setBulkOpen((o) => !o)}
              className="text-sm font-semibold text-zinc-400 transition-opacity hover:opacity-80"
            >
              Bulk add
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {TIERS.map((t) => {
            const tierAll = rows.filter((r) => tierOf(r.mmr) === t.n);
            const tierRows = tierAll.filter(matchesSearch);
            return (
              <div
                key={t.n}
                className="flex min-w-0 flex-col gap-3 rounded-xl border border-[var(--panel-border)] bg-black/20 p-3"
              >
                <div className="flex flex-col gap-0.5 border-b border-[var(--panel-border)] pb-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold uppercase tracking-wider text-zinc-100">
                      Tier {t.n}
                    </span>
                    <span className="ml-auto rounded-full bg-white/5 px-2 py-0.5 text-[11px] tabular-nums text-zinc-400">
                      {search.trim() !== "" && tierRows.length !== tierAll.length
                        ? `${tierRows.length}/${tierAll.length}`
                        : tierAll.length}
                    </span>
                  </div>
                  <span className="text-[11px] text-zinc-500">{t.range} MMR</span>
                </div>
                <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
                  {tierRows.length === 0 ? (
                    <p className="px-1 py-3 text-center text-[11px] text-zinc-600">
                      {search.trim() !== "" && tierAll.length > 0 ? "No match" : "No players"}
                    </p>
                  ) : (
                    tierRows.map(renderCard)
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {unrankedRows.length > 0 && (
          <div className="flex flex-col gap-3 rounded-xl border border-dashed border-amber-400/25 bg-amber-400/[0.03] p-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-amber-300/80">
              No MMR yet · {unrankedRows.length} — these are excluded until an MMR is set
            </span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {unrankedRows.filter(matchesSearch).map(renderCard)}
            </div>
          </div>
        )}

        {bulkOpen && (
          <div className="animate-fade-up flex flex-col gap-2 rounded-xl border border-[var(--panel-border)] bg-white/[0.02] p-3">
            <p className="text-xs text-zinc-400">
              Paste rows from Google Sheets / Excel — columns:{" "}
              <span className="text-zinc-300">Email · IGN · MMR · Position</span> (tab or comma
              separated). Email is stored to track LR and is never shown; position optional.
            </p>
            <textarea
              value={bulkText}
              onChange={(e) => setBulkText(e.target.value)}
              rows={6}
              placeholder={"euru@mail.com\teuruuu\t6000\t1\nwinter@mail.com\twinter\t3700\t2\njmae@mail.com\tJULIA MAE\t1900"}
              className="field min-h-32 w-full rounded-lg px-3 py-2 font-mono text-xs"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => {
                  setBulkOpen(false);
                  setBulkText("");
                }}
                className="rounded-full border border-[var(--panel-border)] px-4 py-2 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/5"
              >
                Cancel
              </button>
              <button
                onClick={applyBulk}
                disabled={bulkText.trim() === ""}
                className="btn-neon rounded-full px-5 py-2 text-sm"
              >
                Add players
              </button>
            </div>
          </div>
        )}
        </div>
      </section>

      {/* Controls */}
      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="text-zinc-400">Teams</span>
            <span className="rounded-lg border border-[var(--panel-border)] bg-white/[0.03] px-3 py-1.5 text-base font-extrabold tabular-nums text-[var(--lg-glow)]">
              {numTeams}
            </span>
            <span className="text-zinc-500">
              · <span className="font-semibold text-zinc-300">{playerCount}</span> players · 5 per
              team
            </span>
          </div>

          <div className="ml-auto flex items-center gap-2">
            {confirmReset ? (
              <div className="flex items-center gap-2 rounded-full border border-red-400/30 bg-red-400/10 px-3 py-1.5">
                <span className="text-xs text-red-200">
                  Clear {playerCount} player{playerCount === 1 ? "" : "s"}?
                </span>
                <button
                  onClick={reset}
                  className="rounded-full bg-red-500/80 px-3 py-1 text-xs font-semibold text-white transition-colors hover:bg-red-500"
                >
                  Yes, clear
                </button>
                <button
                  onClick={() => setConfirmReset(false)}
                  className="px-1 text-xs font-semibold text-zinc-300 hover:text-white"
                >
                  Cancel
                </button>
              </div>
            ) : (
              <button
                onClick={() => (rosterIssues.filled === 0 ? reset() : setConfirmReset(true))}
                className="rounded-full border border-[var(--panel-border)] px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/5"
              >
                Reset
              </button>
            )}
            <button
              onClick={mode === "draft" ? beginDraft : generate}
              disabled={!canGenerate || shuffling}
              title={
                canGenerate
                  ? `${
                      mode === "random"
                        ? "Random"
                        : mode === "draft"
                          ? `Captain's Draft by ${basis === "lr" ? "LR" : "MMR"}`
                          : `Balance by ${basis === "lr" ? "LR" : "MMR"}`
                    } · ${numTeams} teams`
                  : "Need at least 2 full teams"
              }
              className="btn-neon flex items-center gap-2 rounded-full px-6 py-2.5 text-sm"
            >
              {shuffling && (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              )}
              {shuffling
                ? "Shuffling…"
                : mode === "draft"
                  ? draft
                    ? "Restart Draft"
                    : "Start Draft"
                  : result
                    ? "Reshuffle"
                    : "Generate Teams"}
            </button>
          </div>
        </div>

        {/* Auto team-count status */}
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
            teamNote.tone === "warn"
              ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
              : teamNote.tone === "ok"
                ? "border-[var(--panel-border)] bg-[var(--lg-primary)]/10 text-[var(--lg-glow)]"
                : "border-[var(--panel-border)] text-zinc-400"
          }`}
        >
          <span>{teamNote.text}</span>
        </div>

        {genError && (
          <div className="flex items-center gap-2 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-200">
            <span>{genError}</span>
          </div>
        )}
      </div>

      {/* Celebration overlay for the pick just revealed. Keyed by pick number so
          every pick remounts it and replays the confetti from the start. */}
      {reveal && (
        <DraftReveal
          key={reveal.key}
          name={reveal.name}
          role={reveal.role}
          rating={reveal.rating}
          unit={unit}
          teamId={reveal.teamId}
          accent={reveal.accent}
        />
      )}

      {/* Captain's Draft board */}
      {draft && (
        <section className="flex flex-col gap-5">
          {/* Status bar: who's on the clock, progress, controls */}
          <div className="panel flex flex-wrap items-center gap-3 rounded-2xl p-4">
            {draftComplete(draft) ? (
              <div className="flex min-w-0 flex-col">
                <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
                  Draft complete
                </span>
                <span className="text-lg font-bold text-zinc-100">
                  All {draft.teams.length} teams are full
                </span>
              </div>
            ) : (
              <div className="flex min-w-0 flex-col">
                <span className="text-xs font-semibold uppercase tracking-wider text-zinc-500">
                  On the clock · round {draft.history.length / draft.teams.length < 1
                    ? 1
                    : Math.floor(draft.history.length / draft.teams.length) + 1}
                </span>
                <span
                  className="truncate text-lg font-bold"
                  style={{ color: TEAM_ACCENTS[draft.turn % TEAM_ACCENTS.length] }}
                >
                  Team {draft.teams[draft.turn]?.id} — {draft.teams[draft.turn]?.captain.name}
                </span>
              </div>
            )}

            <span className="text-sm text-zinc-400">
              <span className="font-bold tabular-nums text-zinc-100">{draft.history.length}</span>
              {" / "}
              <span className="tabular-nums">
                {draft.teams.length * draft.teamSize - draft.teams.length}
              </span>{" "}
              picked
              <span className="ml-2 text-zinc-600">·</span>
              <span className="ml-2 text-zinc-500">{draft.pool.length} left</span>
            </span>

            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={() => setDraft(draftUndo(draft))}
                disabled={draft.history.length === 0}
                className="rounded-full border border-[var(--panel-border)] px-4 py-2 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/5 disabled:opacity-40"
              >
                Undo
              </button>
              <button
                onClick={() => setDraft(null)}
                className="rounded-full border border-[var(--panel-border)] px-4 py-2 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/5"
              >
                Cancel
              </button>
              {draftComplete(draft) && (
                <button onClick={finishDraft} className="btn-neon rounded-full px-6 py-2 text-sm">
                  Use these teams →
                </button>
              )}
            </div>
          </div>

          {/* Face-down offer */}
          {!draftComplete(draft) && (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-zinc-400">
                Pick one of {Math.min(OFFER_SIZE, draft.pool.length)} — names are hidden until
                chosen. Showing role and {unit}.
              </p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {draft.offer.map((p, i) => (
                  <button
                    key={p.id}
                    onClick={() => takePick(p.id)}
                    disabled={reveal !== null}
                    className="panel animate-pop group flex flex-col items-center gap-2 rounded-xl p-4 text-center transition-all hover:-translate-y-0.5 hover:ring-1 hover:ring-[var(--accent)] disabled:pointer-events-none disabled:opacity-50"
                    style={{ animationDelay: `${i * 50}ms` }}
                  >
                    <span className="text-3xl opacity-30 transition-opacity group-hover:opacity-60">
                      ?
                    </span>
                    <span className="text-xl font-extrabold tabular-nums text-zinc-100">
                      {weightOf(p)}
                    </span>
                    <span className="text-[11px] uppercase tracking-wider text-zinc-500">
                      {unit}
                    </span>
                    <span className="rounded-full bg-white/5 px-2 py-0.5 text-[11px] font-semibold text-zinc-300">
                      {p.role ? ROLE_LABELS[p.role] : "Any role"}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Live teams */}
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {draft.teams.map((t, i) => {
              const accent = TEAM_ACCENTS[i % TEAM_ACCENTS.length];
              const onClock = !draftComplete(draft) && draft.turn === i;
              const total = t.players.reduce((s, p) => s + weightOf(p), 0);
              return (
                <div
                  key={t.id}
                  className={`panel rounded-xl p-3.5 transition-all ${
                    onClock ? "ring-1 ring-[var(--accent)]" : ""
                  }`}
                  style={{ borderColor: accent }}
                >
                  <div className="mb-2.5 flex items-baseline justify-between gap-1">
                    <h2 className="text-base font-extrabold" style={{ color: accent }}>
                      Team {t.id}
                    </h2>
                    <span className="text-[11px] font-bold tabular-nums text-zinc-200">
                      {total} {unit}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {t.players.map((p) => (
                      <li
                        key={p.id}
                        className="flex items-center justify-between gap-2 text-[13px]"
                      >
                        <span className="flex items-center gap-1.5 truncate">
                          {p.id === t.captain.id && (
                            <span
                              title="Captain"
                              className="shrink-0 rounded bg-[var(--accent)]/20 px-1 text-[10px] font-bold text-[var(--lg-glow)]"
                            >
                              C
                            </span>
                          )}
                          {p.role && (
                            <span
                              title={ROLE_LABELS[p.role]}
                              className="shrink-0 rounded bg-white/10 px-1 text-[10px] font-bold tabular-nums text-zinc-300"
                            >
                              {p.role}
                            </span>
                          )}
                          <span className="truncate font-medium">{p.name}</span>
                        </span>
                        <span className="shrink-0 tabular-nums text-zinc-400">{weightOf(p)}</span>
                      </li>
                    ))}
                    {Array.from({ length: Math.max(0, draft.teamSize - t.players.length) }).map(
                      (_, k) => (
                        <li
                          key={`empty-${k}`}
                          className="rounded border border-dashed border-[var(--panel-border)] px-1 py-1 text-[13px] text-zinc-700"
                        >
                          —
                        </li>
                      )
                    )}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Teams ready but hidden — reveal on demand */}
      {result && !revealed && (
        <section className="panel flex flex-col items-center gap-4 rounded-2xl py-14 text-center">
          <p className="text-lg font-semibold text-zinc-100">
            {result.teams.length} teams are ready.
          </p>
          <p className="-mt-2 text-sm text-zinc-500">
            Balanced by {mode === "random" ? "random shuffle" : unit} · hidden until you reveal them.
          </p>
          <button
            onClick={() => setRevealed(true)}
            className="btn-neon rounded-full px-8 py-3 text-sm"
          >
            Show Teams
          </button>
        </section>
      )}

      {/* Results */}
      {result && revealed && (
        <section key={shuffleKey} className="flex flex-col gap-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex flex-wrap items-center gap-x-2 text-sm text-zinc-400">
              <span>
                {unit} spread:{" "}
                <span
                  className={`font-bold ${
                    !edited
                      ? "text-[var(--lg-glow)]"
                      : liveSpread < baseSpread
                        ? "text-emerald-400"
                        : liveSpread > baseSpread
                          ? "text-red-400"
                          : "text-[var(--lg-glow)]"
                  }`}
                >
                  {liveSpread}
                </span>
              </span>
              {edited && liveSpread !== baseSpread && (
                <span
                  className={liveSpread < baseSpread ? "text-emerald-400" : "text-red-400"}
                  title={`Generated spread was ${baseSpread}`}
                >
                  ({liveSpread < baseSpread ? "−" : "+"}
                  {Math.abs(liveSpread - baseSpread)} vs generated)
                </span>
              )}
              <span className="text-zinc-600">·</span>
              <span className="text-zinc-500">
                {MODES.find((m) => m.key === mode)?.label ?? mode}
              </span>
              {edited && (
                <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-xs font-semibold text-amber-300">
                  edited
                </span>
              )}
            </p>
            <div className="flex items-center gap-2">
              {edited && (
                <button
                  onClick={revertTeams}
                  className="rounded-full border border-[var(--panel-border)] px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/5"
                >
                  Revert to generated
                </button>
              )}
              <button onClick={sendToBracket} className="btn-neon rounded-full px-6 py-2.5 text-sm">
                Send to Bracket →
              </button>
            </div>
          </div>
          <p className="-mt-2 text-xs text-zinc-500">
            {picked ? (
              <span className="text-[var(--lg-glow)]">
                Now pick who to swap with — or tap the same player to cancel.
              </span>
            ) : (
              <>
                Drag a player onto another to swap them — or tap one, then the other. Team{" "}
                {unit} updates as you go.
              </>
            )}
          </p>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {result.teams.map((team, i) => {
              const accent = TEAM_ACCENTS[i % TEAM_ACCENTS.length];
              return (
                <div
                  key={team.id}
                  onDragOver={(e) => {
                    e.preventDefault(); // allow dropping into the team's open space
                    setDragOver({ teamId: team.id, playerId: null });
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    if (dragging) applyDrop(dragging, { teamId: team.id, playerId: null });
                    setDragging(null);
                    setDragOver(null);
                  }}
                  className={`panel animate-pop rounded-xl p-3.5 transition-shadow ${
                    dragOver?.teamId === team.id && dragging && dragging.teamId !== team.id
                      ? "ring-1 ring-[var(--accent)]"
                      : ""
                  }`}
                  style={{
                    animationDelay: `${i * 60}ms`,
                    borderColor: accent,
                  }}
                >
                  <div className="mb-2.5 flex items-baseline justify-between gap-1">
                    <h2 className="text-base font-extrabold" style={{ color: accent }}>
                      Team {team.id}
                    </h2>
                    <span
                      title={`${team.totalMmr} total MMR · ${team.players.length} players`}
                      className="text-[11px] font-bold tabular-nums text-zinc-200"
                    >
                      {teamLr(team)} {unit}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {team.players.map((p) => {
                      const isDragging = dragging?.playerId === p.id;
                      const isTarget =
                        dragOver?.playerId === p.id && dragging && dragging.playerId !== p.id;
                      const isPicked = picked?.playerId === p.id;
                      return (
                        <li
                          key={p.id}
                          draggable
                          onClick={() => pickPlayer(team.id, p.id)}
                          onDragStart={() => setDragging({ teamId: team.id, playerId: p.id })}
                          onDragEnd={() => {
                            setDragging(null);
                            setDragOver(null);
                          }}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation(); // target this player, not the team
                            setDragOver({ teamId: team.id, playerId: p.id });
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            if (dragging) applyDrop(dragging, { teamId: team.id, playerId: p.id });
                            setDragging(null);
                            setDragOver(null);
                          }}
                          title="Drag onto another player to swap — or tap two players"
                          className={`flex cursor-grab items-center justify-between gap-2 rounded-md px-1 py-0.5 text-[13px] transition-colors active:cursor-grabbing ${
                            isDragging ? "opacity-40" : ""
                          } ${
                            isPicked
                              ? "bg-[var(--accent)]/25 ring-1 ring-[var(--accent)]"
                              : isTarget
                                ? "bg-[var(--accent)]/20 ring-1 ring-[var(--accent)]"
                                : "hover:bg-white/5"
                          }`}
                        >
                          <span className="flex items-center gap-1.5 truncate">
                            {p.role && (
                              <span
                                title={`${p.role}. ${ROLE_LABELS[p.role]}`}
                                className="shrink-0 rounded bg-white/10 px-1 text-[10px] font-bold tabular-nums text-zinc-300"
                              >
                                {p.role}
                              </span>
                            )}
                            <span className="truncate font-medium">{p.name}</span>
                          </span>
                          <span
                            title={
                              resultBasis === "mmr"
                                ? `${lrOf(p.mmr, p.email)} LR`
                                : `${p.mmr} MMR`
                            }
                            className="shrink-0 tabular-nums text-zinc-400"
                          >
                            {weightOf(p)} {unit}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              );
            })}
          </div>
        </section>
      )}
    </main>
  );
}
