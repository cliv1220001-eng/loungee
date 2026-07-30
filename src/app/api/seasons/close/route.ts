import { NextResponse } from "next/server";
import { getSupabase } from "@/lib/supabase";

function errorResponse(e: unknown) {
  const message = e instanceof Error ? e.message : "Unknown error";
  return NextResponse.json({ error: message }, { status: 500 });
}

interface CloseBody {
  /** Month to close, as "YYYY-MM". */
  month?: string;
  /** Fraction carried into the next month (0–1). Defaults to 0.30. */
  carryPct?: number;
}

/**
 * Close a monthly season: fold each player's net earnings for the month into a
 * carry-over (default 30%) and reset the rest from their all-time LR. Delegates
 * to the idempotent close_month() RPC — calling it twice for the same month is a
 * no-op, so this is safe to retry.
 *
 * Past months stay fully intact for history: the reset is a 'reset'-kind event
 * that the leaderboard ignores, so a closed month still shows its true earnings.
 */
export async function POST(request: Request) {
  try {
    const body = (await request.json()) as CloseBody;
    const m = /^(\d{4})-(\d{2})$/.exec((body.month ?? "").trim());
    if (!m) {
      return NextResponse.json({ error: "month must be YYYY-MM." }, { status: 400 });
    }
    const mon = Number(m[2]);
    if (mon < 1 || mon > 12) {
      return NextResponse.json({ error: "month must be YYYY-MM." }, { status: 400 });
    }
    const yyyymm = Number(m[1]) * 100 + mon;

    const carryPct =
      body.carryPct === undefined || Number.isNaN(Number(body.carryPct))
        ? 0.3
        : Math.min(1, Math.max(0, Number(body.carryPct)));

    const sb = getSupabase();
    const { data, error } = await sb.rpc("close_month", {
      p_yyyymm: yyyymm,
      p_carry_pct: carryPct,
    });
    if (error) throw new Error(error.message);

    // close_month returns a single row: { players_closed, total_carried }.
    const result = Array.isArray(data) ? data[0] : data;
    return NextResponse.json({
      ok: true,
      month: body.month,
      carryPct,
      playersClosed: result?.players_closed ?? 0,
      totalCarried: result?.total_carried ?? 0,
    });
  } catch (e) {
    return errorResponse(e);
  }
}
