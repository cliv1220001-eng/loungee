import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";

type Ctx = { params: Promise<{ id: string }> };

function errorResponse(e: unknown) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: 500 });
}

// Load one tournament with its full saved payload.
export async function GET(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const sb = getSupabase();
    const { data, error } = await sb
      .from("tournaments")
      .select("id,name,data,created_at")
      .eq("id", id)
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ tournament: data });
  } catch (e) {
    return errorResponse(e);
  }
}

// Fields inside `data` that are owned by the BRACKET page, not the balancer.
// The balancer's session payload never contains these, so a naive full-replace
// PUT from the balancer would erase the saved bracket (winners, champion) — the
// "bracket resets after Edit teams" bug. We preserve them here unless the caller
// explicitly sends them (e.g. the balancer clearing the bracket on regenerate).
const BRACKET_OWNED_KEYS = ["bracketRun", "championTeamId"] as const;

// Update a tournament's saved payload (and optionally its name).
export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { name?: string; data?: unknown };
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim() !== "") patch.name = body.name.trim();

    const sb = getSupabase();

    if (body.data !== undefined) {
      // Merge over the existing `data` so bracket-owned keys survive a balancer
      // save. Read-merge-write: the incoming session wins for its own keys, but
      // bracketRun / championTeamId are carried forward from what's already saved
      // UNLESS the incoming payload explicitly provides them (letting the
      // balancer clear the bracket when teams are regenerated).
      const { data: existingRow, error: rErr } = await sb
        .from("tournaments")
        .select("data")
        .eq("id", id)
        .maybeSingle();
      if (rErr) throw new Error(rErr.message);

      const existing = (existingRow?.data ?? {}) as Record<string, unknown>;
      const incoming = (body.data ?? {}) as Record<string, unknown>;
      const merged: Record<string, unknown> = { ...incoming };
      for (const key of BRACKET_OWNED_KEYS) {
        if (!(key in incoming) && key in existing) merged[key] = existing[key];
      }
      patch.data = merged;
    }

    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }
    const { data, error } = await sb
      .from("tournaments")
      .update(patch)
      .eq("id", id)
      .select("id,name,created_at")
      .single();
    if (error) throw new Error(error.message);
    return NextResponse.json({ tournament: data });
  } catch (e) {
    return errorResponse(e);
  }
}

// Delete a tournament.
export async function DELETE(_req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const sb = getSupabase();
    const { error } = await sb.from("tournaments").delete().eq("id", id);
    if (error) throw new Error(error.message);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return errorResponse(e);
  }
}
