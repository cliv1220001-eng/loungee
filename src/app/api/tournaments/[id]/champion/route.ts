import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

function errorResponse(e: unknown) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: 500 });
}

interface TeamLike {
  id: number;
  players: { email?: string | null }[];
}

/**
 * Reconstruct a past tournament's champion from its LR match history.
 *
 * Bracket state was never saved to the DB (it lived in browser localStorage), but
 * every match wrote lr_events tagged with the tournament's run_id (== its id).
 * Winners have a positive delta. The champion is the team that WON and never LOST
 * across the run — recovered by mapping each match's winning/losing emails back
 * to the teams stored in the tournament's saved data.
 *
 * Returns { championTeamId: number | null }. Null when the tournament wasn't
 * played to a decisive result (no matches, or no single unbeaten team).
 */
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const sb = getSupabase();

    // The saved teams (to map emails → team id).
    const { data: tourney, error: tErr } = await sb
      .from("tournaments")
      .select("data")
      .eq("id", id)
      .maybeSingle();
    if (tErr) throw new Error(tErr.message);
    // Prefer a DB-saved champion (persisted from the bracket); otherwise fall
    // back to reconstructing it from LR history below.
    const saved = (tourney?.data as { championTeamId?: number | null } | undefined)
      ?.championTeamId;
    if (saved != null) {
      return NextResponse.json({ championTeamId: saved });
    }
    const teams = (tourney?.data?.result?.teams ?? []) as TeamLike[];
    if (teams.length === 0) {
      return NextResponse.json({ championTeamId: null });
    }

    const teamOf = new Map<string, number>();
    for (const t of teams) {
      for (const p of t.players ?? []) {
        const e = (p.email ?? "").trim().toLowerCase();
        if (e) teamOf.set(e, t.id);
      }
    }

    // All real match events for this run (paged; a run stays well under 1000).
    const { data: events, error: eErr } = await sb
      .from("lr_events")
      .select("match_id,email,delta,kind")
      .eq("run_id", id)
      .eq("kind", "match")
      .range(0, 999);
    if (eErr) throw new Error(eErr.message);

    // Per match, which teams won and which lost.
    const wonSome = new Set<number>();
    const lostSome = new Set<number>();
    for (const ev of events ?? []) {
      const team = teamOf.get((ev.email ?? "").trim().toLowerCase());
      if (team == null) continue;
      if (ev.delta > 0) wonSome.add(team);
      else if (ev.delta < 0) lostSome.add(team);
    }

    // The champion won at least once and never lost. If exactly one such team,
    // that's the winner; otherwise the run wasn't decided cleanly.
    const unbeaten = [...wonSome].filter((t) => !lostSome.has(t));
    const championTeamId = unbeaten.length === 1 ? unbeaten[0] : null;

    return NextResponse.json({ championTeamId });
  } catch (e) {
    return errorResponse(e);
  }
}
