import { Redis } from "@upstash/redis";
import { SOCIAL_CATALOG, TOOL_CATALOG, type SocialId, type ToolId } from "@/lib/hero-catalog";

export type HeroTool = { id: ToolId; enabled: boolean };
// No `href`: the outbound link is derived from the handle by socialHref(), so
// there's one field to edit and no way for the two to drift apart.
export type HeroSocial = { id: SocialId; enabled: boolean; handle: string };

// The CV lives in Vercel Blob; only this pointer is kept in Redis. `url` is
// the plain public URL, `downloadUrl` the same blob served with a
// content-disposition attachment header — the `download` attribute on an
// anchor is ignored cross-origin, so the header is what actually makes the
// button download instead of opening the PDF in a tab.
export type HeroCv = { url: string; downloadUrl: string; filename: string };

export type HeroSettings = {
  bio: string;
  tools: HeroTool[];
  socials: HeroSocial[];
  cv: HeroCv | null;
};

const HERO_KEY = "hero:settings";

const DEFAULT_SETTINGS: HeroSettings = {
  bio: "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua.",
  tools: (Object.keys(TOOL_CATALOG) as ToolId[]).map((id) => ({ id, enabled: true })),
  socials: [
    { id: "instagram", enabled: true, handle: "@cells.edition" },
    { id: "tiktok", enabled: true, handle: "@celestecuestas_" },
    { id: "whatsapp", enabled: true, handle: "+504 3271 7013" },
  ],
  cv: null,
};

// Lazy, not module-top-level: this file is imported at build time too, and
// the env vars it needs aren't guaranteed to exist yet at that point.
let _redis: Redis | null = null;
function db(): Redis {
  if (!_redis) {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) {
      throw new Error("KV_REST_API_URL / KV_REST_API_TOKEN are not set");
    }
    _redis = new Redis({ url, token });
  }
  return _redis;
}

export async function getHeroSettings(): Promise<HeroSettings> {
  const stored = await db().get<HeroSettings>(HERO_KEY);
  if (!stored) return DEFAULT_SETTINGS;

  // Catalog entries added after settings were first saved (e.g. a new tool)
  // won't be in the stored list yet — backfill them so they show up without
  // requiring a manual data migration. Tools are then displayed in catalog
  // order rather than whatever order they were originally saved in, so
  // reordering the catalog reorders the hero overlay too.
  const catalogOrder = Object.keys(TOOL_CATALOG) as ToolId[];
  const missingTools = catalogOrder
    .filter((id) => !stored.tools.some((t) => t.id === id))
    .map((id) => ({ id, enabled: true }));
  const tools = [...stored.tools, ...missingTools].sort(
    (a, b) => catalogOrder.indexOf(a.id) - catalogOrder.indexOf(b.id),
  );

  // Same backfill, applied to socials: a catalog addition (e.g. WhatsApp)
  // should show up for existing saved settings without a manual re-save.
  const socialOrder = Object.keys(SOCIAL_CATALOG) as SocialId[];
  const defaultById = new Map(DEFAULT_SETTINGS.socials.map((s) => [s.id, s]));
  const missingSocials = socialOrder
    .filter((id) => !stored.socials.some((s) => s.id === id))
    .map((id) => defaultById.get(id) ?? { id, enabled: true, handle: "" });
  const socials = [...stored.socials, ...missingSocials]
    .sort((a, b) => socialOrder.indexOf(a.id) - socialOrder.indexOf(b.id))
    // Settings saved before the link became derived carry a stale `href`;
    // drop it here so it never round-trips back into storage.
    .map(({ id, enabled, handle }) => ({ id, enabled, handle }));

  // `cv` postdates the first saved settings, so it can be absent entirely.
  return { ...stored, tools, socials, cv: stored.cv ?? null };
}

export async function updateHeroSettings(next: HeroSettings): Promise<HeroSettings> {
  await db().set(HERO_KEY, next);
  return next;
}
