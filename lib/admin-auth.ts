import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import {
  ACCOUNTS,
  DEFAULT_MEMBER_PERMISSIONS,
  FULL_PERMISSIONS,
  parsePermissions,
  type Permissions,
  type Role,
  type Viewer,
} from "@/lib/admin-access";
import { db } from "@/lib/kv";

// Two fixed accounts (see lib/admin-access.ts). The session cookie is a
// signed, self-contained token (role + session version + expiry, HMAC over
// it) rather than a server-side session store, so there's nothing extra to
// provision just to keep someone logged in.
export const ADMIN_SESSION_COOKIE = "admin_session";
// The cookie's own max-age is set from this too, so the signed expiry and the
// browser's copy can't drift apart.
export const SESSION_SECONDS = 60 * 60 * 24 * 30; // 30 days
const SESSION_MS = SESSION_SECONDS * 1000;

// ADMIN_PASSWORD is the HMAC key, so changing it on Vercel signs every
// session out. It's also the owner's password for as long as the owner
// hasn't set one of its own (and again if the admin:owner key is deleted,
// which is the way back in after a forgotten password).
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

// ---- Account records ----

type AccountRecord = {
  // Owner: null = still on ADMIN_PASSWORD. Member: null = no password set
  // yet, or access revoked, so it can't sign in.
  passwordHash: string | null;
  // Bumped whenever the password changes or access is revoked; sessions
  // signed with an older version stop working on their next request.
  sessionVersion: number;
};

export type MemberRecord = AccountRecord & { permissions: Permissions };

const KEYS: Record<Role, string> = { owner: "admin:owner", member: "admin:member" };

async function getOwner(): Promise<AccountRecord> {
  const stored = await db().get<Partial<AccountRecord>>(KEYS.owner);
  return {
    passwordHash: stored?.passwordHash ?? null,
    sessionVersion: stored?.sessionVersion ?? 0,
  };
}

export async function getMember(): Promise<MemberRecord> {
  const stored = await db().get<Partial<MemberRecord>>(KEYS.member);
  return {
    passwordHash: stored?.passwordHash ?? null,
    permissions: parsePermissions(stored?.permissions) ?? DEFAULT_MEMBER_PERMISSIONS,
    sessionVersion: stored?.sessionVersion ?? 0,
  };
}

export async function saveMember(record: MemberRecord): Promise<void> {
  await db().set(KEYS.member, record);
}

const getAccount = (role: Role): Promise<AccountRecord | MemberRecord> =>
  role === "owner" ? getOwner() : getMember();

// ---- Password hashing (scrypt, built into Node) ----

const KEY_LENGTH = 64;

function scryptAsync(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password, salt, KEY_LENGTH, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${salt.toString("base64")}$${key.toString("base64")}`;
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await scryptAsync(password, Buffer.from(salt, "base64"));
  return key.length === expected.length && timingSafeEqual(key, expected);
}

async function passwordMatches(
  role: Role,
  record: AccountRecord,
  password: string,
): Promise<boolean> {
  if (record.passwordHash) return verifyPassword(password, record.passwordHash);
  return role === "owner" && secureEquals(adminPassword(), password);
}

// ---- Sign-in and sessions ----

type Session = { role: Role; version: number };

const roleForEmail = (email: string): Role | null => {
  const normalized = email.trim().toLowerCase();
  if (normalized === ACCOUNTS.owner) return "owner";
  if (normalized === ACCOUNTS.member) return "member";
  return null;
};

// Returns the session to sign, or null for a wrong email or password.
export async function authenticate(email: string, password: string): Promise<Session | null> {
  const role = roleForEmail(email);
  if (!role) return null;
  const record = await getAccount(role);
  return (await passwordMatches(role, record, password))
    ? { role, version: record.sessionVersion }
    : null;
}

// For an account changing its own password: checks the current one, then
// signs out every other session. Returns the new session for this device,
// or null if the current password was wrong.
export async function changeOwnPassword(
  role: Role,
  current: string,
  next: string,
): Promise<Session | null> {
  const record = await getAccount(role);
  if (!(await passwordMatches(role, record, current))) return null;
  const updated = {
    ...record,
    passwordHash: await hashPassword(next),
    sessionVersion: record.sessionVersion + 1,
  };
  await db().set(KEYS[role], updated);
  return { role, version: updated.sessionVersion };
}

function createSessionCookie({ role, version }: Session): string {
  const payload = `${role}.${version}.${Date.now() + SESSION_MS}`;
  return `${payload}.${sign(payload)}`;
}

export async function setSessionCookie(session: Session): Promise<void> {
  const jar = await cookies();
  jar.set(ADMIN_SESSION_COOKIE, createSessionCookie(session), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

function readSessionCookie(value: string | undefined): Session | null {
  if (!value) return null;
  const parts = value.split(".");
  if (parts.length !== 4) return null;
  const [role, version, expiresAt, signature] = parts;
  if (!secureEquals(sign(`${role}.${version}.${expiresAt}`), signature)) return null;
  if (Number(expiresAt) < Date.now()) return null;
  if (role !== "owner" && role !== "member") return null;
  return { role, version: Number(version) };
}

// Account records are read fresh on every request rather than baked into the
// cookie, so a password change, a revoke or new permissions apply at once.
export async function getViewer(cookie: string | undefined): Promise<Viewer | null> {
  const session = readSessionCookie(cookie);
  if (!session) return null;
  if (session.role === "owner") {
    const owner = await getOwner();
    if (owner.sessionVersion !== session.version) return null;
    return { role: "owner", email: ACCOUNTS.owner, permissions: FULL_PERMISSIONS };
  }
  const member = await getMember();
  if (!member.passwordHash || member.sessionVersion !== session.version) return null;
  return { role: "member", email: ACCOUNTS.member, permissions: member.permissions };
}

export async function getRequestViewer(): Promise<Viewer | null> {
  const jar = await cookies();
  return getViewer(jar.get(ADMIN_SESSION_COOKIE)?.value);
}
