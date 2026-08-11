import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

// Server-only password hashing (scrypt, Node built-in — no external deps).
// Stored format: `scrypt$<saltHex>$<hashHex>`. Never store or log plaintext.

const KEYLEN = 64;

/** Hash a plaintext password with a fresh random salt. */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(plain, salt, KEYLEN);
  return `scrypt$${salt.toString("hex")}$${hash.toString("hex")}`;
}

/** Constant-time verify a plaintext against a stored `scrypt$salt$hash`. */
export function verifyPassword(plain: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 3 || parts[0] !== "scrypt") return false;
  const salt = Buffer.from(parts[1], "hex");
  const expected = Buffer.from(parts[2], "hex");
  let actual: Buffer;
  try {
    actual = scryptSync(plain, salt, expected.length || KEYLEN);
  } catch {
    return false;
  }
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
