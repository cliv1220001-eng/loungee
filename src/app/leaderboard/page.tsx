"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { rankOf } from "@/lib/lr";
import { ROLE_LABELS, type Role } from "@/lib/types";

interface LeaderboardPlayer {
  email: string;
  ign: string;
  peak_mmr: number;
  position: number | null;
  starting_lr: number;
  lr: number;
  /** Only present in monthly view: net LR earned that month. */
  earned?: number;
  /** Only present in monthly view: wins/losses that month. */
  wins?: number;
  losses?: number;
}

/** Win rate as a whole-number percent, or null when no games were played. */
function winRate(wins: number, losses: number): number | null {
  const games = wins + losses;
  return games === 0 ? null : Math.round((wins / games) * 100);
}

const RANK_ACCENTS: Record<string, string> = {
  Immortal: "#e0b64a",
  Legend: "#b0605a",
  Grandmaster: "#b08a4a",
  Master: "#9a7f5a",
  Diamond: "#5a8f99",
  Platinum: "#5a9a78",
  Gold: "#b0a04a",
  Silver: "#7f7a9a",
  Bronze: "#8a6a4a",
  Recruit: "#6a6a72",
};

/** Current year-month (YYYY-MM) in local time. */
function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(y, (mo ?? 1) - 1, 1).toLocaleString(undefined, { month: "long", year: "numeric" });
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

export default function LeaderboardPage() {
  // "" = all-time; otherwise a YYYY-MM month.
  const [month, setMonth] = useState<string>("");
  const [players, setPlayers] = useState<LeaderboardPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const monthly = month !== "";

  useEffect(() => {
    let active = true;
    fetch(`/api/players${monthly ? `?month=${month}` : ""}`)
      .then((r) => r.json().then((b) => ({ ok: r.ok, b })))
      .then(({ ok, b }) => {
        if (!active) return;
        if (!ok) throw new Error(b.error ?? "Could not load leaderboard.");
        setError(null);
        setPlayers(b.players ?? []);
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : "Load failed."));
    return () => {
      active = false;
    };
  }, [month, monthly]);

  const subtitle = useMemo(
    () =>
      monthly
        ? `LR earned in ${monthLabel(month)} — +40 per win, −40 per loss, +60 for the champion.`
        : "Every registered player, ranked by all-time LR.",
    [monthly, month]
  );

  return (
    <main
      className={`mx-auto flex w-full flex-1 flex-col gap-6 px-6 py-12 ${
        monthly ? "max-w-5xl" : "max-w-4xl"
      }`}
    >
      <header className="flex flex-col gap-2">
        <h1 className="gradient-text text-4xl font-extrabold tracking-tight">LoungeE Rating</h1>
        <p className="text-zinc-400">{subtitle}</p>
      </header>

      {/* Filter: all-time vs a specific month */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="panel flex rounded-full p-1">
          <button
            onClick={() => setMonth("")}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              !monthly ? "btn-neon" : "text-zinc-400 hover:text-white"
            }`}
          >
            All time
          </button>
          <button
            onClick={() => setMonth((m) => (m === "" ? thisMonth() : m))}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition-colors ${
              monthly ? "btn-neon" : "text-zinc-400 hover:text-white"
            }`}
          >
            By month
          </button>
        </div>
        {monthly && (
          <input
            type="month"
            value={month}
            max={thisMonth()}
            onChange={(e) => setMonth(e.target.value || thisMonth())}
            className="field rounded-lg px-3 py-1.5 text-sm"
          />
        )}
      </div>

      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {players === null && !error && <p className="text-zinc-500">Loading…</p>}

      {players && players.length === 0 && (
        <div className="panel rounded-2xl px-8 py-14 text-center text-zinc-400">
          {monthly
            ? `No LR earned in ${monthLabel(month)} yet.`
            : "No players yet. Paste a roster with emails on the Teams page to register players."}
        </div>
      )}

      {players && players.length > 0 && (
        <div className="panel overflow-x-auto rounded-2xl">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-[var(--panel-border)] text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-3 py-3 font-semibold">#</th>
                <th className="px-3 py-3 font-semibold">Player</th>
                <th className="px-3 py-3 font-semibold">Rank</th>
                <th className="px-3 py-3 text-center font-semibold">Pos</th>
                <th className="px-3 py-3 text-right font-semibold">MMR</th>
                {monthly && <th className="whitespace-nowrap px-3 py-3 text-center font-semibold">W–L</th>}
                {monthly && <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">Win %</th>}
                {monthly && <th className="whitespace-nowrap px-3 py-3 text-right font-semibold">LR earned</th>}
                <th className="px-3 py-3 text-right font-semibold">LR</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p, i) => {
                const rank = rankOf(p.peak_mmr);
                const accent = RANK_ACCENTS[rank] ?? "#6a6a72";
                const delta = p.lr - p.starting_lr;
                const earned = p.earned ?? 0;
                const wins = p.wins ?? 0;
                const losses = p.losses ?? 0;
                const rate = winRate(wins, losses);
                return (
                  <tr
                    key={p.email}
                    className="border-b border-[var(--panel-border)] last:border-0 transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="px-3 py-3 tabular-nums text-zinc-500">{i + 1}</td>
                    <td className="px-3 py-3 font-semibold text-zinc-100">
                      <Link
                        href={`/leaderboard/${encodeURIComponent(p.email)}`}
                        className="transition-colors hover:text-[var(--lg-glow)] hover:underline"
                      >
                        {p.ign || "—"}
                      </Link>
                    </td>
                    <td className="px-3 py-3">
                      <span
                        className="whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold"
                        style={{ backgroundColor: `${accent}22`, color: accent }}
                      >
                        {rank}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-3 text-center text-xs text-zinc-400">
                      {p.position && p.position >= 1 && p.position <= 5
                        ? ROLE_LABELS[p.position as Role]
                        : "—"}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums text-zinc-400">{p.peak_mmr}</td>
                    {monthly && (
                      <td className="whitespace-nowrap px-3 py-3 text-center tabular-nums">
                        <span className="text-emerald-400">{wins}</span>
                        <span className="mx-0.5 text-zinc-600">–</span>
                        <span className="text-red-400">{losses}</span>
                      </td>
                    )}
                    {monthly && (
                      <td className="px-3 py-3 text-right tabular-nums text-zinc-300">
                        {rate === null ? "—" : `${rate}%`}
                      </td>
                    )}
                    {monthly && (
                      <td
                        className={`whitespace-nowrap px-3 py-3 text-right font-bold tabular-nums ${
                          earned > 0 ? "text-emerald-400" : earned < 0 ? "text-red-400" : "text-zinc-400"
                        }`}
                      >
                        {signed(earned)}
                      </td>
                    )}
                    <td className="whitespace-nowrap px-3 py-3 text-right">
                      <span className="font-bold tabular-nums text-[var(--lg-glow)]">{p.lr}</span>
                      {!monthly && delta !== 0 && (
                        <span
                          className={`ml-2 text-xs tabular-nums ${
                            delta > 0 ? "text-emerald-400" : "text-red-400"
                          }`}
                        >
                          {signed(delta)}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
