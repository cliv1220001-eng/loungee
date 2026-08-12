"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { rankOf } from "@/lib/lr";
import { ROLE_LABELS, type Role } from "@/lib/types";
import TabPills from "../tab-pills";
import { CalendarIcon, TrophyIcon } from "../icons";

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

/** The current year and month in PHILIPPINE time, so "this month" matches the
 *  PH-windowed leaderboard data (and never disagrees near a month boundary). */
function phNow(): { year: number; month: number } {
  // en-CA gives ISO-ish YYYY-MM-DD in the requested zone.
  const [y, m] = new Date()
    .toLocaleDateString("en-CA", { timeZone: "Asia/Manila", year: "numeric", month: "2-digit" })
    .split("-")
    .map(Number);
  return { year: y, month: m };
}

/** Current year-month (YYYY-MM) in Philippine time. */
function thisMonth(): string {
  const { year, month } = phNow();
  return `${year}-${String(month).padStart(2, "0")}`;
}

function monthLabel(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  // Build at noon UTC to avoid any date rollover, and label in PH.
  return new Date(Date.UTC(y, (mo ?? 1) - 1, 1, 12)).toLocaleString("en-US", {
    timeZone: "Asia/Manila",
    month: "long",
    year: "numeric",
  });
}

function signed(n: number): string {
  return n > 0 ? `+${n}` : `${n}`;
}

/**
 * Podium treatment for the top ranks (1-based). Top 3 get a medal emoji +
 * colored highlight; 4 and 5 get a subtler accent (no medal) so the whole Top 5
 * reads as elite without overselling 4th/5th as medalists.
 */
const PODIUM: Record<
  number,
  { emoji?: string; color: string; glow?: string }
> = {
  1: { emoji: "🥇", color: "#e0b64a", glow: "rgba(224,182,74,0.14)" },
  2: { emoji: "🥈", color: "#c8ccd4", glow: "rgba(200,204,212,0.12)" },
  3: { emoji: "🥉", color: "#c08457", glow: "rgba(192,132,87,0.12)" },
  4: { color: "#8a93a3", glow: "rgba(138,147,163,0.06)" },
  5: { color: "#8a93a3", glow: "rgba(138,147,163,0.06)" },
};

const MONTH_ABBR = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Month chips for a year, with a year stepper. Unlike the native month input,
 * FUTURE months are selectable — so a season carry-over can be previewed before
 * that month actually arrives. The current month is marked; future months are
 * dimmed but clickable and labelled "upcoming".
 */
function MonthPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (m: string) => void;
}) {
  const now = new Date();
  const nowYm = now.getFullYear() * 100 + (now.getMonth() + 1);
  const [selY, selM] = value.split("-").map(Number);
  // The year of chips currently shown follows the selection.
  const [viewYear, setViewYear] = useState(selY || now.getFullYear());

  const ym = (y: number, m: number) => y * 100 + m;

  return (
    <div className="panel flex flex-col gap-2 rounded-xl p-3">
      <div className="flex items-center justify-between px-1">
        <button
          onClick={() => setViewYear((y) => y - 1)}
          aria-label="Previous year"
          className="rounded-md px-2 py-1 text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
        >
          ←
        </button>
        <span className="text-sm font-bold tabular-nums text-zinc-100">{viewYear}</span>
        <button
          onClick={() => setViewYear((y) => y + 1)}
          aria-label="Next year"
          className="rounded-md px-2 py-1 text-sm text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
        >
          →
        </button>
      </div>

      <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
        {MONTH_ABBR.map((label, i) => {
          const m = i + 1;
          const isSel = viewYear === selY && m === selM;
          const isNow = ym(viewYear, m) === nowYm;
          const isFuture = ym(viewYear, m) > nowYm;
          return (
            <button
              key={m}
              onClick={() => onChange(`${viewYear}-${String(m).padStart(2, "0")}`)}
              title={isFuture ? "Upcoming month — preview only" : undefined}
              className={`relative rounded-lg px-2 py-2 text-sm font-semibold transition-all ${
                isSel
                  ? "btn-neon"
                  : isFuture
                    ? "text-zinc-500 hover:bg-white/5 hover:text-zinc-300"
                    : "text-zinc-300 hover:bg-white/5 hover:text-white"
              }`}
            >
              {label}
              {isNow && !isSel && (
                <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-[var(--accent)]" />
              )}
            </button>
          );
        })}
      </div>

      <div className="flex items-center justify-between px-1 text-xs text-zinc-500">
        <span>
          Viewing <span className="text-zinc-300">{monthLabel(value)}</span>
          {ym(selY, selM) > nowYm && (
            <span className="ml-1.5 rounded-full bg-amber-400/10 px-2 py-0.5 font-semibold text-amber-300">
              upcoming
            </span>
          )}
        </span>
        <button
          onClick={() => onChange(thisMonth())}
          className="font-semibold text-[var(--lg-glow)] transition-opacity hover:opacity-80"
        >
          This month
        </button>
      </div>
    </div>
  );
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
        ? `LR earned during ${monthLabel(month)}`
        : "",
    [monthly, month]
  );

  return (
    <main
      className={`mx-auto flex w-full flex-1 flex-col gap-6 px-6 py-12 ${
        monthly ? "max-w-5xl" : "max-w-4xl"
      }`}
    >
      <header className="flex flex-col gap-2">
        <h1 className="gradient-text text-4xl font-extrabold tracking-tight">Loungee Rating</h1>
        <p className="text-zinc-400">{subtitle}</p>
      </header>

      {/* Filter: all-time vs a specific month */}
      <div className="flex flex-col gap-3">
        <TabPills
          active={monthly ? "month" : "all"}
          onChange={(k) => setMonth(k === "all" ? "" : (m) => (m === "" ? thisMonth() : m))}
          tabs={[
            { key: "all", label: "All time", icon: <TrophyIcon /> },
            { key: "month", label: "By month", icon: <CalendarIcon /> },
          ]}
        />

        {monthly && <MonthPicker value={month} onChange={setMonth} />}
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
                const podium = PODIUM[i + 1];
                return (
                  <tr
                    key={p.email}
                    className="border-b border-[var(--panel-border)] last:border-0 transition-colors hover:bg-white/[0.02]"
                    style={podium?.glow ? { backgroundColor: podium.glow } : undefined}
                  >
                    <td className="px-3 py-3 tabular-nums text-zinc-500">
                      {podium ? (
                        <span className="flex items-center gap-1.5">
                          {podium.emoji && (
                            <span className="text-base leading-none">{podium.emoji}</span>
                          )}
                          <span className="font-bold" style={{ color: podium.color }}>
                            {i + 1}
                          </span>
                        </span>
                      ) : (
                        i + 1
                      )}
                    </td>
                    <td className="px-3 py-3 font-semibold text-zinc-100">
                      <Link
                        href={`/leaderboard/${encodeURIComponent(p.email)}`}
                        className="transition-colors hover:text-[var(--lg-glow)] hover:underline"
                        style={podium ? { color: podium.color } : undefined}
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
