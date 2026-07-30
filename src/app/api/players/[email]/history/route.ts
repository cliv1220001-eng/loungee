import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ email: string }> };

function errorResponse(e: unknown) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: 500 });
}

// One player's match history: every LR event in chronological order, with the
// running LR after each. Win/loss is the sign of the delta (+40/+60 win, −40
// loss). Derived entirely from existing lr_events — no extra data is stored.
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const email = decodeURIComponent((await params).email).trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "email is required." }, { status: 400 });
    }

    const sb = getSupabase();

    const { data: player, error: pErr } = await sb
      .from("players")
      .select("email,ign,peak_mmr,position,starting_lr,lr")
      .eq("email", email)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!player) {
      return NextResponse.json({ error: "Player not found." }, { status: 404 });
    }

    const { data: events, error: eErr } = await sb
      .from("lr_events")
      .select("match_id,delta,created_at,kind")
      .eq("email", email)
      .order("created_at", { ascending: true });
    if (eErr) throw new Error(eErr.message);

    // Walk chronologically from the immutable starting LR, applying EVERY delta
    // (matches, plus season 'reset'/'carry' bookkeeping) so the running total
    // reconciles with players.lr. Only 'match' rows are treated as games with a
    // win/loss; 'reset'/'carry' are surfaced as neutral season adjustments.
    let running = player.starting_lr;
    const entries = (events ?? []).map((ev) => {
      running += ev.delta;
      const kind = ev.kind ?? "match";
      return {
        matchId: ev.match_id,
        delta: ev.delta,
        kind,
        won: kind === "match" ? ev.delta > 0 : null,
        lr: running,
        playedAt: ev.created_at,
      };
    });

    const wins = entries.filter((m) => m.kind === "match" && m.won).length;
    const losses = entries.filter((m) => m.kind === "match" && m.won === false).length;
    const matches = entries;

    return NextResponse.json({
      player: {
        email: player.email,
        ign: player.ign,
        peak_mmr: player.peak_mmr,
        position: player.position,
        starting_lr: player.starting_lr,
        lr: player.lr,
      },
      wins,
      losses,
      // Newest first for display; the running LR was computed oldest-first above.
      matches: matches.reverse(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
