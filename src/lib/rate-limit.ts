// Tiny in-memory rate limiter (no dependencies). Per-key sliding window.
//
// Caveat: state lives in this server process — it resets on redeploy and is NOT
// shared across multiple instances. That's fine for a small single-instance
// deployment; for a horizontally-scaled setup, swap this for a shared store
// (e.g. Upstash Redis) behind the same `rateLimit()` signature.

interface Hits {
  /** Timestamps (ms) of recent hits within the window. */
  times: number[];
}

const buckets = new Map<string, Hits>();

// Opportunistic cleanup so the map doesn't grow unbounded. Runs at most once per
// sweep interval, dropping keys whose newest hit is older than `maxWindowMs`.
let lastSweep = 0;
const SWEEP_EVERY_MS = 60_000;
const MAX_WINDOW_MS = 60 * 60 * 1000; // keep at most an hour of history

function sweep(now: number) {
  if (now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  for (const [key, h] of buckets) {
    const last = h.times[h.times.length - 1] ?? 0;
    if (now - last > MAX_WINDOW_MS) buckets.delete(key);
  }
}

export interface RateLimitResult {
  ok: boolean;
  /** Remaining allowed hits in the current window. */
  remaining: number;
  /** Seconds until the caller may retry (0 when ok). */
  retryAfter: number;
}

/**
 * Allow at most `limit` hits per `windowMs` for `key`. Records the hit when
 * allowed. Returns `ok:false` (and a retry-after) when the limit is exceeded.
 */
export function rateLimit(key: string, limit: number, windowMs: number, nowMs: number): RateLimitResult {
  const now = nowMs;
  sweep(now);
  const h = buckets.get(key) ?? { times: [] };
  // Drop hits outside the window.
  const cutoff = now - windowMs;
  h.times = h.times.filter((t) => t > cutoff);

  if (h.times.length >= limit) {
    buckets.set(key, h);
    const oldest = h.times[0];
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    return { ok: false, remaining: 0, retryAfter };
  }

  h.times.push(now);
  buckets.set(key, h);
  return { ok: true, remaining: limit - h.times.length, retryAfter: 0 };
}

/** Best-effort client IP from proxy headers (Vercel/most hosts set these). */
export function clientIp(req: {
  headers: { get(name: string): string | null };
}): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0]!.trim();
  return req.headers.get("x-real-ip") ?? "unknown";
}
