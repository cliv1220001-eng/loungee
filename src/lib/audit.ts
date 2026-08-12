import { getSupabase } from "@/lib/supabase";

// Append an audit entry. Fire-and-forget: auditing must never break the action
// it records, so failures are swallowed (best-effort accountability trail).
export async function audit(
  actor: string,
  action: string,
  target?: string | null,
  detail?: Record<string, unknown>
): Promise<void> {
  try {
    await getSupabase()
      .from("audit_log")
      .insert({ actor, action, target: target ?? null, detail: detail ?? null });
  } catch {
    // ignore — never let logging failure surface to the user
  }
}

/** UTC ISO timestamp for today's midnight in Philippine time (UTC+8, no DST). */
function phMidnightUtcIso(): string {
  const now = new Date();
  // Shift to PH wall-clock, take the date, and rebuild midnight in UTC terms.
  const ph = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  const y = ph.getUTCFullYear();
  const m = ph.getUTCMonth();
  const d = ph.getUTCDate();
  // PH midnight = that date 00:00 +08:00 = the previous day 16:00 UTC.
  return new Date(Date.UTC(y, m, d, 0, 0, 0) - 8 * 60 * 60 * 1000).toISOString();
}

/**
 * Append an audit entry only if this actor hasn't logged the same `action` yet
 * TODAY (Philippine time). Used for logins so a user signing in repeatedly makes
 * one entry per day instead of spamming the trail.
 */
export async function auditOncePerDay(
  actor: string,
  action: string,
  detail?: Record<string, unknown>
): Promise<void> {
  try {
    const sb = getSupabase();
    const { count } = await sb
      .from("audit_log")
      .select("id", { count: "exact", head: true })
      .eq("actor", actor)
      .eq("action", action)
      .gte("created_at", phMidnightUtcIso());
    if (count && count > 0) return; // already logged today
    await sb.from("audit_log").insert({ actor, action, target: null, detail: detail ?? null });
  } catch {
    // ignore — best-effort
  }
}
