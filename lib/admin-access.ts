// Who may open which admin section. Shared by the proxy, the API routes and
// the dashboard, so it's kept free of server imports.

// Two fixed accounts rather than user management. The owner sees everything
// and starts out with ADMIN_PASSWORD as its password; the member's password
// and per-section access are set by the owner from the Access section. Each
// can then change its own password from the Account section.
export const ACCOUNTS = {
  owner: "contact@cellsedition.com",
  member: "mail@bdau.fr",
} as const;
export type Role = keyof typeof ACCOUNTS;

export const ADMIN_SECTIONS = [
  "library",
  "clients",
  "analytics",
  "hero",
  "watermark",
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number];

export const SECTION_LABELS: Record<AdminSection, string> = {
  library: "Library",
  clients: "Clients",
  analytics: "Analytics",
  hero: "Hero",
  watermark: "Watermark",
};

export const ACCESS_LEVELS = ["hidden", "view", "edit"] as const;
export type AccessLevel = (typeof ACCESS_LEVELS)[number];
export type Permissions = Record<AdminSection, AccessLevel>;

// Sections with nothing to change: "view" is as far as they go.
export const VIEW_ONLY_SECTIONS: ReadonlySet<AdminSection> = new Set(["analytics"]);

export const FULL_PERMISSIONS: Permissions = {
  library: "edit",
  clients: "edit",
  analytics: "view",
  hero: "edit",
  watermark: "edit",
};

// Everything but the client list, which is private to the owner.
export const DEFAULT_MEMBER_PERMISSIONS: Permissions = {
  ...FULL_PERMISSIONS,
  clients: "hidden",
};

export const MIN_PASSWORD_LENGTH = 8;

export type Viewer = {
  role: Role;
  email: string;
  permissions: Permissions;
};

const RANK: Record<AccessLevel, number> = { hidden: 0, view: 1, edit: 2 };

export const allows = (level: AccessLevel, needed: AccessLevel) =>
  RANK[level] >= RANK[needed];

export const canView = (viewer: Viewer, section: AdminSection) =>
  allows(viewer.permissions[section], "view");
export const canEdit = (viewer: Viewer, section: AdminSection) =>
  allows(viewer.permissions[section], "edit");

// Validates untrusted input (a request body, a stored record). Missing
// sections fall back to the member default, so adding a section later
// doesn't invalidate what's already stored.
export function parsePermissions(input: unknown): Permissions | null {
  if (!input || typeof input !== "object") return null;
  const source = input as Record<string, unknown>;
  const out = { ...DEFAULT_MEMBER_PERMISSIONS };
  for (const section of ADMIN_SECTIONS) {
    const level = source[section];
    if (level === undefined) continue;
    if (!ACCESS_LEVELS.includes(level as AccessLevel)) return null;
    out[section] =
      level === "edit" && VIEW_ONLY_SECTIONS.has(section) ? "view" : (level as AccessLevel);
  }
  return out;
}
