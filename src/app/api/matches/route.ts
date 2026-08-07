import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

function errorResponse(e: unknown) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: 500 });
}

/**
 * The two sides of a single match, for the expandable rows on a player's history
 * page. A match is identified by (run_id, match_id) — match_id like "wb-r0-m0"
 * repeats across tournaments, so both are required. Winners have a positive
 * delta; from the viewer's perspective, same-result players are teammates and
 * the others are opponents.
 *
 * Query: ?run=<run_id>&match=<match_id>&email=<viewer email>
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const run = (url.searchParams.get("run") ?? "").trim();
    const match = (url.searchParams.get("match") ?? "").trim();
    const viewer = (url.searchParams.get("email") ?? "").trim().toLowerCase();
    if (!run || !match) {
      return NextResponse.json({ error: "run and match are required." }, { status: 400 });
    }

    const sb = getSupabase();
    const { data: rows, error: eErr } = await sb
      .from("lr_events")
      .select("email,delta")
      .eq("run_id", run)
      .eq("match_id", match)
      .eq("kind", "match");
    if (eErr) throw new Error(eErr.message);
    const participants = (rows ?? []) as { email: string; delta: number }[];

    // Resolve IGNs in one lookup.
    const emails = [...new Set(participants.map((p) => p.email))];
    const ignByEmail = new Map<string, string>();
    if (emails.length > 0) {
      const { data: players, error: pErr } = await sb
        .from("players")
        .select("email,ign")
        .in("email", emails);
      if (pErr) throw new Error(pErr.message);
      for (const p of (players ?? []) as { email: string; ign: string }[]) {
        ignByEmail.set(p.email, p.ign);
      }
    }

    const nameOf = (email: string) => ignByEmail.get(email) || email;
    const viewerWon = participants.find((p) => p.email === viewer)?.delta ?? 0;
    const viewerSideWins = viewerWon > 0;

    // With = same result as the viewer (excluding the viewer); Against = the rest.
    const teammates: string[] = [];
    const opponents: string[] = [];
    for (const p of participants) {
      if (p.email === viewer) continue;
      const won = p.delta > 0;
      (viewer && won === viewerSideWins ? teammates : opponents).push(nameOf(p.email));
    }

    // No viewer context (or viewer absent): just split by result.
    if (!viewer || !participants.some((p) => p.email === viewer)) {
      const winners = participants.filter((p) => p.delta > 0).map((p) => nameOf(p.email));
      const losers = participants.filter((p) => p.delta < 0).map((p) => nameOf(p.email));
      return NextResponse.json({ winners, losers, teammates: [], opponents: [] });
    }

    return NextResponse.json({ teammates, opponents });
  } catch (e) {
    return errorResponse(e);
  }
}
