import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { isAdminRequest } from "@/lib/auth";

function errorResponse(e: unknown, status = 500) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status });
}

/**
 * ADMIN: the per-player breakdown of a settled match — who won/lost, the +/-
 * coins, their current balance, and which team they backed, plus the house take.
 * Query: ?runId=<id>&matchId=<id>.
 */
export async function GET(req: NextRequest) {
  try {
    if (!isAdminRequest(req)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const runId = (req.nextUrl.searchParams.get("runId") ?? "").trim();
    const matchId = (req.nextUrl.searchParams.get("matchId") ?? "").trim();
    if (!runId || !matchId) return errorResponse(new Error("runId and matchId required."), 400);

    const sb = getSupabase();
    const { data: bets, error } = await sb
      .from("bets")
      .select("id,email,team_id,stake,fee,kind,status,payout,pair_id")
      .eq("run_id", runId)
      .eq("match_id", matchId);
    if (error) throw new Error(error.message);

    const all = bets ?? [];
    const emails = [...new Set(all.map((b) => b.email))];
    const info = new Map<string, { ign: string; coins: number }>();
    if (emails.length) {
      const { data: players } = await sb.from("players").select("email,ign,coins").in("email", emails);
      for (const p of players ?? []) info.set(p.email, { ign: p.ign ?? p.email, coins: p.coins });
    }
    const ignOf = (email: string) => info.get(email)?.ign ?? email;
    const balOf = (email: string) => info.get(email)?.coins ?? null;
    const netOf = (b: (typeof all)[number]) => {
      const cost = b.stake + (b.fee ?? 0);
      return b.status === "won" ? b.payout - cost : b.status === "lost" ? -cost : 0;
    };

    let houseTake = 0;

    // Team bets — one row per player.
    const teamBets = all.filter((b) => b.kind === "game");
    const rows = teamBets.map((b) => {
      houseTake += b.fee ?? 0;
      return {
        ign: ignOf(b.email),
        teamId: b.team_id,
        status: b.status,
        net: netOf(b),
        balance: balOf(b.email),
      };
    });
    rows.sort((a, b) => (b.status === "won" ? 1 : 0) - (a.status === "won" ? 1 : 0) || b.net - a.net);

    // Side bets — pair the two legs into head-to-head rows.
    const sideLegs = all.filter((b) => b.kind === "side");
    const used = new Set<string>();
    const sideBets: {
      a: { ign: string; teamId: number; net: number; won: boolean };
      b: { ign: string; teamId: number; net: number; won: boolean } | null;
      stake: number;
    }[] = [];
    for (const leg of sideLegs) {
      if (used.has(leg.id)) continue;
      used.add(leg.id);
      const mate =
        sideLegs.find((x) => !used.has(x.id) && leg.pair_id && x.pair_id === leg.pair_id) ??
        sideLegs.find((x) => !used.has(x.id) && x.stake === leg.stake);
      if (mate) used.add(mate.id);
      // 5% fee to the house comes off the winning side.
      const winner = leg.status === "won" ? leg : mate?.status === "won" ? mate : null;
      if (winner) houseTake += Math.floor(winner.stake * 2 * 0.05);
      sideBets.push({
        a: { ign: ignOf(leg.email), teamId: leg.team_id, net: netOf(leg), won: leg.status === "won" },
        b: mate
          ? { ign: ignOf(mate.email), teamId: mate.team_id, net: netOf(mate), won: mate.status === "won" }
          : null,
        stake: leg.stake,
      });
    }

    // Rune / player-vs-house bets for this tournament (settled ones show a result).
    const { data: props } = await sb
      .from("admin_bets")
      .select("email,market,pick,stake,payout_mult,status,outcome")
      .eq("run_id", runId)
      .order("created_at", { ascending: true });
    const propEmails = [...new Set((props ?? []).map((p) => p.email))];
    for (const e of propEmails) {
      if (!info.has(e)) {
        const { data: pl } = await sb.from("players").select("ign,coins").eq("email", e).maybeSingle();
        if (pl) info.set(e, { ign: pl.ign ?? e, coins: pl.coins });
      }
    }
    const runeBets = (props ?? []).map((p) => {
      // win → player nets +stake*mult; house pays that. lose → house keeps stake.
      const net = p.status === "won" ? p.stake * p.payout_mult : p.status === "lost" ? -p.stake : 0;
      if (p.status === "won") houseTake -= p.stake * p.payout_mult;
      if (p.status === "lost") houseTake += p.stake;
      return {
        ign: ignOf(p.email),
        market: p.market,
        pick: p.pick,
        stake: p.stake,
        mult: p.payout_mult,
        status: p.status,
        outcome: p.outcome as string | null,
        net,
      };
    });

    return NextResponse.json({ rows, sideBets, runeBets, houseTake });
  } catch (e) {
    return errorResponse(e);
  }
}
