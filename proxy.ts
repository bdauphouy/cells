import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { allows, type AdminSection, type Viewer } from "@/lib/admin-access";
import { ADMIN_SESSION_COOKIE, getViewer } from "@/lib/admin-auth";

// Everything under /admin and /api/admin needs a session, except the login
// screen and its own API route — those are how you get one in the first
// place.
const OPEN_PATHS = new Set(["/admin/login", "/api/admin/login"]);

// Which section each API belongs to. Reads (GET/HEAD) need "view" on it,
// anything else "edit". A route missing from this list is owner-only, so a
// new one stays closed to the member until it's mapped here.
const API_SECTIONS: [prefix: string, section: AdminSection][] = [
  ["/api/admin/videos", "library"],
  ["/api/admin/livepeer-upload", "library"],
  ["/api/admin/crm", "clients"],
  ["/api/admin/stats", "analytics"],
  ["/api/admin/hero", "hero"],
  ["/api/admin/cv", "hero"],
  ["/api/admin/watermark", "watermark"],
];
const ANY_ACCOUNT = new Set(["/api/admin/logout", "/api/admin/account"]);

function apiAllowed(viewer: Viewer, pathname: string, method: string): boolean {
  if (viewer.role === "owner" || ANY_ACCOUNT.has(pathname)) return true;
  const entry = API_SECTIONS.find(
    ([prefix]) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
  if (!entry) return false;
  const needed = method === "GET" || method === "HEAD" ? "view" : "edit";
  if (allows(viewer.permissions[entry[1]], needed)) return true;
  // Uploads burn the watermark in, so whoever can add videos has to read its
  // settings even with the Watermark section hidden.
  return (
    pathname === "/api/admin/watermark" &&
    needed === "view" &&
    allows(viewer.permissions.library, "edit")
  );
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (OPEN_PATHS.has(pathname)) return NextResponse.next();

  const viewer = await getViewer(request.cookies.get(ADMIN_SESSION_COOKIE)?.value);
  const isApi = pathname.startsWith("/api/");

  if (!viewer) {
    if (isApi) return Response.json({ error: "Unauthorized" }, { status: 401 });
    return NextResponse.redirect(new URL("/admin/login", request.url));
  }
  if (isApi && !apiAllowed(viewer, pathname, request.method)) {
    return Response.json({ error: "Forbidden" }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
