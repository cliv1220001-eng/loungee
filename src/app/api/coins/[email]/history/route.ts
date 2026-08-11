import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { isAdminRequest } from "@/lib/auth";

type Ctx = { params: Promise<{ email: string }> };

function errorResponse(e: unknown) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: 500 });
}

// One player's coin ledger in chronological order, with the running balance
// after each event. Mirrors the LR history route. Admin-only.
export async function GET(req: NextRequest, { params }: Ctx) {
  try {
    if (!isAdminRequest(req)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const email = decodeURIComponent((await params).email).trim().toLowerCase();
    if (!email) {
      return NextResponse.json({ error: "email is required." }, { status: 400 });
    }

    const sb = getSupabase();

    const { data: player, error: pErr } = await sb
      .from("players")
      .select("email,ign,coins")
      .eq("email", email)
      .maybeSingle();
    if (pErr) throw new Error(pErr.message);
    if (!player) {
      return NextResponse.json({ error: "Player not found." }, { status: 404 });
    }

    const { data: events, error: eErr } = await sb
      .from("coin_events")
      .select("delta,kind,ref,note,created_at")
      .eq("email", email)
      .order("created_at", { ascending: true });
    if (eErr) throw new Error(eErr.message);

    // Coins have no "starting balance" — the ledger begins at 0 and cash-ins add
    // to it, so the running total starts at 0.
    let running = 0;
    const entries = (events ?? []).map((ev) => {
      running += ev.delta;
      return {
        delta: ev.delta,
        kind: ev.kind,
        ref: ev.ref,
        note: ev.note,
        balance: running,
        at: ev.created_at,
      };
    });

    return NextResponse.json({
      player: { email: player.email, ign: player.ign, coins: player.coins },
      // Newest first for display.
      events: entries.reverse(),
    });
  } catch (e) {
    return errorResponse(e);
  }
}
