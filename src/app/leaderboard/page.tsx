"use client";

import { useEffect, useState } from "react";
import { rankOf } from "@/lib/lr";
import { ROLE_LABELS, type Role } from "@/lib/types";

interface LeaderboardPlayer {
  email: string;
  ign: string;
  peak_mmr: number;
  position: number | null;
  starting_lr: number;
  lr: number;
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

export default function LeaderboardPage() {
  const [players, setPlayers] = useState<LeaderboardPlayer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    fetch("/api/players")
      .then((r) => r.json().then((b) => ({ ok: r.ok, b })))
      .then(({ ok, b }) => {
        if (!active) return;
        if (!ok) throw new Error(b.error ?? "Could not load leaderboard.");
        setPlayers(b.players ?? []);
      })
      .catch((e) => active && setError(e instanceof Error ? e.message : "Load failed."));
    return () => {
      active = false;
    };
  }, []);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-6 py-12">
      <header className="flex flex-col gap-2">
        <h1 className="gradient-text text-4xl font-extrabold tracking-tight">LoungeE Rating</h1>
        <p className="text-zinc-400">
          Every registered player, ranked by LR. +40 per win, −40 per loss, +60 for the champion.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-400/30 bg-red-400/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}

      {players === null && !error && <p className="text-zinc-500">Loading…</p>}

      {players && players.length === 0 && (
        <div className="panel rounded-2xl px-8 py-14 text-center text-zinc-400">
          No players yet. Paste a roster with emails on the Teams page to register players.
        </div>
      )}

      {players && players.length > 0 && (
        <div className="panel overflow-hidden rounded-2xl">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--panel-border)] text-left text-xs uppercase tracking-wider text-zinc-500">
                <th className="px-4 py-3 font-semibold">#</th>
                <th className="px-4 py-3 font-semibold">Player</th>
                <th className="px-4 py-3 font-semibold">Rank</th>
                <th className="px-2 py-3 text-center font-semibold">Pos</th>
                <th className="px-4 py-3 text-right font-semibold">MMR</th>
                <th className="px-4 py-3 text-right font-semibold">LR</th>
              </tr>
            </thead>
            <tbody>
              {players.map((p, i) => {
                const rank = rankOf(p.peak_mmr);
                const accent = RANK_ACCENTS[rank] ?? "#6a6a72";
                const delta = p.lr - p.starting_lr;
                return (
                  <tr
                    key={p.email}
                    className="border-b border-[var(--panel-border)] last:border-0 transition-colors hover:bg-white/[0.02]"
                  >
                    <td className="px-4 py-3 tabular-nums text-zinc-500">{i + 1}</td>
                    <td className="px-4 py-3 font-semibold text-zinc-100">{p.ign || "—"}</td>
                    <td className="px-4 py-3">
                      <span
                        className="rounded-full px-2 py-0.5 text-xs font-semibold"
                        style={{ backgroundColor: `${accent}22`, color: accent }}
                      >
                        {rank}
                      </span>
                    </td>
                    <td className="px-2 py-3 text-center text-xs text-zinc-400">
                      {p.position && p.position >= 1 && p.position <= 5
                        ? ROLE_LABELS[p.position as Role]
                        : "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-zinc-400">{p.peak_mmr}</td>
                    <td className="px-4 py-3 text-right">
                      <span className="font-bold tabular-nums text-[var(--lg-glow)]">{p.lr}</span>
                      {delta !== 0 && (
                        <span
                          className={`ml-2 text-xs tabular-nums ${
                            delta > 0 ? "text-emerald-400" : "text-red-400"
                          }`}
                        >
                          {delta > 0 ? `+${delta}` : delta}
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
