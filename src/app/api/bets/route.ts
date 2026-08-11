import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getSessionUser, isAdminRequest } from "@/lib/auth";
import { audit } from "@/lib/audit";

function errorResponse(e: unknown, status = 500) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status });
}

/** ADMIN: bets for a tournament (?runId=...), newest first. */
export async function GET(req: NextRequest) {
  try {
    if (!isAdminRequest(req)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const runId = req.nextUrl.searchParams.get("runId");
    if (!runId) return errorResponse(new Error("runId is required."), 400);

    const sb = getSupabase();
    const { data, error } = await sb
      .from("bets")
      .select("id,run_id,match_id,email,team_id,stake,kind,status,payout,created_at,settled_at")
      .eq("run_id", runId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    // Attach the bettor's IGN for display.
    const emails = [...new Set((data ?? []).map((b) => b.email))];
    const ignByEmail = new Map<string, string>();
    if (emails.length) {
      const { data: players } = await sb.from("players").select("email,ign").in("email", emails);
      for (const p of players ?? []) ignByEmail.set(p.email, p.ign ?? "");
    }
    const bets = (data ?? []).map((b) => ({ ...b, ign: ignByEmail.get(b.email) ?? b.email }));

    return NextResponse.json({ bets });
  } catch (e) {
    return errorResponse(e);
  }
}

/**
 * ADMIN: place a bet. Body: { runId, matchId, email, teamId, stake }.
 * Debits the stake immediately (place_bet RPC), rejecting if the balance is short.
 */
export async function POST(req: NextRequest) {
  try {
    const user = getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const body = (await req.json()) as {
      runId?: string;
      matchId?: string;
      email?: string;
      teamId?: number;
      stake?: number;
      kind?: "game" | "side";
    };
    const runId = (body.runId ?? "").trim();
    const matchId = (body.matchId ?? "").trim();
    const email = (body.email ?? "").trim().toLowerCase();
    const teamId = Math.trunc(Number(body.teamId));
    const stake = Math.trunc(Number(body.stake));
    const kind: "game" | "side" = body.kind === "side" ? "side" : "game";

    if (!runId || !matchId || !email) {
      return errorResponse(new Error("runId, matchId and email are required."), 400);
    }
    if (!Number.isFinite(teamId)) {
      return errorResponse(new Error("A team must be chosen."), 400);
    }
    if (!Number.isFinite(stake) || stake <= 0) {
      return errorResponse(new Error("Stake must be a positive number."), 400);
    }
    // Game bets are limited to the fixed tiers; side bets have no cap. (The RPC
    // enforces this too — this just returns a friendlier error sooner.)
    if (kind === "game" && ![20, 50, 100].includes(stake)) {
      return errorResponse(new Error("Game bets must be 20, 50 or 100 coins."), 400);
    }

    const sb = getSupabase();
    const { data: betId, error } = await sb.rpc("place_bet", {
      p_run_id: runId,
      p_match_id: matchId,
      p_email: email,
      p_team_id: teamId,
      p_stake: stake,
      p_kind: kind,
    });
    if (error) {
      // Surface a friendly message for the common "insufficient balance" case.
      const msg = error.message.includes("insufficient")
        ? "Not enough coins for that stake."
        : error.message;
      return errorResponse(new Error(msg), 400);
    }

    void audit(user.username, "bet.place", email, { runId, matchId, teamId, stake, kind, betId });
    return NextResponse.json({ ok: true, id: betId });
  } catch (e) {
    return errorResponse(e);
  }
}
