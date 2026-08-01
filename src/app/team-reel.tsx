"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { Team } from "@/lib/types";

/**
 * Slot-machine reveal for freshly generated teams.
 *
 * Every player slot rapidly cycles through random names from the pool, then the
 * slots "lock" one by one (left-to-right, top-to-bottom) onto their real player
 * — like a slot machine settling. Once every slot has locked, `onDone` fires and
 * the parent swaps in the real results view.
 *
 * Purely presentational: it renders the SAME team shape it was handed, so the
 * layout doesn't jump when the real cards replace it.
 */

const TEAM_ACCENTS = ["#5a7fa8", "#5a9a78", "#b08a4a", "#b0605a", "#7a86a0"];

// Suspense timing. The reel spins for a beat, then slots lock one by one with a
// gap that GROWS as it nears the end — a slot-machine "will it land?" deceleration
// so the final teams settle slowly and dramatically rather than all at once.
/** Initial spin before the first slot locks. */
const BASE_SPIN = 1200;
/** Gap before the next lock, at the START (fast) and END (slow) of the sequence. */
const GAP_START = 180;
const GAP_END = 620;
/** Pause after the last slot before revealing the real results. */
const TAIL = 700;
/** How fast names flip while a slot is still spinning. */
const TICK = 60;

/**
 * The moment (ms from start) slot `i` of `total` locks. Gaps ease from GAP_START
 * to GAP_END across the sequence, so early slots snap in quickly and the last
 * few land with a long, tense pause between each.
 */
function lockTimes(total: number): number[] {
  const times: number[] = [];
  let t = BASE_SPIN;
  for (let i = 0; i < total; i++) {
    times.push(t);
    const progress = total <= 1 ? 1 : i / (total - 1);
    // ease-in: gaps stay short early, stretch out toward the end.
    t += GAP_START + (GAP_END - GAP_START) * (progress * progress);
  }
  return times;
}

export interface TeamReelProps {
  teams: Team[];
  /** Label under each team total (e.g. "LR" or "MMR"). */
  unit: string;
  /** Team total for the given team, in the active basis. */
  totalOf: (t: Team) => number;
  /** Per-player weight in the active basis (shown on the settled card). */
  weightOf: (p: { mmr: number; email?: string | null }) => number;
  onDone: () => void;
  /** Optional: click-to-skip straight to the final teams. */
  onSkip?: () => void;
}

export default function TeamReel({ teams, unit, totalOf, weightOf, onDone, onSkip }: TeamReelProps) {
  // Flat list of every slot as [teamIndex, playerIndex], in settle order.
  const slots = teams.flatMap((t, ti) => t.players.map((_, pi) => [ti, pi] as const));
  const total = slots.length;

  // How many slots have locked so far; `tick` advances the spinning names.
  const [locked, setLocked] = useState(0);
  const [tick, setTick] = useState(0);
  // Names to flash in spinning slots — derived from props, stable across ticks.
  const allNames = useMemo(
    () => teams.flatMap((t) => t.players.map((p) => p.name || "—")),
    [teams]
  );
  const doneRef = useRef(onDone);

  // Keep the latest onDone without touching a ref during render.
  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  useEffect(() => {
    const timers: number[] = [];
    const times = lockTimes(total);
    // Lock each slot on its decelerating schedule.
    times.forEach((at, i) => {
      timers.push(window.setTimeout(() => setLocked((n) => Math.max(n, i + 1)), at));
    });
    // Advance the spinning-name index on an interval.
    const spin = window.setInterval(() => setTick((x) => x + 1), TICK);
    // Finish after the last slot locks, plus a beat to let it land.
    const finish = window.setTimeout(
      () => doneRef.current(),
      (times[times.length - 1] ?? BASE_SPIN) + TAIL
    );
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(spin);
      clearTimeout(finish);
    };
    // Run once for this set of teams.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deterministic "random-looking" name for a spinning slot: index into the
  // pool by (tick + slot) so it flips each tick without Math.random() in render.
  const spinName = (slotIndex: number) => {
    if (allNames.length === 0) return "—";
    return allNames[(tick + slotIndex * 3) % allNames.length];
  };

  let slotCounter = 0;
  return (
    <section className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-zinc-400">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-[var(--accent)] border-t-transparent" />
          Building teams…
        </p>
        {onSkip && (
          <button
            onClick={onSkip}
            className="rounded-full border border-[var(--panel-border)] px-4 py-1.5 text-xs font-semibold text-zinc-400 transition-colors hover:bg-white/5 hover:text-white"
          >
            Skip
          </button>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {teams.map((team, ti) => {
          const accent = TEAM_ACCENTS[ti % TEAM_ACCENTS.length];
          // A team's total only "appears" once all its slots have locked.
          const teamLocked = team.players.every((_, pi) => {
            const idx = slots.findIndex(([a, b]) => a === ti && b === pi);
            return idx < locked;
          });
          return (
            <div
              key={team.id}
              className="panel rounded-xl p-3.5"
              style={{ borderColor: accent }}
            >
              <div className="mb-2.5 flex items-baseline justify-between gap-1">
                <h2 className="text-base font-extrabold" style={{ color: accent }}>
                  Team {team.id}
                </h2>
                <span className="text-[11px] font-bold tabular-nums text-zinc-300">
                  {teamLocked ? (
                    <>
                      {totalOf(team)} {unit}
                    </>
                  ) : (
                    <span className="text-zinc-600">···</span>
                  )}
                </span>
              </div>
              <ul className="flex flex-col gap-1.5">
                {team.players.map((p) => {
                  const myIndex = slotCounter++;
                  const isLocked = myIndex < locked;
                  return (
                    <li
                      key={p.id}
                      className={`flex items-center justify-between gap-2 rounded-md px-1 py-0.5 text-[13px] transition-all ${
                        isLocked
                          ? "animate-pop bg-transparent"
                          : "bg-white/[0.03] text-zinc-500"
                      }`}
                    >
                      <span className="flex items-center gap-1.5 truncate">
                        {isLocked && p.role && (
                          <span className="shrink-0 rounded bg-white/10 px-1 text-[10px] font-bold tabular-nums text-zinc-300">
                            {p.role}
                          </span>
                        )}
                        <span
                          className={`truncate font-medium ${
                            isLocked ? "text-zinc-100" : "select-none blur-[1px]"
                          }`}
                        >
                          {isLocked ? p.name || "—" : spinName(myIndex)}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums text-zinc-500">
                        {isLocked ? (
                          <span className="text-zinc-400">{weightOf(p)}</span>
                        ) : (
                          <span className="opacity-40">····</span>
                        )}
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
  );
}
