import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

function errorResponse(e: unknown, status = 500) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status });
}

/**
 * ADMIN: record a MATCHED side bet — a head-to-head between two players on
 * opposite teams, each staking the same amount. Winner takes the loser's stake.
 *
 * It's two even-money `place_bet` legs (kind='side') on the same match:
 *   - playerA on teamA, playerB on teamB, both at `stake`.
 * When the bracket settles the match, the winning side's leg pays 2×stake (stake
 * back + the loser's stake) and the losing side's leg pays nothing — netting the
 * winner +stake and the loser −stake.
 *
 * Both legs are placed in one request; if the second fails (e.g. insufficient
 * balance) the first is rolled back so you never get a half-recorded pair.
 *
 * Body: { runId, matchId, stake, playerA, teamA, playerB, teamB }.
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
      stake?: number;
      playerA?: string;
      teamA?: number;
      playerB?: string;
      teamB?: number;
    };
    const runId = (body.runId ?? "").trim();
    const matchId = (body.matchId ?? "").trim();
    const stake = Math.trunc(Number(body.stake));
    const playerA = (body.playerA ?? "").trim().toLowerCase();
    const playerB = (body.playerB ?? "").trim().toLowerCase();
    const teamA = Math.trunc(Number(body.teamA));
    const teamB = Math.trunc(Number(body.teamB));

    if (!runId || !matchId) return errorResponse(new Error("Missing tournament/match."), 400);
    if (!playerA || !playerB) return errorResponse(new Error("Pick two players."), 400);
    if (playerA === playerB) return errorResponse(new Error("Pick two different players."), 400);
    if (!Number.isFinite(teamA) || !Number.isFinite(teamB) || teamA === teamB) {
      return errorResponse(new Error("The two players must back different teams."), 400);
    }
    if (!Number.isFinite(stake) || stake <= 0) {
      return errorResponse(new Error("Enter a positive stake."), 400);
    }

    const sb = getSupabase();

    // Leg 1.
    const { data: idA, error: errA } = await sb.rpc("place_bet", {
      p_run_id: runId,
      p_match_id: matchId,
      p_email: playerA,
      p_team_id: teamA,
      p_stake: stake,
      p_kind: "side",
    });
    if (errA) {
      const msg = errA.message.includes("insufficient")
        ? "First player doesn't have enough coins."
        : errA.message;
      return errorResponse(new Error(msg), 400);
    }

    // Leg 2 — if it fails, void leg 1 so no half-pair is left behind.
    const { data: idB, error: errB } = await sb.rpc("place_bet", {
      p_run_id: runId,
      p_match_id: matchId,
      p_email: playerB,
      p_team_id: teamB,
      p_stake: stake,
      p_kind: "side",
    });
    if (errB) {
      await sb.rpc("void_bet", { p_id: idA });
      const msg = errB.message.includes("insufficient")
        ? "Second player doesn't have enough coins."
        : errB.message;
      return errorResponse(new Error(msg), 400);
    }

    void audit(user.username, "bet.side", `${runId}/${matchId}`, {
      stake,
      playerA,
      teamA,
      playerB,
      teamB,
    });
    return NextResponse.json({ ok: true, ids: [idA, idB] });
  } catch (e) {
    return errorResponse(e);
  }
}
