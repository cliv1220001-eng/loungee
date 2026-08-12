"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import TabPills from "../tab-pills";
import { AdjustIcon, AllIcon, BetsIcon, CashInIcon, CashOutIcon, TeamsIcon, TrophyIcon } from "../icons";

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
  /** Resolved tournament name when target is (or starts with) a tournament id. */
  tournamentName: string | null;
}

interface SettleRow {
  ign: string;
  teamId: number;
  status: string;
  net: number;
  balance: number | null;
}

interface SidePair {
  a: { ign: string; teamId: number; net: number; won: boolean };
  b: { ign: string; teamId: number; net: number; won: boolean } | null;
  stake: number;
}

interface RuneBet {
  ign: string;
  market: string;
  pick: string;
  stake: number;
  mult: number;
  status: string;
  outcome: string | null;
  net: number;
}

/** Friendly market label. */
const MARKET_LABEL: Record<string, string> = {
  "6min": "6-min rune",
  "8min": "8-min rune",
  "10min": "10-min rune",
  "12min": "12-min type",
};

/** Show the tournament name if we have it, else a short id, else the raw target. */
function targetLabel(e: AuditEntry): string {
  if (e.tournamentName) {
    // target may be "<runId>/<matchId>" — keep the match suffix for context.
    const parts = (e.target ?? "").split("/");
    return parts.length > 1 ? `${e.tournamentName} · ${parts[1]}` : e.tournamentName;
  }
  const t = e.target ?? "";
  // Shorten a bare UUID so it isn't a wall of hex.
  return /^[0-9a-f-]{30,}/i.test(t) ? t.slice(0, 8) + "…" : t;
}

/** Friendly labels + colors for each action prefix. */
const ACTION_META: Record<string, { label: string; tone: string }> = {
  login: { label: "Signed in", tone: "text-zinc-400" },
  "cashin.approve": { label: "Approved cash-in", tone: "text-emerald-300" },
  "cashin.reject": { label: "Rejected cash-in", tone: "text-red-300" },
  "cashout.pay": { label: "Recorded cash-out", tone: "text-amber-300" },
  "coins.adjust": { label: "Adjusted balance", tone: "text-amber-300" },
  "bet.place": { label: "Placed bet", tone: "text-sky-300" },
  "bet.side": { label: "Matched side bet", tone: "text-sky-300" },
  "bet.settle": { label: "Settled bets", tone: "text-sky-300" },
  "bet.void": { label: "Voided bet", tone: "text-zinc-400" },
  "tournament.create": { label: "Created tournament", tone: "text-violet-300" },
  "tournament.champion": { label: "Recorded champion", tone: "text-violet-300" },
};

function metaFor(action: string) {
  return ACTION_META[action] ?? { label: action, tone: "text-zinc-400" };
}

function detailText(d: Record<string, unknown> | null): string {
  if (!d) return "";
  const parts: string[] = [];
  if (typeof d.amount === "number") parts.push(`${d.amount} coins`);
  if (typeof d.delta === "number") parts.push(`${d.delta > 0 ? "+" : ""}${d.delta} coins`);
  if (typeof d.stake === "number") parts.push(`stake ${d.stake}`);
  if (typeof d.kind === "string") parts.push(d.kind);
  if (typeof d.winningTeamId === "number") parts.push(`winner Team ${d.winningTeamId}`);
  if (typeof d.note === "string" && d.note) parts.push(`“${d.note}”`);
  return parts.join(" · ");
}

export default function AuditPage() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actor, setActor] = useState("");
  const [group, setGroup] = useState("");
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (actor) params.set("actor", actor);
    if (group) params.set("action", group);
    const res = await fetch(`/api/audit?${params.toString()}`);
    const body = (await res.json().catch(() => ({}))) as { entries?: AuditEntry[] };
    setEntries(body.entries ?? []);
    setLoading(false);
  }, [actor, group]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const actors = useMemo(
    () => [...new Set(entries.map((e) => e.actor))].sort(),
    [entries]
  );

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Audit Logs</h1>
        <p className="text-sm text-zinc-400">Who did what, and when.</p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <TabPills
          size="sm"
          active={group}
          onChange={setGroup}
          tabs={[
            { key: "", label: "All", icon: <AllIcon /> },
            { key: "cashin", label: "Cash-in", icon: <CashInIcon /> },
            { key: "cashout", label: "Cash-out", icon: <CashOutIcon /> },
            { key: "coins", label: "Adjustments", icon: <AdjustIcon /> },
            { key: "bet", label: "Bets", icon: <BetsIcon /> },
            { key: "tournament", label: "Tournaments", icon: <TrophyIcon /> },
            { key: "login", label: "Logins", icon: <TeamsIcon /> },
          ]}
        />
        <select
          value={actor}
          onChange={(e) => setActor(e.target.value)}
          className="field rounded-lg px-2 py-1 text-sm"
        >
          <option value="">All users</option>
          {actors.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button onClick={load} className="ml-auto text-xs font-semibold text-zinc-400 hover:text-white">
          ↻ Refresh
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="panel rounded-2xl px-6 py-10 text-center text-sm text-zinc-500">
          No activity yet.
        </p>
      ) : (
        <ul className="panel flex flex-col divide-y divide-[var(--panel-border)] rounded-2xl">
          {entries.map((e) => {
            const m = metaFor(e.action);
            const detail = detailText(e.detail);
            const tgt = targetLabel(e);
            // A settled match can expand to a per-player breakdown.
            const canExpand = e.action === "bet.settle" && !!e.target?.includes("/");
            const isOpen = expanded === e.id;
            return (
              <li key={e.id} className="flex flex-col">
                <div
                  className={`flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2.5 text-sm ${
                    canExpand ? "cursor-pointer hover:bg-white/[0.03]" : ""
                  }`}
                  onClick={canExpand ? () => setExpanded(isOpen ? null : e.id) : undefined}
                >
                  <span className="font-bold text-zinc-100">{e.actor}</span>
                  <span className={`font-semibold ${m.tone}`}>{m.label}</span>
                  {tgt && <span className="font-medium text-zinc-300">{tgt}</span>}
                  {detail && <span className="text-zinc-500">{detail}</span>}
                  {canExpand && (
                    <span className="text-xs text-zinc-600">{isOpen ? "▲" : "▼ breakdown"}</span>
                  )}
                  <span className="ml-auto text-xs tabular-nums text-zinc-600">
                    {new Date(e.created_at).toLocaleString()}
                  </span>
                </div>
                {canExpand && isOpen && <SettleDetail target={e.target!} />}
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}

/** Per-player win/loss breakdown for a settled match, loaded on expand. */
function SettleDetail({ target }: { target: string }) {
  const [rows, setRows] = useState<SettleRow[] | null>(null);
  const [sideBets, setSideBets] = useState<SidePair[]>([]);
  const [runeBets, setRuneBets] = useState<RuneBet[]>([]);
  const [houseTake, setHouseTake] = useState(0);

  useEffect(() => {
    const [runId, matchId] = target.split("/");
    fetch(`/api/bets/settlement?runId=${encodeURIComponent(runId)}&matchId=${encodeURIComponent(matchId)}`)
      .then((r) => (r.ok ? r.json() : { rows: [] }))
      .then((b: { rows?: SettleRow[]; sideBets?: SidePair[]; runeBets?: RuneBet[]; houseTake?: number }) => {
        setRows(b.rows ?? []);
        setSideBets(b.sideBets ?? []);
        setRuneBets(b.runeBets ?? []);
        setHouseTake(b.houseTake ?? 0);
      })
      .catch(() => setRows([]));
  }, [target]);

  if (rows === null) return <p className="px-4 pb-3 text-xs text-zinc-500">Loading breakdown…</p>;
  if (rows.length === 0 && sideBets.length === 0 && runeBets.length === 0)
    return <p className="px-4 pb-3 text-xs text-zinc-500">No bets on this match.</p>;

  return (
    <div className="flex flex-col gap-3 border-t border-[var(--panel-border)] bg-black/20 px-4 py-3">
      {/* Team bets */}
      {rows.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">Team bet</div>
          <ul className="flex flex-col gap-1 text-sm">
            {rows.map((r, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="w-32 truncate font-medium text-zinc-200">{r.ign}</span>
                <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-400">
                  Team {r.teamId}
                </span>
                <span
                  className={`w-16 text-right font-bold tabular-nums ${
                    r.status === "won" ? "text-emerald-400" : r.status === "lost" ? "text-red-400" : "text-zinc-500"
                  }`}
                >
                  {r.net > 0 ? "+" : ""}
                  {r.net} 🪙
                </span>
                <span className="ml-auto text-xs text-zinc-500">
                  balance{" "}
                  <span className="font-semibold tabular-nums text-[var(--lg-glow)]">
                    {r.balance != null ? r.balance.toLocaleString() : "—"} 🪙
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Side bets — head-to-head pairs */}
      {sideBets.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Side bets (player vs player)
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {sideBets.map((s, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className={`font-medium ${s.a.won ? "text-emerald-400" : "text-red-400"}`}>
                  {s.a.ign}
                </span>
                <span className="text-[10px] text-zinc-600">T{s.a.teamId}</span>
                <span className="text-zinc-500">vs</span>
                <span
                  className={`font-medium ${!s.b ? "text-zinc-500" : s.b.won ? "text-emerald-400" : "text-red-400"}`}
                >
                  {s.b ? s.b.ign : "—"}
                </span>
                {s.b && <span className="text-[10px] text-zinc-600">T{s.b.teamId}</span>}
                <span className="tabular-nums text-[var(--lg-glow)]">{s.stake} 🪙 each</span>
                <span className="ml-auto text-xs font-semibold text-emerald-400">
                  {s.a.won ? s.a.ign : s.b?.won ? s.b.ign : "—"}{" "}
                  {(s.a.won || s.b?.won) && `won ${s.a.won ? "+" + s.a.net : s.b ? "+" + s.b.net : ""} 🪙`}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Rune bets — player vs house */}
      {runeBets.length > 0 && (
        <div className="flex flex-col gap-1">
          <div className="text-[10px] font-bold uppercase tracking-wider text-zinc-500">
            Player vs House (runes)
          </div>
          <ul className="flex flex-col gap-1 text-sm">
            {runeBets.map((r, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2">
                <span className="w-32 truncate font-medium text-zinc-200">{r.ign}</span>
                <span className="text-zinc-400">{MARKET_LABEL[r.market] ?? r.market}</span>
                <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] font-semibold text-zinc-200">
                  {r.pick}
                </span>
                <span className="text-[10px] text-zinc-600">1:{r.mult}</span>
                {r.outcome && (
                  <span className="text-[10px] text-zinc-500">
                    actual: <span className="text-zinc-300">{r.outcome}</span>
                  </span>
                )}
                {r.status === "open" ? (
                  <span className="rounded-full bg-sky-400/15 px-2 py-0.5 text-[10px] font-semibold text-sky-300">
                    open
                  </span>
                ) : (
                  <span
                    className={`w-16 text-right font-bold tabular-nums ${
                      r.status === "won" ? "text-emerald-400" : "text-red-400"
                    }`}
                  >
                    {r.net > 0 ? "+" : ""}
                    {r.net} 🪙
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <p className="border-t border-[var(--panel-border)] pt-2 text-xs text-zinc-500">
        House take this match:{" "}
        <span className="font-semibold text-[var(--lg-glow)]">{houseTake} 🪙</span>
      </p>
    </div>
  );
}
