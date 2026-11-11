import type { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, verifySessionCookie } from "@/lib/admin-auth";
import { isBot, recordVisit, referrerHost } from "@/lib/analytics";

// Hit by navigator.sendBeacon from <VisitTracker />, which sends the body as
// text/plain — hence request.text() rather than request.json().
export async function POST(request: NextRequest) {
  const ua = request.headers.get("user-agent") ?? "";
  const loggedInAdmin = verifySessionCookie(
    request.cookies.get(ADMIN_SESSION_COOKIE)?.value,
  );
  if (isBot(ua) || loggedInAdmin) return new Response(null, { status: 204 });

  let body: { referrer?: unknown } = {};
  try {
    body = JSON.parse(await request.text());
  } catch {}

  // Vercel resolves the country at the edge; locally there's no such header.
  const country = request.headers.get("x-vercel-ip-country") ?? "XX";
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "";

  try {
    await recordVisit({
      ip,
      ua,
      country: /^[A-Z]{2}$/.test(country) ? country : "XX",
      referrer: referrerHost(body.referrer, request.nextUrl.hostname),
    });
  } catch (error) {
    // Analytics must never surface as an error to a visitor.
    console.error("track failed", error);
  }
  return new Response(null, { status: 204 });
}
