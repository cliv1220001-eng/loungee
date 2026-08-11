// Server-only auth. Multi-user: each admin has their own account (users table)
// and the session cookie carries a SIGNED token identifying who they are + their
// role. Never import this from a Client Component.

import { createHmac, timingSafeEqual } from "crypto";

/** Cookie that marks an authenticated session. */
export const SESSION_COOKIE = "loungee_session";

/** Roles. `owner` may directly adjust balances; `admin` may do everything else. */
export type Role = "owner" | "admin";

export interface SessionUser {
  username: string;
  role: Role;
}

/**
 * Secret used to sign session tokens. Override with AUTH_SECRET in production.
 * (Same env var the old single-user token used, so deployments need no change.)
 */
const SIGNING_SECRET = process.env.AUTH_SECRET ?? "loungee-c45bff-7a2b9e-session-v1";

/**
 * Legacy single-user cookie value. Sessions created before multi-user login
 * still carry this exact string; we honour them as the `euruuu` owner so nobody
 * is logged out by the upgrade. New logins issue signed tokens instead.
 */
const LEGACY_TOKEN = process.env.AUTH_SECRET ?? "loungee-c45bff-7a2b9e-session-v1";

function sign(payload: string): string {
  return createHmac("sha256", SIGNING_SECRET).update(payload).digest("hex");
}

/** Build a signed session token: `<username>.<role>.<hmac>` (username base64url). */
export function makeSessionToken(user: SessionUser): string {
  const u = Buffer.from(user.username, "utf8").toString("base64url");
  const payload = `${u}.${user.role}`;
  return `${payload}.${sign(payload)}`;
}

/** Verify + decode a session cookie value. Returns the user, or null if invalid. */
export function readSession(token: string | undefined): SessionUser | null {
  if (!token) return null;

  // Legacy single-user session → treat as the euruuu owner.
  if (token === LEGACY_TOKEN) return { username: "euruuu", role: "owner" };

  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [u, role, mac] = parts;
  if (role !== "owner" && role !== "admin") return null;
  const expected = sign(`${u}.${role}`);
  const a = Buffer.from(mac, "hex");
  const b = Buffer.from(expected, "hex");
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let username: string;
  try {
    username = Buffer.from(u, "base64url").toString("utf8");
  } catch {
    return null;
  }
  return { username, role };
}

/** True when the token is a valid session (any role). */
export function isValidSession(token: string | undefined): boolean {
  return readSession(token) !== null;
}

type CookieCarrier = { cookies: { get(name: string): { value: string } | undefined } };

/** The authenticated user for a request, or null. Use in API handlers. */
export function getSessionUser(req: CookieCarrier): SessionUser | null {
  return readSession(req.cookies.get(SESSION_COOKIE)?.value);
}

/** True when a request carries a valid admin session (any role). */
export function isAdminRequest(req: CookieCarrier): boolean {
  return getSessionUser(req) !== null;
}

/** True when the request's user may directly edit balances (owner only). */
export function canEditBalances(req: CookieCarrier): boolean {
  return getSessionUser(req)?.role === "owner";
}
