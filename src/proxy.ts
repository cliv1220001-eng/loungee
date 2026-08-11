import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { SESSION_COOKIE, isValidSession } from "@/lib/auth";

// Next.js 16 renamed Middleware to Proxy. This gates every page behind login.
export function proxy(request: NextRequest) {
  const authed = isValidSession(request.cookies.get(SESSION_COOKIE)?.value);
  const { pathname } = request.nextUrl;
  const isLoginPage = pathname === "/login";

  // PUBLIC cash-in: the /cashin page and the bare submit endpoint are the ONLY
  // things reachable without login. Everything else under /api/cashin (the admin
  // approve/reject/list routes) stays gated — and those handlers re-check auth
  // themselves (isAdminRequest) as defense in depth. Keep this list tight: it is
  // the one deliberate hole in the login wall.
  const isPublicPath =
    pathname === "/cashin" ||
    (pathname === "/api/cashin" && request.method === "POST") ||
    // IGN autocomplete for the public cash-in form — GET only, IGN strings only.
    (pathname === "/api/cashin/lookup" && request.method === "GET");
  // NOTE: cash-out is ADMIN-ONLY (recorded by an admin), so it stays gated.
  if (isPublicPath) {
    return NextResponse.next();
  }

  // Unauthenticated → send to login (remember where they were headed).
  if (!authed && !isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?from=${encodeURIComponent(pathname)}`;
    return NextResponse.redirect(url);
  }

  // Already signed in but on the login page → go to the app.
  if (authed && isLoginPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  // Run on everything except the auth API, Next internals, and static files.
  matcher: ["/((?!api/login|api/logout|_next/static|_next/image|favicon.ico).*)"],
};
