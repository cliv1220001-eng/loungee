"use client";

/**
 * Original decorative art — a cloaked woodland ranger, an ORIGINAL character
 * inspired by the forest-archer archetype (big ears, bushy tail, crossbow, hood)
 * rather than any specific copyrighted hero. Pure inline SVG so it's
 * self-contained, scalable, and themeable. Purely atmospheric: aria-hidden and
 * pointer-events-none so it never interferes with the UI.
 */
export default function ForestRanger({ className = "" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 240 520"
      role="img"
      aria-hidden="true"
      className={`pointer-events-none select-none ${className}`}
      fill="none"
    >
      <defs>
        <linearGradient id="fr-cloak" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a5a44" />
          <stop offset="0.55" stopColor="#26402f" />
          <stop offset="1" stopColor="#182a20" />
        </linearGradient>
        <linearGradient id="fr-fur" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#c8763a" />
          <stop offset="1" stopColor="#8a4a22" />
        </linearGradient>
        <radialGradient id="fr-eye" cx="0.5" cy="0.5" r="0.6">
          <stop offset="0" stopColor="#ffd98a" />
          <stop offset="0.6" stopColor="#f0a340" />
          <stop offset="1" stopColor="#b96c1e" />
        </radialGradient>
        <linearGradient id="fr-glow" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="0.5" />
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0" />
        </linearGradient>
      </defs>

      {/* Ambient glow behind the figure */}
      <ellipse cx="120" cy="250" rx="110" ry="230" fill="url(#fr-glow)" opacity="0.35" />

      {/* Bushy tail curling up behind */}
      <path
        d="M70 470 C 8 430, 6 320, 54 288 C 26 330, 40 400, 92 428 C 70 452, 66 468, 70 470 Z"
        fill="url(#fr-fur)"
        opacity="0.92"
      />
      <path
        d="M62 452 C 26 420, 26 344, 60 316"
        stroke="#e39a55"
        strokeWidth="3"
        strokeLinecap="round"
        opacity="0.5"
        fill="none"
      />

      {/* Cloak body */}
      <path
        d="M120 150 C 168 150, 190 210, 196 300 C 202 380, 190 452, 176 486 L 64 486 C 50 452, 38 380, 44 300 C 50 210, 72 150, 120 150 Z"
        fill="url(#fr-cloak)"
      />
      {/* Cloak fold highlight */}
      <path
        d="M120 168 C 120 300, 116 420, 112 480"
        stroke="#4d7358"
        strokeWidth="3"
        opacity="0.5"
        fill="none"
      />
      <path
        d="M96 210 C 84 320, 82 420, 88 478"
        stroke="#1c3025"
        strokeWidth="4"
        opacity="0.55"
        fill="none"
      />
      <path
        d="M150 214 C 162 320, 162 420, 154 478"
        stroke="#1c3025"
        strokeWidth="4"
        opacity="0.55"
        fill="none"
      />

      {/* Crossbow across the body */}
      <g stroke="#5a3d24" strokeLinecap="round" fill="none">
        <path d="M58 300 L 186 336" strokeWidth="7" />
        <path d="M60 288 C 44 300, 44 322, 60 334" strokeWidth="6" />
        <path d="M184 322 C 200 334, 200 356, 184 368" strokeWidth="6" />
      </g>
      {/* Bowstring + bolt */}
      <path d="M60 289 L 132 318 L 184 323" stroke="#d8c9a8" strokeWidth="1.6" opacity="0.8" />
      <path d="M132 318 L 210 348" stroke="#caa46a" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M210 348 L 200 342 M210 348 L 202 356" stroke="#caa46a" strokeWidth="2.5" strokeLinecap="round" />

      {/* Hood + head */}
      <path
        d="M120 60 C 82 60, 64 96, 68 140 C 72 176, 96 190, 120 190 C 144 190, 168 176, 172 140 C 176 96, 158 60, 120 60 Z"
        fill="url(#fr-cloak)"
      />
      {/* Ears poking through the hood */}
      <path d="M86 74 C 74 40, 84 24, 96 30 C 92 48, 96 66, 104 78 Z" fill="url(#fr-fur)" />
      <path d="M154 74 C 166 40, 156 24, 144 30 C 148 48, 144 66, 136 78 Z" fill="url(#fr-fur)" />
      <path d="M90 66 C 84 46, 88 36, 94 38" stroke="#e39a55" strokeWidth="2" opacity="0.6" fill="none" />
      <path d="M150 66 C 156 46, 152 36, 146 38" stroke="#e39a55" strokeWidth="2" opacity="0.6" fill="none" />

      {/* Face in shadow under the hood */}
      <path
        d="M120 108 C 100 108, 88 124, 90 144 C 92 162, 106 172, 120 172 C 134 172, 148 162, 150 144 C 152 124, 140 108, 120 108 Z"
        fill="#12100c"
      />
      {/* Two glinting eyes */}
      <ellipse cx="108" cy="140" rx="8" ry="9" fill="url(#fr-eye)" />
      <ellipse cx="132" cy="140" rx="8" ry="9" fill="url(#fr-eye)" />
      <circle cx="108" cy="140" r="3" fill="#3a2408" />
      <circle cx="132" cy="140" r="3" fill="#3a2408" />
      <circle cx="110" cy="137" r="1.4" fill="#fff6de" />
      <circle cx="134" cy="137" r="1.4" fill="#fff6de" />

      {/* A couple of drifting leaf motes */}
      <path d="M40 120 q 6 -8 12 0 q -6 8 -12 0 Z" fill="#4d7358" opacity="0.5" />
      <path d="M200 180 q 5 -7 10 0 q -5 7 -10 0 Z" fill="#c8763a" opacity="0.45" />
      <path d="M30 260 q 4 -6 8 0 q -4 6 -8 0 Z" fill="#4d7358" opacity="0.4" />
    </svg>
  );
}
