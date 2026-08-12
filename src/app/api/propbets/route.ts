import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getSessionUser, isAdminRequest } from "@/lib/auth";
import { audit } from "@/lib/audit";

function errorResponse(e: unknown, status = 500) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status });
}

/** Markets and their fixed payout multiples + allowed picks. */
const MARKETS: Record<string, { mult: number; picks: string[] }> = {
  "6min": { mult: 1, picks: ["Top", "Bottom"] },
  "8min": { mult: 1, picks: ["Top", "Bottom"] },
  "10min": { mult: 1, picks: ["Top", "Bottom"] },
  "12min": { mult: 3, picks: ["DD", "Haste", "Invisibility", "Regeneration", "Arcane", "Illusion", "Shield"] },
};

/** ADMIN: list prop bets for a tournament (?runId=). */
export async function GET(req: NextRequest) {
  try {
    if (!isAdminRequest(req)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const runId = req.nextUrl.searchParams.get("runId");
    if (!runId) return errorResponse(new Error("runId is required."), 400);
    const sb = getSupabase();
    const { data, error } = await sb
      .from("admin_bets")
      .select("id,run_id,email,market,pick,stake,payout_mult,status,outcome,created_at")
      .eq("run_id", runId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
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
 * ADMIN: place a prop bet (user vs house, no fee). Body:
 * { runId, email, market, pick, stake }. The multiple is fixed by the market.
 */
export async function POST(req: NextRequest) {
  try {
    const user = getSessionUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const body = (await req.json()) as {
      runId?: string;
      email?: string;
      market?: string;
      pick?: string;
      stake?: number;
    };
    const runId = (body.runId ?? "").trim();
    const email = (body.email ?? "").trim().toLowerCase();
    const market = (body.market ?? "").trim();
    const pick = (body.pick ?? "").trim();
    const stake = Math.trunc(Number(body.stake));

    if (!runId || !email) return errorResponse(new Error("Missing tournament/player."), 400);
    const m = MARKETS[market];
    if (!m) return errorResponse(new Error("Unknown market."), 400);
    if (!m.picks.includes(pick)) return errorResponse(new Error("Invalid pick for that market."), 400);
    if (!Number.isFinite(stake) || stake <= 0) return errorResponse(new Error("Enter a positive stake."), 400);

    const sb = getSupabase();
    const { data: id, error } = await sb.rpc("place_prop_bet", {
      p_run_id: runId,
      p_email: email,
      p_market: market,
      p_pick: pick,
      p_stake: stake,
      p_mult: m.mult,
    });
    if (error) {
      const msg = error.message.includes("insufficient")
        ? "Player doesn't have enough coins."
        : error.message;
      return errorResponse(new Error(msg), 400);
    }
    void audit(user.username, "prop.place", `${runId}`, { email, market, pick, stake, mult: m.mult });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return errorResponse(e);
  }
}
