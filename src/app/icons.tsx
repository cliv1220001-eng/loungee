import type { SVGProps } from "react";

// Shared line-icons for the icon-pill tabs and nav. Stroke uses currentColor so
// they inherit the pill's active/inactive text color. 15px default, tweakable.

type IconProps = SVGProps<SVGSVGElement>;

function base(props: IconProps) {
  return {
    width: 15,
    height: 15,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    ...props,
  };
}

/** Coin / cash-in (dollar sign). */
export function CashInIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  );
}

/** Cash-out (arrow leaving a wallet). */
export function CashOutIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M3 7v10a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2v-2" />
      <path d="M3 7a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v2" />
      <path d="M14 12h8m0 0-3-3m3 3-3 3" />
    </svg>
  );
}

/** Balances (coins stack). */
export function BalancesIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <ellipse cx="12" cy="6" rx="7" ry="3" />
      <path d="M5 6v6c0 1.66 3.13 3 7 3s7-1.34 7-3V6" />
      <path d="M5 12v6c0 1.66 3.13 3 7 3s7-1.34 7-3v-6" />
    </svg>
  );
}

/** Bets / dice. */
export function BetsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="3" width="18" height="18" rx="3" />
      <circle cx="8.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="15.5" cy="8.5" r="1.3" fill="currentColor" stroke="none" />
      <circle cx="8.5" cy="15.5" r="1.3" fill="currentColor" stroke="none" />
    </svg>
  );
}

/** Teams (people). */
export function TeamsIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13A4 4 0 0 1 16 11" />
    </svg>
  );
}

/** Bracket. */
export function BracketIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 5h5v6h6M4 19h5v-6" />
      <path d="M15 12h5" />
    </svg>
  );
}

/** Leaderboard (trophy). */
export function TrophyIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M6 4h12v4a6 6 0 0 1-12 0V4Z" />
      <path d="M6 6H4a2 2 0 0 0 0 4h2M18 6h2a2 2 0 0 1 0 4h-2M9 20h6M12 14v6" />
    </svg>
  );
}

/** Audit / list-check. */
export function AuditIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2" />
    </svg>
  );
}

/** Balance / scales (Balance mode). */
export function ScalesIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M12 3v18M7 7h10M12 3 7 7l-3 4a3 3 0 0 0 6 0Zm0 0 5 4 3 4a3 3 0 0 1-6 0ZM8 21h8" />
    </svg>
  );
}

/** Spread roles / grid layout. */
export function RolesIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6h16M4 12h16M4 18h16M9 4v4M15 10v4M6 16v4" />
    </svg>
  );
}

/** Coin (bet game / coin toss). */
export function CoinIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="12" cy="12" r="9" />
      <path d="M9.5 9.5a2.5 2.5 0 1 1 0 5M12 7v10" />
    </svg>
  );
}

/** Generic dot/all filter. */
export function AllIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <circle cx="6" cy="6" r="2" />
      <circle cx="18" cy="6" r="2" />
      <circle cx="6" cy="18" r="2" />
      <circle cx="18" cy="18" r="2" />
    </svg>
  );
}

/** Calendar (by-month). */
export function CalendarIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <rect x="3" y="4" width="18" height="17" rx="2" />
      <path d="M3 9h18M8 2v4M16 2v4" />
    </svg>
  );
}

/** Adjustments (sliders). */
export function AdjustIcon(props: IconProps) {
  return (
    <svg {...base(props)}>
      <path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M18 18h2" />
      <circle cx="15" cy="6" r="2" />
      <circle cx="9" cy="12" r="2" />
      <circle cx="15" cy="18" r="2" />
    </svg>
  );
}
