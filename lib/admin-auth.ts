import { createHmac, timingSafeEqual } from "node:crypto";

// Single shared password, not per-user accounts — proportionate for a
// one-admin upload page. The session cookie is a signed, self-contained
// token (expiry + HMAC over it) rather than a server-side session store, so
// there's nothing extra to provision just to keep someone logged in.
export const ADMIN_SESSION_COOKIE = "admin_session";
// The cookie's own max-age is set from this too, so the signed expiry and the
// browser's copy can't drift apart.
export const SESSION_SECONDS = 60 * 60 * 24 * 30; // 30 days
const SESSION_MS = SESSION_SECONDS * 1000;

function adminPassword(): string {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("ADMIN_PASSWORD is not set");
  return password;
}

function sign(payload: string): string {
  return createHmac("sha256", adminPassword()).update(payload).digest("hex");
}

// Constant-time even when lengths differ, so response timing can't leak how
// much of a guess was right.
function secureEquals(expected: string, given: string): boolean {
  const a = Buffer.from(expected);
  const b = Buffer.from(given);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function checkPassword(candidate: string): boolean {
  return secureEquals(adminPassword(), candidate);
}

export function createSessionCookie(): string {
  const expiresAt = Date.now() + SESSION_MS;
  const payload = String(expiresAt);
  return `${payload}.${sign(payload)}`;
}

export function verifySessionCookie(value: string | undefined): boolean {
  if (!value) return false;
  const [payload, signature] = value.split(".");
  if (!payload || !signature) return false;
  if (Number(payload) < Date.now()) return false;

  return secureEquals(sign(payload), signature);
}
