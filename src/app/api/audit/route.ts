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
    const entries = data ?? [];

    // Enrich with tournament names. Targets for tournament/bet actions look like
    // "<runId>" or "<runId>/<matchId>"; resolve the runId (a UUID) to its name so
    // the log reads "LGBet 34" instead of a raw id.
    const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    const runIds = new Set<string>();
    for (const e of entries) {
      const first = (e.target ?? "").split("/")[0];
      if (uuidRe.test(first)) runIds.add(first);
    }
    const nameById = new Map<string, string>();
    if (runIds.size) {
      const { data: tourneys } = await sb
        .from("tournaments")
        .select("id,name")
        .in("id", [...runIds]);
      for (const t of tourneys ?? []) nameById.set(t.id, t.name);
    }
    const enriched = entries.map((e) => {
      const first = (e.target ?? "").split("/")[0];
      return { ...e, tournamentName: nameById.get(first) ?? null };
    });

    return NextResponse.json({ entries: enriched });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
