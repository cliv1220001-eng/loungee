"use client";

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { ROLE_LABELS, type Role } from "@/lib/types";

/** The client-only flag never changes, so it needs no real subscription. */
const subscribeNoop = () => () => {};

/**
 * Full-screen celebration shown the moment a drafted player is revealed.
 *
 * The name lands big, confetti bursts, then the whole thing shrinks away toward
 * the team cards below (see `reveal-name` in globals.css). Purely presentational
 * and pointer-events-none, so it never blocks the organizer's next click — the
 * parent unmounts it on a timer.
 */

const CONFETTI_COLORS = [
  "#e8632a", // accent orange
  "#f0844f",
  "#5a9a78", // green
  "#5a8f99", // teal
  "#e0b64a", // gold
  "#b0605a", // red
  "#e9e9ea", // white
];

const PIECES = 90;

export interface DraftRevealProps {
  /** Player just picked. */
  name: string;
  role: Role | null;
  /** Rating to show, already resolved to the active basis. */
  rating: number;
  /** "LR" or "MMR". */
  unit: string;
  /** Team that got them, for the caption + colour. */
  teamId: number;
  accent: string;
}

export default function DraftReveal({
  name,
  role,
  rating,
  unit,
  teamId,
  accent,
}: DraftRevealProps) {
  // Confetti pattern is built ONCE via a lazy initialiser. This keeps render
  // pure (Math.random() must not run during render) without the extra pass a
  // setState-in-effect would cause. The component is remounted per pick (keyed
  // upstream), so every reveal still gets a fresh pattern.
  const [pieces] = useState(() =>
    Array.from({ length: PIECES }, (_, i) => ({
      id: i,
      // Start clustered around the centre so the burst reads as coming FROM the
      // revealed name, then fan out via --dx.
      left: 50 + (Math.random() - 0.5) * 24,
      dx: `${(Math.random() - 0.5) * 110}vw`,
      dy: `${45 + Math.random() * 55}vh`,
      spin: `${360 + Math.random() * 1080}deg`,
      // Kept under the 2s overlay lifetime so no piece is cut off mid-flight.
      dur: `${1.1 + Math.random() * 0.7}s`,
      delay: `${Math.random() * 0.15}s`,
      color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      wide: Math.random() > 0.7,
    }))
  );

  // Portalled to <body>. The page sets `body { overflow-x: hidden }`, which
  // creates a containing block that CLIPS position:fixed children rendered
  // inside the scrolled layout — the overlay ended up anchored to the document
  // instead of the viewport. Rendering at the body root avoids that entirely.
  // useSyncExternalStore gives a hydration-safe "am I on the client?" flag with
  // no setState-in-effect cascade: the server snapshot is false, the client's true.
  const mounted = useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false
  );
  if (!mounted) return null;

  return createPortal(
    <div className="pointer-events-none fixed inset-0 z-50 overflow-hidden">
      {/* Backdrop — without this the giant name collides with the board behind
          it and the whole thing reads as broken rather than celebratory. */}
      <div className="animate-reveal-backdrop absolute inset-0 bg-black/75 backdrop-blur-sm" />

      {/* Confetti — explicitly above the backdrop, whose backdrop-blur creates
          its own stacking context that would otherwise obscure these. */}
      <div className="absolute inset-0 z-10">
        {pieces.map((p) => (
          <span
            key={p.id}
            className="confetti-piece"
            style={
              {
                left: `${p.left}%`,
                backgroundColor: p.color,
                width: p.wide ? 13 : 8,
                height: p.wide ? 8 : 14,
                "--dx": p.dx,
                "--dy": p.dy,
                "--spin": p.spin,
                "--dur": p.dur,
                "--delay": p.delay,
              } as React.CSSProperties
            }
          />
        ))}
      </div>

      {/* The name, front and centre — above the confetti. */}
      <div className="absolute inset-0 z-20 flex items-center justify-center p-6">
        <div className="animate-reveal-name flex w-full max-w-2xl flex-col items-center gap-4 text-center">
          <span className="text-[11px] font-semibold uppercase tracking-[0.3em] text-zinc-400">
            Picked
          </span>

          <span
            className="max-w-full truncate text-5xl font-extrabold leading-none tracking-tight drop-shadow-[0_6px_30px_rgba(0,0,0,0.8)] sm:text-7xl lg:text-8xl"
            style={{ color: accent }}
          >
            {name}
          </span>

          <div className="flex flex-wrap items-center justify-center gap-2 text-sm">
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 font-semibold text-zinc-100">
              {role ? ROLE_LABELS[role] : "Any role"}
            </span>
            <span className="rounded-full border border-white/15 bg-white/10 px-3 py-1 font-bold tabular-nums text-zinc-100">
              {rating} {unit}
            </span>
          </div>

          <span
            className="rounded-full px-5 py-1.5 text-lg font-extrabold"
            style={{ backgroundColor: `${accent}22`, color: accent }}
          >
            → Team {teamId}
          </span>
        </div>
      </div>
    </div>,
    document.body
  );
}
