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

/** ADMIN: void a bet, refunding the stake (only if still open). */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const { id } = await params;
    const sb = getSupabase();
    const { error } = await sb.rpc("void_bet", { p_id: id });
    if (error) throw new Error(error.message);
    void audit(user.username, "bet.void", id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
