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

/** ADMIN: reject a cash-in request. Credits nothing. Body: { note? }. */
export async function POST(req: NextRequest, { params }: Ctx) {
  try {
    const user = getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const { id } = await params;
    const body = (await req.json().catch(() => ({}))) as { note?: string };
    const sb = getSupabase();

    const { error } = await sb.rpc("reject_cashin", {
      p_id: id,
      p_note: body.note ?? null,
      p_reviewed_by: user.username,
    });
    if (error) throw new Error(error.message);
    void audit(user.username, "cashin.reject", id, { note: body.note ?? null });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
