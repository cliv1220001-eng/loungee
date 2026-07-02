"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { generateTeams, type BalanceMode, type BalanceResult } from "@/lib/balance";
import { startingLr } from "@/lib/lr";
import { saveTeams, startBracketRun, usePersistentState } from "@/lib/store";
import { ROLE_LABELS, type Player, type Role, type Team } from "@/lib/types";

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

const MODES: { key: BalanceMode; label: string; hint: string }[] = [
  { key: "mmr", label: "Balance MMR", hint: "Closest total MMR" },
  { key: "role", label: "Spread Roles", hint: "Even roles + MMR" },
  { key: "random", label: "Random", hint: "Shuffle without weighting" },
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
  mode: BalanceMode;
  result: BalanceResult | null;
}

const SESSION_KEY = "dota-balancer:session";
const DEFAULT_SESSION: BalancerSession = { rows: blankRows(10), mode: "mmr", result: null };

// The tournament currently being worked on. Its roster/teams auto-save under this
// name so it can be reloaded from history later.
interface CurrentTournament {
  id: string | null;
  name: string;
}
const CURRENT_KEY = "dota-balancer:tournament";
const NO_TOURNAMENT: CurrentTournament = { id: null, name: "" };

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
  const setRows = (updater: DraftPlayer[] | ((prev: DraftPlayer[]) => DraftPlayer[])) =>
    setSession((s) => ({ ...s, rows: typeof updater === "function" ? updater(s.rows) : updater }));
  const setMode = (next: BalanceMode) => setSession((s) => ({ ...s, mode: next }));
  const setResult = (next: BalanceResult | null) => setSession((s) => ({ ...s, result: next }));

  // Transient UI state (not persisted).
  const [shuffleKey, setShuffleKey] = useState(0);
  const [shuffling, setShuffling] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkText, setBulkText] = useState("");

  // Saved tournaments (Supabase-backed).
  const [current, setCurrent] = usePersistentState<CurrentTournament>(CURRENT_KEY, NO_TOURNAMENT);
  const [newName, setNewName] = useState("");
  const [savedList, setSavedList] = useState<{ id: string; name: string; created_at: string }[] | null>(null);
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

  // Dota teams are 5 players each — the team count follows the player count.
  const TEAM_SIZE = 5;
  const playerCount = ready.length;
  const numTeams = Math.floor(playerCount / TEAM_SIZE);
  const remainder = playerCount % TEAM_SIZE;
  const canGenerate = numTeams >= 2;

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
    setResult(null);
  }

  function generate() {
    if (!canGenerate || shuffling) return;
    const players: Player[] = ready.map((r) => ({
      id: r.id,
      name: r.name.trim(),
      mmr: Math.round(Number(r.mmr)),
      role: r.role,
      email: (r.email ?? "").trim().toLowerCase() || null,
    }));

    // Brief loading beat so the shuffle is visibly "working".
    setShuffling(true);
    setRevealed(false); // keep the new teams hidden until the user reveals them
    window.setTimeout(() => {
      setResult(generateTeams(players, numTeams, mode));
      setShuffleKey((k) => k + 1);
      setShuffling(false);
    }, 1000);
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
              <div key={t.id} className="flex items-center gap-2 text-sm">
                <button
                  onClick={() => loadTournament(t.id, t.name)}
                  disabled={tourneyBusy}
                  className="flex-1 truncate rounded-md px-2 py-2 text-left transition-colors hover:bg-white/5"
                >
                  <span className="font-semibold">{t.name}</span>
                  <span className="ml-2 text-xs text-zinc-500">
                    {new Date(t.created_at).toLocaleDateString()}
                  </span>
                </button>
                <button
                  onClick={() => deleteTournament(t.id)}
                  disabled={tourneyBusy}
                  aria-label="Delete tournament"
                  className="rounded-md px-2 py-2 text-zinc-500 transition-colors hover:text-red-400"
                >
                  ✕
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
        <span className="text-xs text-zinc-500">
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

      {/* Mode selector */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {MODES.map((m) => {
          const active = mode === m.key;
          return (
            <button
              key={m.key}
              onClick={() => setMode(m.key)}
              className={`panel flex items-center gap-3 rounded-xl px-4 py-3 text-left transition-all ${
                active
                  ? "ring-1 ring-[var(--accent)]"
                  : "opacity-70 hover:opacity-100"
              }`}
            >
              <span className="flex flex-col">
                <span className="font-semibold">{m.label}</span>
                <span className="text-xs text-zinc-400">{m.hint}</span>
              </span>
            </button>
          );
        })}
      </div>

      {/* Player roster input — players auto-sort into MMR tier columns.
          Breaks out of the centered column to use the full screen width so the
          five tier columns stay wide enough to read player names. */}
      <section className="relative left-1/2 right-1/2 -ml-[50vw] -mr-[50vw] w-screen px-6">
        <div className="panel mx-auto flex max-w-[1800px] flex-col gap-4 rounded-2xl p-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {TIERS.map((t) => {
            const tierRows = rows.filter((r) => tierOf(r.mmr) === t.n);
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
                      {tierRows.length}
                    </span>
                  </div>
                  <span className="text-[11px] text-zinc-500">{t.range} MMR</span>
                </div>
                <div className="flex max-h-[60vh] flex-col gap-2 overflow-y-auto pr-1">
                  {tierRows.length === 0 ? (
                    <p className="px-1 py-3 text-center text-[11px] text-zinc-600">No players</p>
                  ) : (
                    tierRows.map(renderCard)
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {unrankedRows.length > 0 && (
          <div className="flex flex-col gap-3 rounded-xl border border-dashed border-[var(--panel-border)] p-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
              No MMR yet · {unrankedRows.length}
            </span>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
              {unrankedRows.map(renderCard)}
            </div>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-4">
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

          <div className="ml-auto flex gap-2">
            <button
              onClick={reset}
              className="rounded-full border border-[var(--panel-border)] px-4 py-2.5 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/5"
            >
              Reset
            </button>
            <button
              onClick={generate}
              disabled={!canGenerate || shuffling}
              className="btn-neon flex items-center gap-2 rounded-full px-6 py-2.5 text-sm"
            >
              {shuffling && (
                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
              )}
              {shuffling ? "Shuffling…" : result ? "Reshuffle" : "Generate Teams"}
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
      </div>

      {/* Teams ready but hidden — reveal on demand */}
      {result && !revealed && (
        <section className="panel flex flex-col items-center gap-4 rounded-2xl py-14 text-center">
          <p className="text-zinc-400">Teams are ready.</p>
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
            <p className="text-sm text-zinc-400">
              MMR spread:{" "}
              <span className="font-bold text-[var(--lg-glow)]">{result.spread}</span>
              <span className="ml-2 text-zinc-600">·</span>
              <span className="ml-2 capitalize text-zinc-500">{mode} mode</span>
            </p>
            <button onClick={sendToBracket} className="btn-neon rounded-full px-6 py-2.5 text-sm">
              Send to Bracket →
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {result.teams.map((team, i) => {
              const accent = TEAM_ACCENTS[i % TEAM_ACCENTS.length];
              return (
                <div
                  key={team.id}
                  className="panel animate-pop rounded-xl p-3.5"
                  style={{
                    animationDelay: `${i * 60}ms`,
                    borderColor: accent,
                  }}
                >
                  <div className="mb-2.5 flex items-baseline justify-between gap-1">
                    <h2 className="text-base font-extrabold" style={{ color: accent }}>
                      Team {team.id}
                    </h2>
                    <span className="text-[11px] font-bold tabular-nums text-zinc-200">
                      {team.totalMmr}
                    </span>
                  </div>
                  <ul className="flex flex-col gap-1.5">
                    {team.players.map((p) => (
                      <li key={p.id} className="flex items-center justify-between gap-2 text-[13px]">
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
                          title={`${p.mmr} MMR`}
                          className="shrink-0 tabular-nums text-zinc-400"
                        >
                          {lrOf(p.mmr, p.email)} LR
                        </span>
                      </li>
                    ))}
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
