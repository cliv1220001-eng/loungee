"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface AuditEntry {
  id: string;
  actor: string;
  action: string;
  target: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
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

  const GROUPS: [string, string][] = [
    ["", "All"],
    ["cashin", "Cash-in"],
    ["cashout", "Cash-out"],
    ["coins", "Adjustments"],
    ["bet", "Bets"],
    ["tournament", "Tournaments"],
    ["login", "Logins"],
  ];

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-6 py-8">
      <header className="mb-6 flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Audit Logs</h1>
        <p className="text-sm text-zinc-400">Who did what, and when.</p>
      </header>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-full bg-black/20 p-1">
          {GROUPS.map(([key, label]) => (
            <button
              key={key || "all"}
              onClick={() => setGroup(key)}
              className={`rounded-full px-3 py-1 text-xs font-semibold transition-colors ${
                group === key ? "btn-neon" : "text-zinc-400 hover:text-white"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
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
            return (
              <li key={e.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 px-4 py-2.5 text-sm">
                <span className="font-bold text-zinc-100">{e.actor}</span>
                <span className={`font-semibold ${m.tone}`}>{m.label}</span>
                {e.target && <span className="text-zinc-400">{e.target}</span>}
                {detail && <span className="text-zinc-500">{detail}</span>}
                <span className="ml-auto text-xs tabular-nums text-zinc-600">
                  {new Date(e.created_at).toLocaleString()}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
