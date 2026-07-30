"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { rankOf } from "@/lib/lr";
import { ROLE_LABELS, type Role } from "@/lib/types";

interface HistoryMatch {
  matchId: string;
  delta: number;
  /** 'match' = real game; 'reset'/'carry' = season bookkeeping. */
  kind: "match" | "reset" | "carry";
  /** true/false for matches; null for season adjustments. */
  won: boolean | null;
  lr: number;
  playedAt: string;
}

interface HistoryPlayer {
  email: string;
  ign: string;
  peak_mmr: number;
  position: number | null;
  starting_lr: number;
  lr: number;
}

interface HistoryResponse {
  player: HistoryPlayer;
  wins: number;
  losses: number;
  matches: HistoryMatch[];
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

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/** Format an ISO timestamp as a short local date + time. */
function playedLabel(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? "—"
    : d.toLocaleString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
      });
}

export default function PlayerHistoryPage({
  params,
}: {
  params: Promise<{ email: string }>;
}) {
  const { email } = use(params);
  const [data, setData] = useState<HistoryResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch(`/api/players/${encodeURIComponent(email)}/history`)
      .then((r) => r.json().then((b) => ({ ok: r.ok, b })))
      .then(({ ok, b }) => {
        if (!active) return;
        if (!ok) throw new Error(b.error ?? "Could not load match history.");
        setError(null);
        setData(b as HistoryResponse);
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : "Load failed."));
    return () => {
      active = false;
    };
  }, [email]);

  const player = data?.player;
  const rank = player ? rankOf(player.peak_mmr) : "Recruit";
  const accent = RANK_ACCENTS[rank] ?? "#6a6a72";
  const games = data ? data.wins + data.losses : 0;
  const rate = games === 0 ? null : Math.round(((data?.wins ?? 0) / games) * 100);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-12">
      <Link
        href="/leaderboard"
        className="text-sm text-zinc-400 transition-colors hover:text-white"
      >
        ← Leaderboard
      </Link>

      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {!data && !error && <p className="text-zinc-500">Loading…</p>}

      {player && (
        <>
          <header className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="gradient-text text-4xl font-extrabold tracking-tight">
                {player.ign || "—"}
              </h1>
              <span
                className="rounded-full px-2.5 py-0.5 text-xs font-semibold"
                style={{ backgroundColor: `${accent}22`, color: accent }}
              >
                {rank}
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-sm text-zinc-400">
              <span>
                Peak MMR <span className="tabular-nums text-zinc-200">{player.peak_mmr}</span>
              </span>
              <span>
                Role{" "}
                <span className="text-zinc-200">
                  {player.position && player.position >= 1 && player.position <= 5
                    ? ROLE_LABELS[player.position as Role]
                    : "Any"}
                </span>
              </span>
              <span>
                Record{" "}
                <span className="tabular-nums">
                  <span className="text-emerald-400">{data.wins}W</span>
                  {" – "}
                  <span className="text-red-400">{data.losses}L</span>
                </span>
                {rate !== null && <span className="text-zinc-500"> ({rate}%)</span>}
              </span>
              <span>
                LR <span className="tabular-nums font-bold text-[var(--lg-glow)]">{player.lr}</span>
              </span>
            </div>
          </header>

          {data.matches.length === 0 ? (
            <div className="panel rounded-2xl px-8 py-14 text-center text-zinc-400">
              No matches played yet.
            </div>
          ) : (
            <div className="panel overflow-hidden rounded-2xl">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--panel-border)] text-left text-xs uppercase tracking-wider text-zinc-500">
                    <th className="px-4 py-3 font-semibold">#</th>
                    <th className="px-4 py-3 font-semibold">Date</th>
                    <th className="px-4 py-3 font-semibold">Result</th>
                    <th className="px-4 py-3 text-right font-semibold">LR change</th>
                    <th className="px-4 py-3 text-right font-semibold">LR</th>
                  </tr>
                </thead>
                <tbody>
                  {data.matches.map((m, i) => (
                    <tr
                      key={`${m.matchId}-${m.playedAt}`}
                      className="border-b border-[var(--panel-border)] last:border-0 transition-colors hover:bg-white/[0.02]"
                    >
                      <td className="px-4 py-3 tabular-nums text-zinc-500">
                        {data.matches.length - i}
                      </td>
                      <td className="px-4 py-3 text-zinc-300">{playedLabel(m.playedAt)}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                            m.kind !== "match"
                              ? "bg-white/5 text-zinc-400"
                              : m.won
                                ? "bg-emerald-400/10 text-emerald-400"
                                : "bg-red-400/10 text-red-400"
                          }`}
                        >
                          {m.kind === "carry"
                            ? "Season carry"
                            : m.kind === "reset"
                              ? "Season reset"
                              : m.won
                                ? "Win"
                                : "Loss"}
                        </span>
                      </td>
                      <td
                        className={`px-4 py-3 text-right font-bold tabular-nums ${
                          m.delta > 0
                            ? "text-emerald-400"
                            : m.delta < 0
                              ? "text-red-400"
                              : "text-zinc-400"
                        }`}
                      >
                        {signed(m.delta)}
                      </td>
                      <td className="px-4 py-3 text-right tabular-nums text-[var(--lg-glow)]">
                        {m.lr}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </main>
  );
}
