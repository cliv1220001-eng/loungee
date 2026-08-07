import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

function errorResponse(e: unknown) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: 500 });
}

/** The bracket state we persist so a tournament replays exactly on reload. */
interface BracketState {
  format?: "single" | "double";
  seed?: number;
  winners?: Record<string, "a" | "b">;
  championTeamId?: number | null;
}

/**
 * Persist a tournament's live bracket state (format, seed, per-match winners,
 * champion) into its saved `data.bracketRun`. Read-merge-write so it only
 * touches that field and leaves the rest of the tournament payload intact.
 *
 * This is what makes the bracket survive a browser reset / different device:
 * before, winners lived only in localStorage and could be wiped. Now every round
 * pick is saved to the DB and restored on load.
 */
export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const bracket = (await req.json()) as BracketState;
    const sb = getSupabase();

    const { data: row, error: rErr } = await sb
      .from("tournaments")
      .select("data")
      .eq("id", id)
      .maybeSingle();
    if (rErr) throw new Error(rErr.message);
    if (!row) {
      // A bracket opened via direct nav may not map to a saved tournament; that's
      // fine — nothing to persist against.
      return NextResponse.json({ ok: true, saved: false });
    }

    const data = (row.data ?? {}) as Record<string, unknown>;
    const nextData = {
      ...data,
      bracketRun: {
        format: bracket.format ?? "single",
        seed: bracket.seed ?? 0,
        winners: bracket.winners ?? {},
        championTeamId: bracket.championTeamId ?? null,
      },
      // Keep the top-level completion flag in sync so history reflects it.
      championTeamId: bracket.championTeamId ?? null,
    };

    const { error: uErr } = await sb
      .from("tournaments")
      .update({ data: nextData })
      .eq("id", id);
    if (uErr) throw new Error(uErr.message);

    return NextResponse.json({ ok: true, saved: true });
  } catch (e) {
    return errorResponse(e);
  }
}
