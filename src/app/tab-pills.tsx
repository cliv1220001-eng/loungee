import type { ReactNode } from "react";

export interface TabItem<K extends string> {
  key: K;
  label: string;
  icon?: ReactNode;
}

interface TabPillsProps<K extends string> {
  tabs: TabItem<K>[];
  active: K;
  onChange: (key: K) => void;
  /** Smaller variant for dense filter bars (e.g. the audit page). */
  size?: "md" | "sm";
  className?: string;
}

/**
 * Icon-pill tab bar. Inactive tabs are quiet text; the active tab is the orange
 * gradient pill (btn-neon). Used across Betting, Audit, and elsewhere for a
 * consistent look.
 */
export default function TabPills<K extends string>({
  tabs,
  active,
  onChange,
  size = "md",
  className = "",
}: TabPillsProps<K>) {
  const pad = size === "sm" ? "px-3 py-1 text-xs" : "px-4 py-1.5 text-sm";
  return (
    <div
      role="tablist"
      className={`inline-flex flex-wrap gap-1 rounded-full border border-[var(--panel-border)] bg-black/20 p-1 ${className}`}
    >
      {tabs.map((t) => {
        const on = t.key === active;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={on}
            onClick={() => onChange(t.key)}
            className={`inline-flex items-center gap-1.5 rounded-full font-semibold transition-colors ${pad} ${
              on ? "btn-neon" : "text-zinc-400 hover:text-white"
            }`}
          >
            {t.icon}
            {t.label}
          </button>
        );
      })}
    </div>
  );
}
