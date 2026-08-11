import { NextResponse } from "next/server";
import { SESSION_COOKIE, makeSessionToken, type Role } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { verifyPassword } from "@/lib/password";
import { audit } from "@/lib/audit";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Per-user login. Checks the username + scrypt password hash in the `users`
 * table and issues a SIGNED session cookie carrying the username and role. Logins
 * are audit-logged.
 */
export async function POST(request: Request) {
  // Throttle brute-force: at most 8 attempts per 5 minutes per IP.
  const ip = clientIp(request);
  const rl = rateLimit(`login:${ip}`, 8, 5 * 60_000, Date.now());
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: "Too many attempts. Try again later." },
      { status: 429, headers: { "Retry-After": String(rl.retryAfter) } }
    );
  }

  let username = "";
  let password = "";
  try {
    const body = (await request.json()) as { username?: string; password?: string };
    username = (body.username ?? "").trim().toLowerCase();
    password = body.password ?? "";
  } catch {
    // malformed body → invalid credentials below
  }

  if (!username || !password) {
    return NextResponse.json({ ok: false, error: "Enter a username and password." }, { status: 401 });
  }

  try {
    const sb = getSupabase();
    const { data: user } = await sb
      .from("users")
      .select("username,pw_hash,role")
      .eq("username", username)
      .maybeSingle();

    if (user && verifyPassword(password, user.pw_hash)) {
      const role = (user.role === "owner" ? "owner" : "admin") as Role;
      const isHttps = request.headers.get("x-forwarded-proto") === "https";
      const res = NextResponse.json({ ok: true, username: user.username, role });
      res.cookies.set({
        name: SESSION_COOKIE,
        value: makeSessionToken({ username: user.username, role }),
        httpOnly: true,
        sameSite: "lax",
        secure: isHttps,
        path: "/",
        maxAge: 60 * 60 * 24 * 7, // 7 days
      });
      void audit(user.username, "login", null, { role });
      return res;
    }
  } catch {
    // fall through to the generic failure below
  }

  return NextResponse.json({ ok: false, error: "Invalid username or password." }, { status: 401 });
}
