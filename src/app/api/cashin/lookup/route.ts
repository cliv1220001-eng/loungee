import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";

/**
 * PUBLIC IGN autocomplete for the cash-in page (allow-listed in proxy.ts under
 * the /api/cashin prefix — this is a GET, and only returns IGN STRINGS, never
 * emails or balances). Helps a player enter their EXACT registered IGN so the
 * admin can match them to their account (which is keyed by email) on approval.
 *
 * Query: ?q=<partial ign> (min 2 chars). Returns up to 8 matching IGNs.
 */
export async function GET(req: NextRequest) {
  try {
    const q = (req.nextUrl.searchParams.get("q") ?? "").trim();
    if (q.length < 2) return NextResponse.json({ igns: [] });

    const sb = getSupabase();
    const { data, error } = await sb
      .from("players")
      .select("ign")
      .ilike("ign", `%${q}%`)
      .order("ign", { ascending: true })
      .limit(8);
    if (error) throw new Error(error.message);

    // Only expose the IGN text — no email, no balance.
    const igns = [...new Set((data ?? []).map((p) => (p.ign ?? "").trim()).filter(Boolean))];
    return NextResponse.json({ igns });
  } catch {
    // Fail soft — autocomplete is a convenience, not a gate.
    return NextResponse.json({ igns: [] });
  }
}
