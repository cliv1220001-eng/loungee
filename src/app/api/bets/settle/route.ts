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
 * ADMIN: settle every open bet on a match against the winning team.
 * Body: { runId, matchId, winningTeamId }. Idempotent — only touches open bets,
 * so it is safe to call automatically whenever a bracket match resolves.
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
      winningTeamId?: number;
    };
    const runId = (body.runId ?? "").trim();
    const matchId = (body.matchId ?? "").trim();
    const winningTeamId = Math.trunc(Number(body.winningTeamId));
    if (!runId || !matchId || !Number.isFinite(winningTeamId)) {
      return errorResponse(new Error("runId, matchId and winningTeamId are required."), 400);
    }

    const sb = getSupabase();
    // Which bets are still open BEFORE settling — so we only audit a real
    // settlement (the bracket calls this idempotently on every resolve).
    const { count: openBefore } = await sb
      .from("bets")
      .select("id", { count: "exact", head: true })
      .eq("run_id", runId)
      .eq("match_id", matchId)
      .eq("status", "open");

    const { error } = await sb.rpc("settle_match", {
      p_run_id: runId,
      p_match_id: matchId,
      p_winning_team_id: winningTeamId,
    });
    if (error) throw new Error(error.message);

    if (openBefore && openBefore > 0) {
      void audit(user.username, "bet.settle", `${runId}/${matchId}`, { winningTeamId, settled: openBefore });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
