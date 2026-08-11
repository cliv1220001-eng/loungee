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
