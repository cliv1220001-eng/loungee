"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { startingLr } from "@/lib/lr";
import {
  buildBracket,
  clearWinner,
  getChampion,
  resolveBracket,
  setWinner,
  type Bracket,
  type BracketFormat,
  type ResolvedMatch,
  type ResolvedSlot,
  type Side,
} from "@/lib/bracket";
import {
  BRACKET_RUN_KEY,
  EMPTY_BRACKET_RUN,
  useTeams,
  usePersistentState,
  type BracketRun,
} from "@/lib/store";
import type { Team } from "@/lib/types";

const TEAM_ACCENTS = [
  "#5a7fa8",
  "#5a9a78",
  "#b08a4a",
  "#b0605a",
  "#7a86a0",
  "#5a8f99",
  "#9a7f5a",
  "#7f7a9a",
];

// Bracket layout geometry (px)
const COL_W = 184;
const COL_GAP = 40;
const MATCH_H = 50;
const V_GAP = 14;
const HEADER_H = 26;

function mulberry32(seed: number): () => number {
  let s = seed;
  return () => {
    s |= 0;
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seededShuffle(ids: number[], seed: number): number[] {
  const rnd = mulberry32(seed);
  const arr = [...ids];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export default function BracketView() {
  // undefined = loading from storage, null = nothing saved
  const teams = useTeams();

  // POINTER only: which tournament + its LR stake. This is the ONLY thing kept
  // in localStorage — it just says "which bracket to open". No bracket STATE
  // (winners/seed/format) lives here, so two admins on different devices never
  // conflict; the DB is the single source of truth for the bracket itself.
  const [run, setRun] = usePersistentState<BracketRun>(BRACKET_RUN_KEY, EMPTY_BRACKET_RUN);
  const runId = run.runId;

  // Bracket STATE — in memory only, loaded from and saved to the DB.
  const [format, setFormat] = useState<BracketFormat>("single");
  const [seed, setSeed] = useState<number>(0);
  const [winners, setWinners] = useState<Record<string, "a" | "b">>({});
  // The runId whose DB state we've loaded. Gates saving so we never overwrite a
  // good DB record before we've read it in.
  const [loadedRunId, setLoadedRunId] = useState<string | null>(null);
  const dbLoaded = loadedRunId === runId && runId !== "";

  // Mint a run id the first time the bracket is opened without one (direct nav).
  useEffect(() => {
    if (!runId) {
      setRun({ runId: crypto.randomUUID(), format: "single", seed: 0, winners: {} });
    }
  }, [runId, setRun]);

  // Load the authoritative bracket state from the DB whenever the tournament
  // changes. This is the only place bracket state comes from — no localStorage.
  useEffect(() => {
    if (!runId) return;
    let active = true;
    fetch(`/api/tournaments/${runId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!active) return;
        const saved = b?.tournament?.data?.bracketRun as Partial<BracketRun> | undefined;
        setFormat(saved?.format ?? "single");
        setSeed(saved?.seed ?? Math.floor(Math.random() * 2 ** 31));
        setWinners(saved?.winners ?? {});
        setLoadedRunId(runId); // loaded — the save effect may now fire
      })
      .catch(() => {
        // No DB record (e.g. direct nav) — start fresh, still DB-backed on save.
        if (!active) return;
        setFormat("single");
        setSeed(Math.floor(Math.random() * 2 ** 31));
        setWinners({});
        setLoadedRunId(runId);
      });
    return () => {
      active = false;
    };
  }, [runId]);

  const teamsById = useMemo(() => {
    const map = new Map<number, { team: Team; accent: string }>();
    teams?.forEach((t, i) => map.set(t.id, { team: t, accent: TEAM_ACCENTS[i % TEAM_ACCENTS.length] }));
    return map;
  }, [teams]);

  // Current LR per email, kept fresh so the bracket reflects LR as matches decide.
  const [lrByEmail, setLrByEmail] = useState<Map<string, number>>(new Map());
  const refreshLr = useCallback(() => {
    fetch("/api/players")
      .then((r) => (r.ok ? r.json() : null))
      .then((b) => {
        if (!b?.players) return;
        const m = new Map<string, number>();
        for (const p of b.players as { email: string; lr: number }[]) m.set(p.email, p.lr);
        setLrByEmail(m);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    refreshLr();
  }, [refreshLr]);

  // A player's current LR (falls back to their starting LR until the DB knows them).
  const lrOf = useCallback(
    (mmr: number, email: string | null | undefined) => {
      const key = (email ?? "").trim().toLowerCase();
      return key && lrByEmail.has(key) ? lrByEmail.get(key)! : startingLr(mmr);
    },
    [lrByEmail]
  );

  const order = useMemo(
    () => (teams ? seededShuffle(teams.map((t) => t.id), seed) : []),
    [teams, seed]
  );

  // Seed number shown on each match row (rank in the shuffled order).
  const seedByTeamId = useMemo(() => {
    const m = new Map<number, number>();
    order.forEach((id, i) => m.set(id, i + 1));
    return m;
  }, [order]);

  const bracket: Bracket | null = useMemo(
    () => (order.length ? buildBracket(order, format) : null),
    [order, format]
  );

  const resolved = useMemo(
    () => (bracket ? resolveBracket(bracket, winners) : {}),
    [bracket, winners]
  );

  const championTeamId = bracket ? getChampion(bracket, resolved) : null;
  const champion = championTeamId !== null ? teamsById.get(championTeamId) : null;
  // The champion is DERIVED from winners and persisted to the DB by the save
  // effect below — it is never written to localStorage.

  function reshuffle() {
    setSeed((s) => s + 1);
    setWinners({});
  }

  function changeFormat(next: BracketFormat) {
    setFormat(next);
    setWinners({});
  }

  function pick(matchId: string, side: Side) {
    if (!bracket) return;
    const current = winners[matchId];
    setWinners(
      current === side
        ? clearWinner(bracket, winners, matchId)
        : setWinner(bracket, winners, matchId, side)
    );
  }

  // Live LR sync: on every decision (pick / undo / reshuffle / format change),
  // push the FULL current set of decided real-team matches for this run. The
  // server full-replaces the run's LR events, so LR always tracks the bracket.
  useEffect(() => {
    // Wait until the DB bracket state has loaded, so we sync real winners rather
    // than the empty pre-load state (which would wipe the run's LR events).
    if (!run.runId || !dbLoaded || !bracket || !teams) return;

    const emailsOf = (teamId: number | null): string[] =>
      teamId == null
        ? []
        : (teamsById.get(teamId)?.team.players ?? [])
            .map((p) => (p.email ?? "").trim().toLowerCase())
            .filter((e) => e !== "");

    const matches = Object.values(resolved)
      .filter((rm) => rm.decided && rm.a.teamId != null && rm.b.teamId != null)
      .map((rm) => {
        const winnerId = rm.winner === "a" ? rm.a.teamId : rm.b.teamId;
        const loserId = rm.winner === "a" ? rm.b.teamId : rm.a.teamId;
        return {
          matchId: rm.id,
          championMatch: rm.id === bracket.championMatchId,
          winnerEmails: emailsOf(winnerId),
          loserEmails: emailsOf(loserId),
        };
      });

    const players = teams
      .flatMap((t) => t.players)
      .filter((p) => (p.email ?? "").trim() !== "")
      .map((p) => ({
        email: (p.email ?? "").trim().toLowerCase(),
        ign: p.name,
        mmr: p.mmr,
        position: p.role,
      }));

    const ctrl = new AbortController();
    fetch("/api/lr/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: run.runId,
        players,
        matches,
        teamCount: teams.length,
        stake: run.stake ?? 0,
      }),
      signal: ctrl.signal,
    })
      .then(() => refreshLr()) // pull the recomputed LR back so the bracket updates
      .catch(() => {});
    return () => ctrl.abort();
  }, [run.runId, run.stake, dbLoaded, resolved, bracket, teams, teamsById, refreshLr]);

  // Persist the FULL bracket state (format, seed, winners, champion) to the DB
  // on every change, debounced. The DB is the single source of truth, so this is
  // what both admins read back — surviving refresh, reset, and other devices.
  useEffect(() => {
    // Never save before we've loaded from the DB — otherwise the empty pre-load
    // state would overwrite a good DB record.
    if (!runId || !dbLoaded) return;
    const t = window.setTimeout(() => {
      void fetch(`/api/tournaments/${runId}/bracket`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ format, seed, winners, championTeamId }),
      }).catch(() => {});
    }, 600);
    return () => window.clearTimeout(t);
  }, [runId, format, seed, winners, championTeamId, dbLoaded]);

  if (teams === undefined) {
    return <Shell><p className="text-zinc-500">Loading bracket…</p></Shell>;
  }

  if (!teams || !bracket) {
    return (
      <Shell>
        <div className="panel flex flex-col items-center gap-4 rounded-2xl px-10 py-16 text-center">
          <h2 className="text-xl font-bold">No teams yet</h2>
          <p className="max-w-sm text-zinc-400">
            Generate balanced teams first, then send them here to run the bracket.
          </p>
          <Link href="/" className="btn-neon rounded-full px-6 py-2.5 text-sm">
            Go build teams →
          </Link>
        </div>
      </Shell>
    );
  }

  const groups = {
    wb: bracket.columns.filter((c) => c.group === "wb"),
    lb: bracket.columns.filter((c) => c.group === "lb"),
    gf: bracket.columns.filter((c) => c.group === "gf"),
  };

  const slotInfo = (slot: ResolvedSlot) => {
    const blank = { name: "", muted: true, seed: undefined, accent: undefined, detail: undefined, lr: undefined };
    if (slot.bye) return { ...blank, name: "Bye" };
    if (slot.teamId == null) return { ...blank, name: "TBD" };
    const entry = teamsById.get(slot.teamId);
    if (!entry) return { ...blank, name: `Team ${slot.teamId}`, muted: false };
    const lr = entry.team.players.reduce((sum, p) => sum + lrOf(p.mmr, p.email), 0);
    const detail = entry.team.players
      .map((p) => `${p.name} — ${lrOf(p.mmr, p.email)} LR`)
      .join("\n");
    return {
      name: `Team ${entry.team.id}`,
      seed: seedByTeamId.get(slot.teamId),
      accent: entry.accent,
      detail,
      lr,
      muted: false,
    };
  };

  // A single Challonge-style match box: two stacked rows with seed · name · score.
  const renderMatchBox = (matchId: string) => {
    const rm: ResolvedMatch | undefined = resolved[matchId];
    if (!rm) return null;
    const sides: Side[] = ["a", "b"];
    return (
      <div className="panel flex w-full flex-col overflow-hidden rounded-md" style={{ height: MATCH_H }}>
        {sides.map((side, idx) => {
          const slot = side === "a" ? rm.a : rm.b;
          const info = slotInfo(slot);
          const isWinner = rm.winner === side;
          const isLoser = rm.decided && !isWinner;
          const clickable = !info.muted && rm.a.teamId != null && rm.b.teamId != null;
          return (
            <button
              key={side}
              disabled={!clickable}
              onClick={() => clickable && pick(matchId, side)}
              className={`flex flex-1 items-stretch text-left transition-colors ${
                idx === 0 ? "border-b border-[var(--panel-border)]" : ""
              } ${clickable ? "cursor-pointer hover:bg-white/5" : "cursor-default"} ${
                isLoser ? "opacity-45" : ""
              }`}
            >
              <span className="flex w-5 shrink-0 items-center justify-center bg-white/[0.04] text-[10px] tabular-nums text-zinc-500">
                {info.muted ? "" : (info.seed ?? "")}
              </span>
              <span className="flex min-w-0 flex-1 items-center gap-1.5 px-2" title={info.detail}>
                <span
                  className={`truncate text-[12px] font-semibold ${
                    info.muted ? "text-zinc-500" : isWinner ? "text-white" : "text-zinc-300"
                  }`}
                  style={!info.muted && info.accent ? { color: info.accent } : undefined}
                >
                  {info.name}
                </span>
                {info.lr != null && (
                  <span className="ml-auto shrink-0 text-[10px] font-semibold tabular-nums text-zinc-500">
                    {info.lr} LR
                  </span>
                )}
              </span>
              <span
                className={`flex w-6 shrink-0 items-center justify-center text-[13px] font-bold tabular-nums ${
                  isWinner ? "text-white" : "text-zinc-500"
                }`}
                style={
                  isWinner
                    ? { background: "var(--accent)" }
                    : { background: "rgba(255,255,255,0.04)" }
                }
              >
                {rm.decided ? (isWinner ? "1" : "0") : ""}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  // Columns of match boxes (used for the losers bracket where it isn't a clean binary tree).
  const renderColumns = (cols: typeof groups.wb) => (
    <div className="flex gap-10">
      {cols.map((col) => (
        <div key={col.id} className="flex flex-col gap-3" style={{ width: COL_W }}>
          <span className="text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-500">
            {col.title}
          </span>
          <div className="flex flex-1 flex-col justify-around gap-3">
            {col.matchIds.map((id) => (
              <div key={id}>{renderMatchBox(id)}</div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );

  // A binary-tree bracket with connector lines, rooted at `rootId` (single elim / winners bracket).
  // Round-1 byes are collapsed Challonge-style: a team with a bye isn't drawn in round 1, it
  // appears directly in its round-2 match.
  type TNode = { id: string; round: number; children: TNode[] };
  const matchRound = (id: string) => {
    const m = /-r(\d+)-/.exec(id);
    return m ? parseInt(m[1], 10) : 0;
  };
  const isByeMatch = (id: string) => {
    const m = bracket.matches[id];
    return matchRound(id) === 0 && (m.a.kind === "bye" || m.b.kind === "bye");
  };
  const renderTree = (rootId: string, titles: string[]) => {
    const nodeMap = new Map<string, TNode>();
    const build = (id: string): TNode => {
      const m = bracket.matches[id];
      const children: TNode[] = [];
      for (const slot of [m.a, m.b]) {
        if ((slot.kind === "winner" || slot.kind === "loser") && !isByeMatch(slot.matchId)) {
          children.push(build(slot.matchId));
        }
      }
      const node: TNode = { id, round: matchRound(id), children };
      nodeMap.set(id, node);
      return node;
    };
    const root = build(rootId);

    const unit = MATCH_H + V_GAP;
    const pos = new Map<string, { top: number; center: number; round: number }>();
    let leafIndex = 0;
    const layout = (node: TNode): number => {
      let center: number;
      if (node.children.length === 0) {
        center = leafIndex * unit + MATCH_H / 2;
        leafIndex += 1;
      } else {
        const cs = node.children.map(layout);
        center = cs.reduce((a, b) => a + b, 0) / cs.length;
      }
      pos.set(node.id, { top: center - MATCH_H / 2, center, round: node.round });
      return center;
    };
    layout(root);

    const numRounds = root.round + 1;
    const xOf = (r: number) => r * (COL_W + COL_GAP);
    const width = numRounds * (COL_W + COL_GAP) - COL_GAP;
    const height = Math.max(leafIndex * unit, MATCH_H);

    const segments: string[] = [];
    for (const node of nodeMap.values()) {
      if (node.children.length === 0) continue;
      const parent = pos.get(node.id)!;
      const midX = xOf(node.round) - COL_GAP / 2;
      const centers = node.children.map((c) => pos.get(c.id)!.center);
      for (const c of node.children) {
        const cp = pos.get(c.id)!;
        segments.push(`M ${xOf(cp.round) + COL_W} ${cp.center} L ${midX} ${cp.center}`);
      }
      segments.push(`M ${midX} ${Math.min(...centers)} L ${midX} ${Math.max(...centers)}`);
      segments.push(`M ${midX} ${parent.center} L ${xOf(node.round)} ${parent.center}`);
    }

    return (
      <div className="relative" style={{ width, height: height + HEADER_H }}>
        {titles.slice(0, numRounds).map((t, r) => (
          <div
            key={r}
            className="absolute text-center text-[11px] font-semibold uppercase tracking-wider text-zinc-500"
            style={{ left: xOf(r), top: 0, width: COL_W }}
          >
            {t}
          </div>
        ))}
        <svg
          className="pointer-events-none absolute"
          style={{ left: 0, top: HEADER_H }}
          width={width}
          height={height}
        >
          <path d={segments.join(" ")} stroke="rgba(255,255,255,0.18)" strokeWidth={2} fill="none" />
        </svg>
        {[...pos.entries()].map(([id, p]) => (
          <div
            key={id}
            className="absolute"
            style={{ left: xOf(p.round), top: HEADER_H + p.top, width: COL_W }}
          >
            {renderMatchBox(id)}
          </div>
        ))}
      </div>
    );
  };

  const wbTitles = groups.wb.map((c) => c.title);

  return (
    <Shell>
      {champion && (
        <div
          className="panel animate-pop mb-2 flex flex-col items-center gap-3 rounded-2xl px-6 py-6 text-center"
          style={{ borderColor: champion.accent }}
        >
          <span className="text-3xl">🏆</span>
          <span className="text-xl font-extrabold" style={{ color: champion.accent }}>
            Team {champion.team.id} wins the tournament!
          </span>
          {/* The winning roster. */}
          <div className="flex flex-wrap items-center justify-center gap-2">
            {champion.team.players.map((p) => (
              <span
                key={p.id}
                className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm font-semibold"
                style={{ borderColor: `${champion.accent}55`, color: champion.accent }}
              >
                {p.role && (
                  <span className="rounded bg-white/10 px-1 text-[10px] font-bold tabular-nums text-zinc-200">
                    {p.role}
                  </span>
                )}
                {p.name}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <div className="panel flex rounded-full p-1">
          {(["single", "double"] as BracketFormat[]).map((f) => (
            <button
              key={f}
              onClick={() => changeFormat(f)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold capitalize transition-colors ${
                format === f ? "btn-neon" : "text-zinc-400 hover:text-white"
              }`}
            >
              {f} elim
            </button>
          ))}
        </div>

        <button
          onClick={reshuffle}
          className="rounded-full border border-[var(--panel-border)] px-4 py-2 text-sm font-semibold text-zinc-300 transition-colors hover:bg-white/5"
        >
          Shuffle seeds
        </button>

        <span className="text-sm text-zinc-500">{teams.length} teams</span>

        {(run.stake ?? 0) > 0 && (
          <span
            title="LR bet — every match win/loss pays this instead of the normal scale"
            className="rounded-full bg-[var(--accent)]/15 px-3 py-1 text-sm font-bold text-[var(--lg-glow)]"
          >
            LR bet ±{run.stake}
          </span>
        )}

        <Link
          href="/"
          className="ml-auto text-sm font-semibold text-[var(--lg-glow)] hover:opacity-80"
        >
          ← Edit teams
        </Link>
      </div>

      <p className="text-sm text-zinc-500">
        Click a team to advance them. Click again to undo.
      </p>

      <div className="bracket-scroll -mx-2 overflow-x-auto px-2 pb-4">
        {format === "single" ? (
          <div className="py-2">{renderTree(bracket.championMatchId, wbTitles)}</div>
        ) : (
          <div className="flex flex-col gap-10">
            <Section title="Winners Bracket" accent="var(--lg-primary)">
              {renderTree(groups.wb[groups.wb.length - 1].matchIds[0], wbTitles)}
            </Section>
            {groups.lb.length > 0 && (
              <Section title="Losers Bracket" accent="var(--lg-glow)">
                {renderColumns(groups.lb)}
              </Section>
            )}
            <Section title="Grand Final" accent="var(--lg-lavender)">
              <div style={{ width: COL_W }}>{renderMatchBox("gf")}</div>
            </Section>
          </div>
        )}
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="mx-auto flex w-full max-w-7xl flex-1 flex-col gap-5 px-6 py-10">
      <h1 className="gradient-text text-3xl font-extrabold tracking-tight">Tournament Bracket</h1>
      {children}
    </main>
  );
}

function Section({
  title,
  accent,
  children,
}: {
  title: string;
  accent: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-sm font-bold uppercase tracking-widest" style={{ color: accent }}>
        {title}
      </h2>
      <div className="w-max">{children}</div>
    </div>
  );
}
