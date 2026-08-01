import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabase } from "@/lib/supabase";
import { startingLr } from "@/lib/lr";

function errorResponse(e: unknown) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * One page of a month's lr_events. `withKind` selects the `kind` column; when it
 * is false (the column predates seasons.sql) the caller treats every row as a
 * match. Two literal selects because the typed client rejects a dynamic string.
 */
function selectEvents(
  sb: SupabaseClient,
  r: { start: string; end: string; from: number; to: number },
  withKind: boolean
) {
  const t = sb.from("lr_events");
  return withKind
    ? t
        .select("email,delta,kind")
        .gte("created_at", r.start)
        .lt("created_at", r.end)
        .range(r.from, r.to)
    : t
        .select("email,delta")
        .gte("created_at", r.start)
        .lt("created_at", r.end)
        .range(r.from, r.to);
}

interface PlayerInput {
  email?: string;
  ign?: string;
  mmr?: number | string;
  position?: number | string | null;
}

/** Normalize a raw player into the shape register_players expects (with starting_lr). */
function toRegistryRow(p: PlayerInput) {
  const email = (p.email ?? "").trim().toLowerCase();
  const mmr = Math.max(0, Math.round(Number(p.mmr) || 0));
  const posNum = Number(p.position);
  const position = posNum >= 1 && posNum <= 5 ? posNum : null;
  return {
    email,
    ign: (p.ign ?? "").trim(),
    mmr,
    position,
    starting_lr: startingLr(mmr),
  };
}

// Leaderboard.
//   • no ?month     → every registered player, ranked by all-time LR.
//   • ?month=YYYY-MM → players who played that month, ranked by LR EARNED
//                      (net sum of that month's events).
export async function GET(request: Request) {
  try {
    const sb = getSupabase();
    const month = new URL(request.url).searchParams.get("month");

    // Paged for the same 1,000-row reason as the events query below.
    const PLAYER_PAGE = 1000;
    const players: {
      email: string;
      ign: string;
      peak_mmr: number;
      position: number | null;
      starting_lr: number;
      lr: number;
    }[] = [];
    for (let from = 0; ; from += PLAYER_PAGE) {
      const { data, error: pErr } = await sb
        .from("players")
        .select("email,ign,peak_mmr,position,starting_lr,lr")
        .range(from, from + PLAYER_PAGE - 1);
      if (pErr) throw new Error(pErr.message);
      const page = data ?? [];
      players.push(...page);
      if (page.length < PLAYER_PAGE) break;
    }

    if (!month) {
      const sorted = [...(players ?? [])].sort(
        (a, b) => b.lr - a.lr || (a.ign ?? "").localeCompare(b.ign ?? "")
      );
      return NextResponse.json({ period: "all", players: sorted });
    }

    const m = /^(\d{4})-(\d{2})$/.exec(month);
    if (!m) return NextResponse.json({ error: "month must be YYYY-MM." }, { status: 400 });
    const year = Number(m[1]);
    const mon = Number(m[2]);
    if (mon < 1 || mon > 12) {
      return NextResponse.json({ error: "month must be YYYY-MM." }, { status: 400 });
    }
    // Window months in Philippine time (UTC+8) — the league plays late-night PH,
    // so a game at 2am Aug 1 PH is 6pm Jul 31 UTC. Slicing by UTC would file it
    // under July; slicing by PH keeps it in the month it was actually played.
    // PH midnight on day 1 = UTC 16:00 the previous day, i.e. subtract 8 hours.
    const PH_OFFSET_MS = 8 * 60 * 60 * 1000;
    const start = new Date(Date.UTC(year, mon - 1, 1) - PH_OFFSET_MS).toISOString();
    const end = new Date(Date.UTC(year, mon, 1) - PH_OFFSET_MS).toISOString();

    // Page through the month's events. PostgREST caps a response at 1,000 rows
    // by default and does NOT report truncation, so a single query silently
    // under-counts every total once a month exceeds that many events.
    // The `kind` column only exists once seasons.sql has been run. Select it,
    // but fall back to a kind-less query so the leaderboard keeps working before
    // that migration lands (every existing row is a 'match' in that case).
    const PAGE = 1000;
    const events: { email: string; delta: number; kind?: string | null }[] = [];

    // Probe once whether `kind` exists, so the paging loop below never has to
    // retry mid-stream (an in-loop retry previously skipped a page and silently
    // undercounted every total). A failed probe on the missing column just means
    // pre-seasons data: every row is a match.
    let hasKind = true;
    {
      const probe = await selectEvents(sb, { start, end, from: 0, to: 0 }, true);
      if (probe.error) {
        if (/kind/.test(probe.error.message)) hasKind = false;
        else throw new Error(probe.error.message);
      }
    }

    for (let from = 0; ; from += PAGE) {
      const range = { start, end, from, to: from + PAGE - 1 };
      const res = await selectEvents(sb, range, hasKind);
      if (res.error) throw new Error(res.error.message);
      const page = (res.data ?? []) as { email: string; delta: number; kind?: string | null }[];
      events.push(...page);
      if (page.length < PAGE) break;
    }

    // "LR earned" and W/L count ONLY real match rows. Season bookkeeping is
    // excluded: the 30% carry-over is folded into starting_lr (not an event), and
    // 'reset' rows just remove a closed month's earnings from the all-time total.
    // So a past month always shows its true match earnings, and a freshly-reset
    // month starts at 0 earned until real games are played.
    const stats = new Map<string, { earned: number; wins: number; losses: number }>();
    for (const ev of events ?? []) {
      if ((ev.kind ?? "match") !== "match") continue;
      const s = stats.get(ev.email) ?? { earned: 0, wins: 0, losses: 0 };
      s.earned += ev.delta;
      if (ev.delta > 0) s.wins++;
      else if (ev.delta < 0) s.losses++;
      stats.set(ev.email, s);
    }

    const byEmail = new Map((players ?? []).map((p) => [p.email, p]));
    const rows = [...stats.entries()]
      .map(([email, s]) => {
        const p = byEmail.get(email);
        return {
          email,
          ign: p?.ign ?? email,
          peak_mmr: p?.peak_mmr ?? 0,
          position: p?.position ?? null,
          starting_lr: p?.starting_lr ?? 0,
          lr: p?.lr ?? 0,
          earned: s.earned,
          wins: s.wins,
          losses: s.losses,
        };
      })
      .sort((a, b) => b.earned - a.earned || (a.ign ?? "").localeCompare(b.ign ?? ""));

    return NextResponse.json({ period: month, players: rows });
  } catch (e) {
    return errorResponse(e);
  }
}

// Register / refresh a batch of players (keyed by email; deduped, case-insensitive).
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { players?: PlayerInput[] };
    const byEmail = new Map<string, ReturnType<typeof toRegistryRow>>();
    for (const p of body.players ?? []) {
      const row = toRegistryRow(p);
      if (row.email) byEmail.set(row.email, row); // last write wins on duplicate email
    }
    const rows = [...byEmail.values()];
    if (rows.length === 0) return NextResponse.json({ registered: 0 });

    const sb = getSupabase();
    const { error } = await sb.rpc("register_players", { p_players: rows });
    if (error) throw new Error(error.message);
    return NextResponse.json({ registered: rows.length });
  } catch (e) {
    return errorResponse(e);
  }
}
