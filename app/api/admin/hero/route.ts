import { SOCIAL_CATALOG, TOOL_CATALOG } from "@/lib/hero-catalog";
import { getHeroSettings, updateHeroSettings, type HeroSettings } from "@/lib/hero-settings";

export async function GET() {
  const settings = await getHeroSettings();
  return Response.json({ settings });
}

function isTool(v: unknown): v is HeroSettings["tools"][number] {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { id?: unknown }).id === "string" &&
    (v as { id: string }).id in TOOL_CATALOG &&
    typeof (v as { enabled?: unknown }).enabled === "boolean"
  );
}

function isSocial(v: unknown): v is HeroSettings["socials"][number] {
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { id?: unknown }).id === "string" &&
    (v as { id: string }).id in SOCIAL_CATALOG &&
    typeof (v as { enabled?: unknown }).enabled === "boolean" &&
    typeof (v as { handle?: unknown }).handle === "string"
  );
}

// The CV is written by /api/admin/cv, which owns the blob's lifecycle; this
// route only has to accept the pointer back unchanged on a normal save.
function isCv(v: unknown): v is HeroSettings["cv"] {
  if (v === null) return true;
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { url?: unknown }).url === "string" &&
    typeof (v as { downloadUrl?: unknown }).downloadUrl === "string" &&
    typeof (v as { filename?: unknown }).filename === "string"
  );
}

function isValid(body: unknown): body is HeroSettings {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.bio === "string" &&
    Array.isArray(b.tools) &&
    b.tools.every(isTool) &&
    Array.isArray(b.socials) &&
    b.socials.every(isSocial) &&
    isCv(b.cv ?? null)
  );
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (!isValid(body)) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const settings = await updateHeroSettings({
    bio: body.bio.trim(),
    tools: body.tools,
    // Destructured rather than spread so a legacy `href` on the incoming body
    // is dropped instead of being persisted alongside the derived link.
    socials: body.socials.map(({ id, enabled, handle }) => ({ id, enabled, handle: handle.trim() })),
    cv: body.cv ?? null,
  });
  return Response.json({ settings });
}
