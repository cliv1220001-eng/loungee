import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { getSessionUser } from "@/lib/auth";
import { audit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

function errorResponse(e: unknown, status = 500) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status });
}

/**
 * ADMIN: settle a prop bet with the real outcome. Body: { outcome } to settle,
 * or { void: true } to refund. Win → player paid stake + mult·stake from the
 * house; lose → house keeps the stake.
 */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = getSessionUser(req);
    if (!user) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { outcome?: string; void?: boolean };
    const sb = getSupabase();

    if (body.void) {
      const { error } = await sb.rpc("void_prop_bet", { p_id: id });
      if (error) throw new Error(error.message);
      void audit(user.username, "prop.void", id);
      return NextResponse.json({ ok: true });
    }

    const outcome = (body.outcome ?? "").trim();
    if (!outcome) return errorResponse(new Error("Enter the outcome."), 400);
    const { error } = await sb.rpc("settle_prop_bet", { p_id: id, p_outcome: outcome });
    if (error) throw new Error(error.message);
    void audit(user.username, "prop.settle", id, { outcome });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
