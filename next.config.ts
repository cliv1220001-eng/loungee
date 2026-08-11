import type { NextConfig } from "next";

// The Supabase origin the browser must reach for signed proof-image URLs
// (payment/payout screenshots render as <img> in the admin queues). Derived from
// the server env so CSP stays correct across environments.
function supabaseOrigin(): string {
  try {
    return new URL(process.env.SUPABASE_URL ?? "").origin;
  } catch {
    return "";
  }
}

// Content-Security-Policy. Next.js injects inline scripts/styles for hydration,
// so script/style need 'unsafe-inline' (a nonce-based CSP would be stricter but
// requires per-request wiring). Everything else is locked to same-origin, plus
// the Supabase origin for proof images and blob: for the local upload preview.
function csp(): string {
  const sb = supabaseOrigin();
  return [
    "default-src 'self'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'", // no framing → clickjacking protection
    "object-src 'none'",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: blob:${sb ? " " + sb : ""}`,
    "font-src 'self' data:",
    `connect-src 'self'${sb ? " " + sb : ""}`,
    "upgrade-insecure-requests",
  ].join("; ");
}

const SECURITY_HEADERS = [
  { key: "Content-Security-Policy", value: csp() },
  // Enforce HTTPS for 2 years, including subdomains.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  // Belt-and-suspenders clickjacking guard (CSP frame-ancestors is the modern one).
  { key: "X-Frame-Options", value: "DENY" },
  // Stop MIME sniffing.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Don't leak full URLs to other origins.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Drop legacy powerful-feature access.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // Don't advertise the framework/version.
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: SECURITY_HEADERS }];
  },
};

export default nextConfig;
