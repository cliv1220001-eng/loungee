import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { isAdminRequest } from "@/lib/auth";

/**
 * ADMIN: the audit trail, newest first. Optional filters: ?actor=, ?action= (a
 * prefix like "cashin" matches cashin.approve/cashin.reject), ?limit=.
 */
export async function GET(req: NextRequest) {
  try {
    if (!isAdminRequest(req)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const sp = req.nextUrl.searchParams;
    const actor = sp.get("actor");
    const action = sp.get("action");
    const limit = Math.min(500, Math.max(1, Number(sp.get("limit")) || 200));

    const sb = getSupabase();
    let query = sb
      .from("audit_log")
      .select("id,actor,action,target,detail,created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (actor) query = query.eq("actor", actor);
    if (action) query = query.ilike("action", `${action}%`);

    const { data, error } = await query;
    if (error) throw new Error(error.message);
    return NextResponse.json({ entries: data ?? [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
