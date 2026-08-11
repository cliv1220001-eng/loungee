"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildBracket,
  resolveBracket,
  type BracketFormat,
  type ResolvedMatch,
} from "@/lib/bracket";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CoinPlayer {
  email: string;
  ign: string;
  coins: number;
  lr: number;
}

interface CashinRequest {
  id: string;
  ign: string;
  email: string | null;
  amount: number;
  proof_path: string | null;
  status: "pending" | "approved" | "rejected";
  note: string | null;
  created_at: string;
  proofUrl: string | null;
  match: { email: string; ign: string; coins: number } | null;
}

interface Bet {
  id: string;
  run_id: string;
  match_id: string;
  email: string;
  ign: string;
  team_id: number;
  stake: number;
  kind: "game" | "side";
  status: "open" | "won" | "lost" | "void";
  payout: number;
}

/** Fixed stake tiers for a per-game bet. Side bets have no limit. */
const GAME_TIERS = [20, 50, 100];

interface SavedTournament {
  id: string;
  name: string;
  data: {
    result?: { teams?: { id: number; players: { name?: string; email?: string | null }[] }[] };
    bracketRun?: { format?: BracketFormat; seed?: number; winners?: Record<string, "a" | "b"> };
  } | null;
}

type Tab = "queue" | "cashout" | "balances" | "bets";

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(ids: number[], seed: number): number[] {
  const rnd = mulberry32(seed);
  const arr = [...ids];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function seedFromRunId(runId: string): number {
  let h = 0;
  for (let i = 0; i < runId.length; i++) h = (Math.imul(h, 31) + runId.charCodeAt(i)) | 0;
  return h >>> 0;
}

const coins = (n: number) => `${n.toLocaleString()} 🪙`;

// ---------------------------------------------------------------------------
// Page
// ---------------------------------------------------------------------------

export default function BettingPage() {
  const [tab, setTab] = useState<Tab>("queue");

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-6 py-8">
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Betting</h1>
      </header>

      <div className="mb-6 inline-flex rounded-full bg-black/20 p-1">
        {(
          [
            ["queue", "Cash-In Queue"],
            ["cashout", "Cash Out"],
            ["balances", "Balances"],
            ["bets", "Bets"],
          ] as [Tab, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            aria-pressed={tab === key}
            className={`rounded-full px-5 py-1.5 text-sm font-semibold transition-colors ${
              tab === key ? "btn-neon" : "text-zinc-400 hover:text-white"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "queue" && <CashInQueue />}
      {tab === "cashout" && <CashOutQueue />}
      {tab === "balances" && <Balances />}
      {tab === "bets" && <Bets />}
    </main>
  );
}

// ---------------------------------------------------------------------------
// Cash-Out Queue
// ---------------------------------------------------------------------------

interface CashoutRecord {
  id: string;
  email: string;
  ign: string;
  amount: number;
  method: string | null;
  account: string | null;
  proofUrl: string | null;
  reviewed_by: string | null;
  created_at: string;
}

function CashOutQueue() {
  const [records, setRecords] = useState<CashoutRecord[]>([]);
  const [players, setPlayers] = useState<CoinPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The record-a-cash-out form.
  const [email, setEmail] = useState("");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("GCash");
  const [account, setAccount] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [rRes, pRes] = await Promise.all([fetch("/api/cashout"), fetch("/api/coins")]);
      const rBody = (await rRes.json().catch(() => ({}))) as { requests?: CashoutRecord[] };
      const pBody = (await pRes.json().catch(() => ({}))) as { players?: CoinPlayer[] };
      setRecords(rBody.requests ?? []);
      setPlayers(pBody.players ?? []);
    } catch {
      setError("Failed to load cash-outs.");
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const chosen = players.find((p) => p.email === email);

  async function record() {
    setError(null);
    if (!email) return setError("Choose a player.");
    if (!(Number(amount) > 0)) return setError("Enter an amount.");
    if (chosen && chosen.coins < Number(amount)) return setError("Player doesn't have that many coins.");
    if (!file) return setError("Attach the payout proof screenshot.");

    setBusy(true);
    try {
      const fd = new FormData();
      fd.set("email", email);
      fd.set("amount", String(Math.trunc(Number(amount))));
      fd.set("method", method);
      fd.set("account", account);
      fd.set("proof", file);
      const res = await fetch("/api/cashout", { method: "POST", body: fd });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Failed to record cash-out.");
      }
      setEmail("");
      setAmount("");
      setAccount("");
      setFile(null);
      if (fileRef.current) fileRef.current.value = "";
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to record cash-out.");
    }
    setBusy(false);
  }

  return (
    <section className="flex flex-col gap-5">
      {/* Record a cash-out */}
      <div className="panel flex flex-col gap-3 rounded-2xl p-4">
        <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Record a cash-out</h3>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-zinc-500">Player</span>
            <select
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="field rounded-lg px-2 py-1.5 text-sm"
            >
              <option value="">Choose…</option>
              {players.map((p) => (
                <option key={p.email} value={p.email}>
                  {p.ign} ({coins(p.coins)})
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-zinc-500">Amount (coins)</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9]/g, ""))}
              inputMode="numeric"
              placeholder="e.g. 200"
              className="field w-28 rounded-lg px-2 py-1.5 text-sm tabular-nums"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-zinc-500">Method</span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="field rounded-lg px-2 py-1.5 text-sm"
            >
              <option>GCash</option>
              <option>Maya</option>
              <option>Bank</option>
              <option>Other</option>
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-zinc-500">Account</span>
            <input
              value={account}
              onChange={(e) => setAccount(e.target.value)}
              placeholder="Sent to…"
              className="field w-40 rounded-lg px-2 py-1.5 text-sm"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            <span className="text-xs text-zinc-500">Proof (required)</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/*"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              className="field rounded-lg px-2 py-1 text-sm file:mr-2 file:rounded-full file:border-0 file:bg-[var(--accent)]/20 file:px-2 file:py-0.5 file:text-xs file:font-semibold file:text-[var(--lg-glow)]"
            />
          </label>
          <button onClick={record} disabled={busy} className="btn-neon rounded-full px-5 py-2 text-sm">
            {busy ? "Recording…" : "Record cash-out"}
          </button>
        </div>
        {chosen && (
          <p className="text-xs text-zinc-500">
            {chosen.ign} balance: <span className="text-[var(--lg-glow)]">{coins(chosen.coins)}</span>
            {Number(amount) > 0 && (
              <> → after: {coins(chosen.coins - Math.trunc(Number(amount)))}</>
            )}
          </p>
        )}
        {error && <p className="text-sm font-medium text-red-400">{error}</p>}
      </div>

      {/* History */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-bold uppercase tracking-wider text-zinc-400">Recorded cash-outs</h3>
        <button onClick={load} className="text-xs font-semibold text-zinc-400 hover:text-white">
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : records.length === 0 ? (
        <p className="panel rounded-2xl px-6 py-10 text-center text-sm text-zinc-500">
          No cash-outs recorded yet.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {records.map((r) => (
            <li key={r.id} className="panel flex flex-wrap items-center gap-3 rounded-2xl p-4">
              {r.proofUrl ? (
                <a href={r.proofUrl} target="_blank" rel="noreferrer" className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.proofUrl}
                    alt="Payout proof"
                    className="h-16 w-16 rounded-lg border border-[var(--panel-border)] object-cover"
                  />
                </a>
              ) : (
                <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--panel-border)] text-[10px] text-zinc-600">
                  no proof
                </div>
              )}
              <div className="flex min-w-0 flex-col">
                <span className="text-lg font-bold text-zinc-100">{r.ign}</span>
                <span className="text-xs text-zinc-500">
                  {r.method ?? "—"} · {r.account ?? "no account"}
                </span>
              </div>
              <span className="text-lg font-extrabold tabular-nums text-red-400">
                −{coins(r.amount)}
              </span>
              <StatusChip status="paid" />
              <span className="ml-auto text-right text-xs text-zinc-500">
                by {r.reviewed_by ?? "—"}
                <br />
                {new Date(r.created_at).toLocaleString()}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Cash-In Queue
// ---------------------------------------------------------------------------

function CashInQueue() {
  const [requests, setRequests] = useState<CashinRequest[]>([]);
  const [players, setPlayers] = useState<CoinPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"pending" | "approved" | "rejected" | "all">("all");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-request chosen target player email (defaults to the IGN match).
  const [target, setTarget] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const q = filter === "all" ? "" : `?status=${filter}`;
      const [rRes, pRes] = await Promise.all([
        fetch(`/api/cashin${q}`),
        fetch("/api/coins"),
      ]);
      const rBody = (await rRes.json().catch(() => ({}))) as { requests?: CashinRequest[] };
      const pBody = (await pRes.json().catch(() => ({}))) as { players?: CoinPlayer[] };
      setRequests(rBody.requests ?? []);
      setPlayers(pBody.players ?? []);
    } catch {
      setError("Failed to load cash-in requests.");
    }
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    // Mount/refilter load. setState happens inside load's async body after the
    // fetch, but the compiler lints the synchronous setLoading(true) — this is a
    // genuine on-mount data load, so the rule is disabled here intentionally.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function approve(r: CashinRequest) {
    setBusy(r.id);
    setError(null);
    try {
      const chosen = target[r.id] ?? r.match?.email ?? "";
      const body = chosen ? { email: chosen } : { newIgn: r.ign };
      const res = await fetch(`/api/cashin/${r.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(b.error ?? "Approve failed.");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Approve failed.");
    }
    setBusy(null);
  }

  async function reject(r: CashinRequest) {
    setBusy(r.id);
    setError(null);
    try {
      const res = await fetch(`/api/cashin/${r.id}/reject`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error("Reject failed.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reject failed.");
    }
    setBusy(null);
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex items-center gap-2">
        {(["pending", "approved", "rejected", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${
              filter === f
                ? "bg-[var(--accent)]/20 text-[var(--lg-glow)]"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {f}
          </button>
        ))}
        <button onClick={load} className="ml-auto text-xs font-semibold text-zinc-400 hover:text-white">
          ↻ Refresh
        </button>
      </div>

      {error && <p className="text-sm font-medium text-red-400">{error}</p>}

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : requests.length === 0 ? (
        <p className="panel rounded-2xl px-6 py-10 text-center text-sm text-zinc-500">
          No {filter === "all" ? "" : filter} requests.
        </p>
      ) : (
        <ul className="flex flex-col gap-3">
          {requests.map((r) => (
            <li key={r.id} className="panel flex flex-col gap-3 rounded-2xl p-4 sm:flex-row">
              {r.proofUrl ? (
                <a href={r.proofUrl} target="_blank" rel="noreferrer" className="shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={r.proofUrl}
                    alt="Payment proof"
                    className="h-28 w-28 rounded-lg border border-[var(--panel-border)] object-cover"
                  />
                </a>
              ) : (
                <div className="flex h-28 w-28 shrink-0 items-center justify-center rounded-lg border border-dashed border-[var(--panel-border)] text-xs text-zinc-600">
                  no proof
                </div>
              )}

              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-lg font-bold text-zinc-100">{r.ign}</span>
                  <span className="text-lg font-extrabold tabular-nums text-[var(--lg-glow)]">
                    {coins(r.amount)}
                  </span>
                  <StatusChip status={r.status} />
                  <span className="ml-auto text-xs text-zinc-500">
                    {new Date(r.created_at).toLocaleString()}
                  </span>
                </div>

                {r.status === "pending" ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="text-xs text-zinc-500">Credit to:</label>
                    <select
                      value={target[r.id] ?? r.match?.email ?? ""}
                      onChange={(e) => setTarget((t) => ({ ...t, [r.id]: e.target.value }))}
                      className="field rounded-lg px-2 py-1 text-sm"
                    >
                      <option value="">➕ New player &quot;{r.ign}&quot;</option>
                      {players.map((p) => (
                        <option key={p.email} value={p.email}>
                          {p.ign} ({coins(p.coins)})
                        </option>
                      ))}
                    </select>
                    <button
                      onClick={() => approve(r)}
                      disabled={busy === r.id}
                      className="btn-neon rounded-full px-4 py-1.5 text-sm disabled:opacity-50"
                    >
                      {busy === r.id ? "…" : "Approve"}
                    </button>
                    <button
                      onClick={() => reject(r)}
                      disabled={busy === r.id}
                      className="rounded-full border border-red-400/30 px-4 py-1.5 text-sm font-semibold text-red-300 transition-colors hover:bg-red-400/10 disabled:opacity-50"
                    >
                      Reject
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-zinc-500">
                    {r.status === "approved"
                      ? `Credited to ${r.email ?? "player"}.`
                      : r.note
                        ? `Rejected — ${r.note}`
                        : "Rejected."}
                  </p>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function StatusChip({ status }: { status: string }) {
  const map: Record<string, string> = {
    pending: "bg-amber-400/15 text-amber-300",
    approved: "bg-emerald-400/15 text-emerald-300",
    rejected: "bg-red-400/15 text-red-300",
    open: "bg-sky-400/15 text-sky-300",
    won: "bg-emerald-400/15 text-emerald-300",
    lost: "bg-zinc-500/15 text-zinc-400",
    void: "bg-zinc-500/15 text-zinc-400",
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize ${map[status] ?? ""}`}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

function Balances() {
  const [players, setPlayers] = useState<CoinPlayer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [canEdit, setCanEdit] = useState(false);
  const [adjust, setAdjust] = useState<{ email: string; delta: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const [cRes, meRes] = await Promise.all([fetch("/api/coins"), fetch("/api/me")]);
    const body = (await cRes.json().catch(() => ({}))) as { players?: CoinPlayer[] };
    const me = (await meRes.json().catch(() => ({}))) as { user?: { role?: string } };
    setPlayers(body.players ?? []);
    setCanEdit(me.user?.role === "owner");
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    // Sort by balance desc so the biggest holders read first (like the sheet).
    const list = q ? players.filter((p) => p.ign.toLowerCase().includes(q)) : players;
    return [...list].sort((a, b) => b.coins - a.coins);
  }, [players, search]);

  async function saveAdjust() {
    if (!adjust) return;
    const delta = Math.trunc(Number(adjust.delta));
    if (!delta) return;
    setBusy(true);
    await fetch("/api/coins", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: adjust.email, delta, note: adjust.note || undefined }),
    });
    setAdjust(null);
    setBusy(false);
    await load();
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search IGN…"
          className="field w-full max-w-xs rounded-lg px-3 py-2 text-sm"
        />
        <span className="text-xs text-zinc-500">
          {filtered.length} player{filtered.length === 1 ? "" : "s"}
        </span>
        {!canEdit && (
          <span className="text-xs text-zinc-600">· read-only (owners can edit balances)</span>
        )}
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : filtered.length === 0 ? (
        <p className="panel rounded-2xl px-6 py-10 text-center text-sm text-zinc-500">No players.</p>
      ) : (
        // Dense, spreadsheet-style grid: many player/balance pairs across the
        // width. Each cell is clickable to adjust (owners only). Negatives red.
        <div className="panel grid grid-cols-2 gap-x-4 gap-y-0.5 rounded-2xl p-3 text-sm sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {filtered.map((p) => {
            const neg = p.coins < 0;
            const cell = (
              <div
                className={`flex items-baseline justify-between gap-2 rounded px-2 py-1 ${
                  canEdit ? "cursor-pointer hover:bg-white/5" : ""
                }`}
              >
                <span className="truncate font-medium text-zinc-300" title={p.ign || p.email}>
                  {p.ign || p.email}
                </span>
                <span
                  className={`shrink-0 font-bold tabular-nums ${
                    neg ? "text-red-400" : "text-[var(--lg-glow)]"
                  }`}
                >
                  {p.coins.toLocaleString()}
                </span>
              </div>
            );
            return canEdit ? (
              <button
                key={p.email}
                onClick={() => setAdjust({ email: p.email, delta: "", note: "" })}
                className="text-left"
              >
                {cell}
              </button>
            ) : (
              <div key={p.email}>{cell}</div>
            );
          })}
        </div>
      )}

      {adjust && canEdit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="panel flex w-full max-w-sm flex-col gap-4 rounded-2xl p-6">
            <h3 className="text-lg font-bold text-zinc-100">Adjust balance</h3>
            <p className="text-xs text-zinc-500">
              {players.find((p) => p.email === adjust.email)?.ign ?? adjust.email}
            </p>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-400">Delta (+/- coins)</span>
              <input
                value={adjust.delta}
                onChange={(e) => setAdjust({ ...adjust, delta: e.target.value.replace(/[^0-9-]/g, "") })}
                inputMode="numeric"
                placeholder="e.g. -50"
                className="field rounded-lg px-3 py-2 text-sm tabular-nums"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              <span className="text-zinc-400">Reason (optional)</span>
              <input
                value={adjust.note}
                onChange={(e) => setAdjust({ ...adjust, note: e.target.value })}
                className="field rounded-lg px-3 py-2 text-sm"
              />
            </label>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setAdjust(null)}
                className="rounded-full border border-[var(--panel-border)] px-4 py-2 text-sm font-semibold text-zinc-300"
              >
                Cancel
              </button>
              <button onClick={saveAdjust} disabled={busy} className="btn-neon rounded-full px-5 py-2 text-sm">
                {busy ? "Saving…" : "Apply"}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Bets
// ---------------------------------------------------------------------------

function Bets() {
  const [tournaments, setTournaments] = useState<SavedTournament[]>([]);
  const [runId, setRunId] = useState("");
  const [players, setPlayers] = useState<CoinPlayer[]>([]);
  const [bets, setBets] = useState<Bet[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // New-bet draft, per match id.
  const [draft, setDraft] = useState<
    Record<string, { email: string; teamId: string; stake: string; kind: "game" | "side" }>
  >({});

  useEffect(() => {
    void (async () => {
      const [tRes, pRes] = await Promise.all([fetch("/api/tournaments"), fetch("/api/coins")]);
      const tBody = (await tRes.json().catch(() => ({}))) as { tournaments?: SavedTournament[] };
      const pBody = (await pRes.json().catch(() => ({}))) as { players?: CoinPlayer[] };
      setTournaments(tBody.tournaments ?? []);
      setPlayers(pBody.players ?? []);
    })();
  }, []);

  const current = useMemo(() => tournaments.find((t) => t.id === runId) ?? null, [tournaments, runId]);

  // Build the bracket for the chosen tournament and resolve its matches so we can
  // show each match's two teams and whether it's decided.
  const matches = useMemo(() => {
    if (!current?.data?.result?.teams?.length) return [];
    const teams = current.data.result.teams;
    const seed =
      typeof current.data.bracketRun?.seed === "number"
        ? current.data.bracketRun.seed
        : seedFromRunId(current.id);
    const format = current.data.bracketRun?.format ?? "single";
    const order = seededShuffle(teams.map((t) => t.id), seed);
    if (!order.length) return [];
    const bracket = buildBracket(order, format);
    const resolved = resolveBracket(bracket, current.data.bracketRun?.winners ?? {});
    return Object.values(resolved)
      .filter((m) => m.a.teamId != null && m.b.teamId != null)
      .map((m) => ({
        ...m,
        teamA: m.a.teamId,
        teamB: m.b.teamId,
        championMatch: m.id === bracket.championMatchId,
      })) as (ResolvedMatch & { teamA: number | null; teamB: number | null; championMatch: boolean })[];
  }, [current]);

  const loadBets = useCallback(async (id: string) => {
    if (!id) return;
    setLoading(true);
    const res = await fetch(`/api/bets?runId=${encodeURIComponent(id)}`);
    const body = (await res.json().catch(() => ({}))) as { bets?: Bet[] };
    setBets(body.bets ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (runId) void loadBets(runId);
    else setBets([]);
  }, [runId, loadBets]);

  const emptyDraft = { email: "", teamId: "", stake: "", kind: "game" as const };

  async function placeBet(matchId: string) {
    const d = draft[matchId];
    if (!d?.email || !d.teamId || !(Number(d.stake) > 0)) {
      setError("Choose a player, a team and a positive stake.");
      return;
    }
    if (d.kind === "game" && !GAME_TIERS.includes(Number(d.stake))) {
      setError("Game bets must be 20, 50 or 100 coins.");
      return;
    }
    setError(null);
    const res = await fetch("/api/bets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId,
        matchId,
        email: d.email,
        teamId: Number(d.teamId),
        stake: Number(d.stake),
        kind: d.kind,
      }),
    });
    if (!res.ok) {
      const b = (await res.json().catch(() => ({}))) as { error?: string };
      setError(b.error ?? "Bet failed.");
      return;
    }
    setDraft((s) => ({ ...s, [matchId]: { ...emptyDraft } }));
    await Promise.all([loadBets(runId), refreshPlayers()]);
  }

  async function settle(matchId: string, winningTeamId: number) {
    const res = await fetch("/api/bets/settle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, matchId, winningTeamId }),
    });
    if (res.ok) await Promise.all([loadBets(runId), refreshPlayers()]);
  }

  async function voidBet(id: string) {
    const res = await fetch(`/api/bets/${id}/void`, { method: "POST" });
    if (res.ok) await Promise.all([loadBets(runId), refreshPlayers()]);
  }

  async function refreshPlayers() {
    const res = await fetch("/api/coins");
    const body = (await res.json().catch(() => ({}))) as { players?: CoinPlayer[] };
    setPlayers(body.players ?? []);
  }

  const betsByMatch = useMemo(() => {
    const m = new Map<string, Bet[]>();
    for (const b of bets) {
      const list = m.get(b.match_id) ?? [];
      list.push(b);
      m.set(b.match_id, list);
    }
    return m;
  }, [bets]);

  return (
    <section className="flex flex-col gap-4">
      <select
        value={runId}
        onChange={(e) => setRunId(e.target.value)}
        className="field w-full max-w-md rounded-lg px-3 py-2 text-sm"
      >
        <option value="">Choose a tournament…</option>
        {tournaments.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name}
          </option>
        ))}
      </select>

      {error && <p className="text-sm font-medium text-red-400">{error}</p>}

      {!runId ? (
        <p className="panel rounded-2xl px-6 py-10 text-center text-sm text-zinc-500">
          Pick a tournament to record and settle bets on its matches.
        </p>
      ) : matches.length === 0 ? (
        <p className="panel rounded-2xl px-6 py-10 text-center text-sm text-zinc-500">
          This tournament has no playable matches yet (need at least two real teams
          facing off).
        </p>
      ) : (
        <div className="flex flex-col gap-4">
          {loading && <p className="text-sm text-zinc-500">Loading bets…</p>}
          {matches.map((m) => {
            const d = draft[m.id] ?? emptyDraft;
            const setD = (patch: Partial<typeof d>) =>
              setDraft((s) => ({ ...s, [m.id]: { ...d, ...patch } }));
            const list = betsByMatch.get(m.id) ?? [];
            const winnerTeam = m.decided ? (m.winner === "a" ? m.teamA : m.teamB) : null;
            return (
              <div key={m.id} className="panel flex flex-col gap-3 rounded-2xl p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs font-mono text-zinc-500">{m.id}</span>
                  {m.championMatch && (
                    <span className="rounded-full bg-[var(--accent)]/15 px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--lg-glow)]">
                      Final
                    </span>
                  )}
                  <span className="font-bold text-zinc-100">
                    Team {m.teamA} <span className="text-zinc-600">vs</span> Team {m.teamB}
                  </span>
                  {m.decided && (
                    <span className="ml-2 text-xs font-semibold text-emerald-400">
                      Winner: Team {winnerTeam}
                    </span>
                  )}
                  {m.decided && winnerTeam != null && (
                    <button
                      onClick={() => settle(m.id, winnerTeam)}
                      className="ml-auto rounded-full border border-[var(--panel-border)] px-3 py-1 text-xs font-semibold text-zinc-300 hover:bg-white/5"
                    >
                      Settle bets
                    </button>
                  )}
                </div>

                {/* Place a bet */}
                {!m.decided && (
                  <div className="flex flex-col gap-2">
                    {/* Bet type: game (fixed tiers) vs side (any amount). */}
                    <div className="flex items-center gap-2">
                      <div className="flex rounded-full bg-black/20 p-0.5">
                        {(["game", "side"] as const).map((k) => (
                          <button
                            key={k}
                            onClick={() =>
                              setD({ kind: k, stake: k === "game" && !GAME_TIERS.includes(Number(d.stake)) ? "" : d.stake })
                            }
                            className={`rounded-full px-3 py-1 text-xs font-semibold capitalize transition-colors ${
                              d.kind === k ? "btn-neon" : "text-zinc-400 hover:text-white"
                            }`}
                          >
                            {k === "game" ? "Game bet" : "Side bet"}
                          </button>
                        ))}
                      </div>
                      <span className="text-[11px] text-zinc-500">
                        {d.kind === "game" ? "Fixed 20 / 50 / 100" : "Any amount, no limit"}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={d.email}
                        onChange={(e) => setD({ email: e.target.value })}
                        className="field rounded-lg px-2 py-1 text-sm"
                      >
                        <option value="">Player…</option>
                        {players.map((p) => (
                          <option key={p.email} value={p.email}>
                            {p.ign} ({coins(p.coins)})
                          </option>
                        ))}
                      </select>
                      <select
                        value={d.teamId}
                        onChange={(e) => setD({ teamId: e.target.value })}
                        className="field rounded-lg px-2 py-1 text-sm"
                      >
                        <option value="">Team…</option>
                        <option value={String(m.teamA)}>Team {m.teamA}</option>
                        <option value={String(m.teamB)}>Team {m.teamB}</option>
                      </select>

                      {d.kind === "game" ? (
                        <div className="flex gap-1">
                          {GAME_TIERS.map((tier) => (
                            <button
                              key={tier}
                              onClick={() => setD({ stake: String(tier) })}
                              className={`rounded-lg px-3 py-1 text-sm font-bold tabular-nums transition-colors ${
                                Number(d.stake) === tier
                                  ? "bg-[var(--accent)]/25 text-[var(--lg-glow)]"
                                  : "bg-white/5 text-zinc-300 hover:bg-white/10"
                              }`}
                            >
                              {tier}
                            </button>
                          ))}
                        </div>
                      ) : (
                        <input
                          value={d.stake}
                          onChange={(e) => setD({ stake: e.target.value.replace(/[^0-9]/g, "") })}
                          placeholder="Stake (min 2)"
                          inputMode="numeric"
                          className="field w-28 rounded-lg px-2 py-1 text-sm tabular-nums"
                        />
                      )}

                      <button
                        onClick={() => placeBet(m.id)}
                        className="btn-neon rounded-full px-4 py-1.5 text-sm"
                      >
                        Place bet
                      </button>
                    </div>
                  </div>
                )}

                {/* Existing bets */}
                {list.length > 0 && (
                  <ul className="flex flex-col divide-y divide-[var(--panel-border)]">
                    {list.map((b) => (
                      <li key={b.id} className="flex items-center gap-2 py-1.5 text-sm">
                        <span className="font-medium text-zinc-200">{b.ign}</span>
                        {b.kind === "side" && (
                          <span className="rounded-full bg-[var(--lg-lavender,#7f7a9a)]/20 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--lg-glow)]">
                            Side
                          </span>
                        )}
                        <span className="text-zinc-500">on</span>
                        <span className="font-semibold text-zinc-300">Team {b.team_id}</span>
                        <span className="tabular-nums text-[var(--lg-glow)]">{coins(b.stake)}</span>
                        <StatusChip status={b.status} />
                        {b.status === "won" && (
                          <span className="text-xs font-semibold text-emerald-400">
                            +{coins(b.payout)}
                          </span>
                        )}
                        {b.status === "open" && (
                          <button
                            onClick={() => voidBet(b.id)}
                            className="ml-auto text-xs font-semibold text-zinc-500 hover:text-red-300"
                          >
                            Void
                          </button>
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
