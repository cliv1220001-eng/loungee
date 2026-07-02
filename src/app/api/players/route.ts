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

// Leaderboard: every registered player, highest LR first.
export async function GET() {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("players")
      .select("email,ign,peak_mmr,position,starting_lr,lr")
      .order("lr", { ascending: false })
      .order("ign", { ascending: true });
    if (error) throw new Error(error.message);
    return NextResponse.json({ players: data ?? [] });
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
