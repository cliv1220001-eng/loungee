import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSupabase } from "@/lib/supabase";
import { canEditBalances, getSessionUser, isAdminRequest } from "@/lib/auth";
import { audit } from "@/lib/audit";

function errorResponse(e: unknown) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: 500 });
}

// All players with their cached coin balance, richest first. Admin-only.
export async function GET(req: NextRequest) {
  try {
    if (!isAdminRequest(req)) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    const sb = getSupabase();
    const { data, error } = await sb
      .from("players")
      .select("email,ign,coins,lr")
      .order("coins", { ascending: false });
    if (error) throw new Error(error.message);
    return NextResponse.json({ players: data ?? [] });
  } catch (e) {
    return errorResponse(e);
  }
}

// Manual balance adjustment (correction). Body: { email, delta, note? }.
// OWNER-ONLY: directly editing balances is restricted to owner accounts.
export async function POST(req: NextRequest) {
  try {
    const user = getSessionUser(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
    }
    if (!canEditBalances(req)) {
      return NextResponse.json(
        { error: "Only owners can edit balances directly." },
        { status: 403 }
      );
    }
    const body = (await req.json()) as { email?: string; delta?: number; note?: string };
    const email = (body.email ?? "").trim().toLowerCase();
    const delta = Math.trunc(Number(body.delta));
    if (!email) {
      return NextResponse.json({ error: "email is required." }, { status: 400 });
    }
    if (!Number.isFinite(delta) || delta === 0) {
      return NextResponse.json({ error: "delta must be a non-zero integer." }, { status: 400 });
    }
    const sb = getSupabase();
    const { error } = await sb.rpc("adjust_coins", {
      p_email: email,
      p_delta: delta,
      p_note: body.note ?? null,
    });
    if (error) throw new Error(error.message);
    void audit(user.username, "coins.adjust", email, { delta, note: body.note ?? null });

    const { data: player } = await sb
      .from("players")
      .select("email,ign,coins")
      .eq("email", email)
      .maybeSingle();
    return NextResponse.json({ ok: true, player });
  } catch (e) {
    return errorResponse(e);
  }
}
