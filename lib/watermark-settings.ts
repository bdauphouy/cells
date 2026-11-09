import { db } from "@/lib/kv";
import { DEFAULT_WATERMARK, type WatermarkSettings } from "@/lib/watermark";

const WATERMARK_KEY = "watermark:settings";

export async function getWatermarkSettings(): Promise<WatermarkSettings> {
  const stored = await db().get<Partial<WatermarkSettings>>(WATERMARK_KEY);
  // Spread over the defaults so fields added later backfill on their own.
  return { ...DEFAULT_WATERMARK, ...stored };
}

export async function updateWatermarkSettings(
  next: WatermarkSettings,
): Promise<WatermarkSettings> {
  await db().set(WATERMARK_KEY, next);
  return next;
}
