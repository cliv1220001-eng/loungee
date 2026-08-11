import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { startingLr } from "@/lib/lr";

type Ctx = { params: Promise<{ id: string }> };

function errorResponse(e: unknown, status = 500) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status });
}

/**
 * ADMIN: approve a cash-in request and credit coins to the resolved player.
 *
 * Body: { email }              — credit an EXISTING registered player, or
 *       { newIgn, email? }     — create a lightweight registry player first.
 *
 * The coin ledger is email-keyed (like LR), so a cash-in must land on a real
 * players row. If the IGN didn't match anyone, the admin supplies an email (or we
 * mint a synthetic one from the IGN) and we register that player before crediting.
 * Crediting itself is idempotent (approve_cashin no-ops if already approved).
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as {
      email?: string;
      newIgn?: string;
    };
    const sb = getSupabase();

    const { data: reqRow, error: rErr } = await sb
      .from("cashin_requests")
      .select("id,ign,amount,status")
      .eq("id", id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!reqRow) return errorResponse(new Error("Request not found."), 404);
    if (reqRow.status === "rejected") {
      return errorResponse(new Error("This request was already rejected."), 400);
    }

    // Resolve the target player email. Prefer an explicitly chosen email; else
    // mint a synthetic, stable one from the IGN so the FK is satisfiable.
    let email = (body.email ?? "").trim().toLowerCase();
    const newIgn = (body.newIgn ?? reqRow.ign).trim();
    if (!email) {
      const slug = newIgn.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      if (!slug) return errorResponse(new Error("Choose a player to credit."), 400);
      email = `${slug}@ign.local`;
    }

    // Ensure the player exists (register is a no-op refresh if they already do).
    const { error: regErr } = await sb.rpc("register_players", {
      p_players: [{ email, ign: newIgn, mmr: 0, position: null, starting_lr: startingLr(0) }],
    });
    if (regErr) throw new Error(regErr.message);

    const { error: apErr } = await sb.rpc("approve_cashin", {
      p_id: id,
      p_email: email,
      p_reviewed_by: user.username,
    });
    if (apErr) throw new Error(apErr.message);
    void audit(user.username, "cashin.approve", email, { requestId: id, amount: reqRow.amount });

    const { data: player } = await sb
      .from("players")
      .select("email,ign,coins")
      .eq("email", email)
      .maybeSingle();

    return NextResponse.json({ ok: true, player });
  } catch (e) {
    return errorResponse(e);
  }
}
