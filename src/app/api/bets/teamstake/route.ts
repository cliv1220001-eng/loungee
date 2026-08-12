import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

function errorResponse(e: unknown, status = 500) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status });
}

/** Allowed team-stake tiers. */
const TIERS = [20, 50, 100];
/** Flat per-player fee (coins == pesos), taken from each stake, to the house. */
const TEAM_FEE = 5;

/**
 * ADMIN: lock in a Bet Game's team wager. EVERY player on team A bets `stake` on
 * team A, and every player on team B bets on team B — even money, settled when the
 * bracket decides. Winning team's players get +stake, losers −stake.
 *
 * Placed atomically: if ANY player can't afford the stake, nothing is placed and
 * we report who's short. If a later insert fails, the ones already placed are
 * voided so the game never ends up half-staked.
 *
 * Body: { runId, matchId, stake, teamA, teamB, playersA: string[], playersB: string[] }
 * where playersA/B are the lowercased emails on each team.
 */
export async function POST(req: NextRequest) {
  try {
    const user = getSessionUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

    const body = (await req.json()) as {
      runId?: string;
      matchId?: string;
      stake?: number;
      teamA?: number;
      teamB?: number;
      playersA?: string[];
      playersB?: string[];
    };
    const runId = (body.runId ?? "").trim();
    const matchId = (body.matchId ?? "").trim();
    const stake = Math.trunc(Number(body.stake));
    const teamA = Math.trunc(Number(body.teamA));
    const teamB = Math.trunc(Number(body.teamB));
    const norm = (xs?: string[]) =>
      [...new Set((xs ?? []).map((e) => (e ?? "").trim().toLowerCase()).filter(Boolean))];
    const playersA = norm(body.playersA);
    const playersB = norm(body.playersB);

    if (!runId || !matchId) return errorResponse(new Error("Missing tournament/match."), 400);
    if (!Number.isFinite(teamA) || !Number.isFinite(teamB) || teamA === teamB) {
      return errorResponse(new Error("Two distinct teams are required."), 400);
    }
    if (!TIERS.includes(stake)) {
      return errorResponse(new Error("Stake must be 20, 50 or 100."), 400);
    }
    if (playersA.length === 0 || playersB.length === 0) {
      return errorResponse(new Error("Both teams need players with coin accounts."), 400);
    }

    const sb = getSupabase();
    const everyone = [...playersA, ...playersB];

    // Affordability pre-check across ALL players — block with a clear list.
    const { data: rows, error: balErr } = await sb
      .from("players")
      .select("email,ign,coins")
      .in("email", everyone);
    if (balErr) throw new Error(balErr.message);
    const byEmail = new Map((rows ?? []).map((r) => [r.email, r]));
    const short = everyone
      .map((e) => byEmail.get(e))
      .filter((p) => !p || p.coins < stake)
      .map((p, i) => (p ? p.ign || p.email : `player ${i + 1}`));
    if (short.length > 0) {
      return errorResponse(
        new Error(`Not enough coins (need ${stake} each): ${short.join(", ")}`),
        400
      );
    }

    // Don't double-stake the same match.
    const { count: existing } = await sb
      .from("bets")
      .select("id", { count: "exact", head: true })
      .eq("run_id", runId)
      .eq("match_id", matchId)
      .eq("kind", "game");
    if (existing && existing > 0) {
      return errorResponse(new Error("Bets are already locked in for this game."), 400);
    }

    // Place a bet per player on their own team. Track ids to roll back on failure.
    const placed: string[] = [];
    const placeAll = async (emails: string[], teamId: number) => {
      for (const email of emails) {
        // place_team_bet takes the flat fee (₱5) from the stake → house.
        const { data: id, error } = await sb.rpc("place_team_bet", {
          p_run_id: runId,
          p_match_id: matchId,
          p_email: email,
          p_team_id: teamId,
          p_stake: stake,
          p_fee: TEAM_FEE,
        });
        if (error) throw new Error(error.message);
        placed.push(id as string);
      }
    };

    try {
      await placeAll(playersA, teamA);
      await placeAll(playersB, teamB);
    } catch (e) {
      // Roll back anything already placed so the game isn't half-staked.
      for (const id of placed) {
        try {
          await sb.rpc("void_bet", { p_id: id });
        } catch {
          // best-effort rollback
        }
      }
      return errorResponse(e, 400);
    }

    void audit(user.username, "bet.teamstake", `${runId}/${matchId}`, {
      stake,
      teamA,
      teamB,
      count: everyone.length,
    });
    return NextResponse.json({ ok: true, placed: placed.length });
  } catch (e) {
    return errorResponse(e);
  }
}
