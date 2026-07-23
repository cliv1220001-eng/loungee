import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { startingLr } from "@/lib/lr";

function errorResponse(e: unknown) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: 500 });
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
    const start = new Date(Date.UTC(year, mon - 1, 1)).toISOString();
    const end = new Date(Date.UTC(year, mon, 1)).toISOString();

    // Page through the month's events. PostgREST caps a response at 1,000 rows
    // by default and does NOT report truncation, so a single query silently
    // under-counts every total once a month exceeds that many events.
    const PAGE = 1000;
    const events: { email: string; delta: number }[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error: eErr } = await sb
        .from("lr_events")
        .select("email,delta")
        .gte("created_at", start)
        .lt("created_at", end)
        .range(from, from + PAGE - 1);
      if (eErr) throw new Error(eErr.message);
      const page = data ?? [];
      events.push(...page);
      if (page.length < PAGE) break;
    }

    // Per player: net LR earned plus win/loss tallies. A positive delta is a win
    // (+40, or +60 for the champion match); a negative delta is a loss.
    const stats = new Map<string, { earned: number; wins: number; losses: number }>();
    for (const ev of events ?? []) {
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
