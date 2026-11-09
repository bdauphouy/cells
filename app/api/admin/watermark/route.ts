import {
  WATERMARK_LIMITS,
  WATERMARK_POSITIONS,
  type WatermarkSettings,
} from "@/lib/watermark";
import { getWatermarkSettings, updateWatermarkSettings } from "@/lib/watermark-settings";

export async function GET() {
  const settings = await getWatermarkSettings();
  return Response.json({ settings });
}

function inRange(v: unknown, { min, max }: { min: number; max: number }) {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

// The logo is written by /api/admin/watermark/logo, which owns the blob's
// lifecycle; this route only accepts the pointer back unchanged.
function isLogo(v: unknown): v is WatermarkSettings["logo"] {
  if (v === null) return true;
  return (
    !!v &&
    typeof v === "object" &&
    typeof (v as { url?: unknown }).url === "string" &&
    typeof (v as { filename?: unknown }).filename === "string"
  );
}

function isValid(body: unknown): body is WatermarkSettings {
  if (!body || typeof body !== "object") return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b.enabled === "boolean" &&
    isLogo(b.logo ?? null) &&
    WATERMARK_POSITIONS.includes(b.position as WatermarkSettings["position"]) &&
    inRange(b.scale, WATERMARK_LIMITS.scale) &&
    inRange(b.opacity, WATERMARK_LIMITS.opacity) &&
    inRange(b.margin, WATERMARK_LIMITS.margin)
  );
}

export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (!isValid(body)) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  // The stored logo wins over whatever the client echoes back, so a stale
  // form can't point the watermark at a blob that's already been deleted.
  const current = await getWatermarkSettings();
  const settings = await updateWatermarkSettings({
    enabled: body.enabled,
    logo: current.logo,
    position: body.position,
    scale: body.scale,
    opacity: body.opacity,
    margin: body.margin,
  });
  return Response.json({ settings });
}
