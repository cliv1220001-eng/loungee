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

// Update a tournament's saved payload (and optionally its name).
export async function PUT(req: NextRequest, { params }: Ctx) {
  try {
    const { id } = await params;
    const body = (await req.json()) as { name?: string; data?: unknown };
    const patch: Record<string, unknown> = {};
    if (typeof body.name === "string" && body.name.trim() !== "") patch.name = body.name.trim();
    if (body.data !== undefined) patch.data = body.data;
    if (Object.keys(patch).length === 0) {
      return NextResponse.json({ error: "Nothing to update." }, { status: 400 });
    }
    const sb = getSupabase();
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
