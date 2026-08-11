"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

/** The client-only flag never changes, so it needs no real subscription. */
const subscribeNoop = () => () => {};

/**
 * Full-screen chooser that decides which captain drafts first in a Bet Game.
 *
 * The organizer can either FLIP A COIN (random, animated) or just PICK a captain
 * directly. Either way, once "first" is settled, `onDone(winner)` fires so the
 * parent can start the draft with that captain picking first.
 *
 * When flipping, the RESULT is decided here (a fair 50/50) and the animation is
 * played out to land on that side — the coin and the outcome never disagree.
 */

/** Total time the coin spins before the winner is announced. */
const SPIN_MS = 2400;
/** How long the winner banner holds before `onDone` fires. */
const HOLD_MS = 1400;

export interface CoinTossProps {
  /** Team "a" captain's display name (the first-listed side). */
  captainA: string;
  /** Team "b" captain's display name. */
  captainB: string;
  accentA: string;
  accentB: string;
  /** Fires once the winner is settled (by flip or manual choice). */
  onDone: (winner: "a" | "b") => void;
  /** A fair 50/50 flip result, injected so render stays pure (no Math.random). */
  flipResult: "a" | "b";
}

type Phase = "choosing" | "flipping" | "landed";

export default function CoinToss({
  captainA,
  captainB,
  accentA,
  accentB,
  onDone,
  flipResult,
}: CoinTossProps) {
  const [phase, setPhase] = useState<Phase>("choosing");
  // The settled winner — set when the organizer picks, or when a flip lands.
  const [winner, setWinner] = useState<"a" | "b" | null>(null);
  const doneRef = useRef(onDone);

  useEffect(() => {
    doneRef.current = onDone;
  }, [onDone]);

  // Drive the flip: after the spin, land, then fire onDone after a hold.
  useEffect(() => {
    if (phase !== "flipping") return;
    const land = window.setTimeout(() => {
      setWinner(flipResult);
      setPhase("landed");
    }, SPIN_MS);
    return () => window.clearTimeout(land);
  }, [phase, flipResult]);

  // Once landed (by flip or immediate manual choice), announce then finish.
  useEffect(() => {
    if (phase !== "landed" || winner == null) return;
    const finish = window.setTimeout(() => doneRef.current(winner), HOLD_MS);
    return () => window.clearTimeout(finish);
  }, [phase, winner]);

  // Hydration-safe "am I on the client?" flag (see draft-reveal.tsx for why we
  // portal to body and gate on this).
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );
  if (!mounted) return null;

  const choose = (side: "a" | "b") => {
    setWinner(side);
    setPhase("landed");
  };

  const winnerName = winner === "a" ? captainA : winner === "b" ? captainB : "";
  const winnerAccent = winner === "a" ? accentA : accentB;
  // The coin's up-face colour tracks the flip result while spinning, so it lands
  // on the winning side's colour.
  const faceColor = winner ? winnerAccent : flipResult === "a" ? accentA : accentB;

  return createPortal(
    <div className="pointer-events-auto fixed inset-0 z-50 flex flex-col items-center justify-center gap-8 overflow-hidden bg-black/80 backdrop-blur-sm">
      <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-zinc-400">
        Who drafts first?
      </span>

      {/* The two captains, dimming to spotlight the winner once decided. */}
      <div className="flex items-center gap-6 text-center sm:gap-12">
        <CaptainChip
          name={captainA}
          accent={accentA}
          dim={phase === "landed" && winner !== "a"}
          win={phase === "landed" && winner === "a"}
        />
        <span className="text-lg font-bold text-zinc-600">vs</span>
        <CaptainChip
          name={captainB}
          accent={accentB}
          dim={phase === "landed" && winner !== "b"}
          win={phase === "landed" && winner === "b"}
        />
      </div>

      {/* The coin — only shown while flipping / after a flip lands. */}
      {phase !== "choosing" && (
        <div className="[perspective:800px]">
          <div
            className={phase === "flipping" ? "animate-coin-spin" : ""}
            style={{ "--spin-dur": `${SPIN_MS}ms` } as React.CSSProperties}
          >
            <div
              className="flex h-28 w-28 items-center justify-center rounded-full border-4 text-4xl font-black shadow-[0_10px_40px_rgba(0,0,0,0.6)] sm:h-32 sm:w-32"
              style={{
                borderColor: faceColor,
                backgroundColor: `${faceColor}22`,
                color: faceColor,
              }}
            >
              🪙
            </div>
          </div>
        </div>
      )}

      {/* Controls: choose a captain, or flip a coin. */}
      {phase === "choosing" && (
        <div className="flex flex-col items-center gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => choose("a")}
              className="rounded-full border-2 px-5 py-2.5 text-sm font-bold transition-transform hover:scale-105"
              style={{ borderColor: accentA, color: accentA }}
            >
              {captainA || "Team 1"} first
            </button>
            <button
              onClick={() => choose("b")}
              className="rounded-full border-2 px-5 py-2.5 text-sm font-bold transition-transform hover:scale-105"
              style={{ borderColor: accentB, color: accentB }}
            >
              {captainB || "Team 2"} first
            </button>
          </div>
          <button
            onClick={() => setPhase("flipping")}
            className="btn-neon rounded-full px-8 py-2.5 text-sm font-bold"
          >
            🪙 Flip a coin
          </button>
        </div>
      )}

      {/* Winner banner, once decided. */}
      {phase === "landed" && winner && (
        <div className="animate-coin-winner flex h-16 flex-col items-center justify-center gap-1 text-center">
          <span
            className="text-2xl font-extrabold sm:text-3xl"
            style={{ color: winnerAccent }}
          >
            {winnerName} picks first!
          </span>
        </div>
      )}
    </div>,
    document.body
  );
}

function CaptainChip({
  name,
  accent,
  dim,
  win,
}: {
  name: string;
  accent: string;
  dim: boolean;
  win: boolean;
}) {
  return (
    <div
      className={`flex min-w-[6rem] flex-col items-center gap-1 rounded-2xl border-2 px-4 py-3 transition-all duration-300 ${
        dim ? "scale-95 opacity-40" : "opacity-100"
      } ${win ? "scale-110" : ""}`}
      style={{
        borderColor: accent,
        backgroundColor: win ? `${accent}22` : "transparent",
      }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        Captain
      </span>
      <span
        className="max-w-[8rem] truncate text-lg font-extrabold"
        style={{ color: accent }}
      >
        {name || "—"}
      </span>
    </div>
  );
}
