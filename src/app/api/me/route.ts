import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth";

/** The current admin's identity + role, for role-gating the UI. */
export async function GET(req: NextRequest) {
  const user = getSessionUser(req);
  if (!user) return NextResponse.json({ user: null }, { status: 401 });
  return NextResponse.json({ user });
}
