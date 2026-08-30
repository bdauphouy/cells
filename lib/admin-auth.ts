import { createHmac, timingSafeEqual } from "node:crypto";

// Single shared password, not per-user accounts — proportionate for a
// one-admin upload page. The session cookie is a signed, self-contained
// token (expiry + HMAC over it) rather than a server-side session store, so
// there's nothing extra to provision just to keep someone logged in.
export const ADMIN_SESSION_COOKIE = "admin_session";
const SESSION_MS = 1000 * 60 * 60 * 24 * 30; // 30 days

function adminPassword(): string {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) throw new Error("ADMIN_PASSWORD is not set");
  return password;
}

function sign(payload: string): string {
  return createHmac("sha256", adminPassword()).update(payload).digest("hex");
}

export function checkPassword(candidate: string): boolean {
  const expected = Buffer.from(adminPassword());
  const given = Buffer.from(candidate);
  // Constant-time even when lengths differ, so response timing can't leak
  // how much of the password a guess got right.
  return expected.length === given.length && timingSafeEqual(expected, given);
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

  const expected = Buffer.from(sign(payload));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
