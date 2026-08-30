import { Redis } from "@upstash/redis";
import { MIN_CARDS } from "@/lib/constants";

export type LibraryVideo = {
  id: string;
  title: string;
  assetId: string; // Mux asset id — needed to delete the asset itself
  playbackId: string;
  aspectRatio: string; // Mux's "W:H" string, e.g. "16:9"
  createdAt: number;
};

const LIBRARY_KEY = "mux:library";

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

export async function getLibrary(): Promise<LibraryVideo[]> {
  return (await db().get<LibraryVideo[]>(LIBRARY_KEY)) ?? [];
}

export async function addLibraryVideo(
  entry: Omit<LibraryVideo, "id" | "createdAt">,
): Promise<LibraryVideo> {
  const video: LibraryVideo = {
    ...entry,
    id: crypto.randomUUID(),
    createdAt: Date.now(),
  };
  const library = await getLibrary();
  library.push(video);
  await db().set(LIBRARY_KEY, library);
  return video;
}

export async function removeLibraryVideo(
  id: string,
): Promise<LibraryVideo | null> {
  const library = await getLibrary();
  const index = library.findIndex((v) => v.id === id);
  if (index === -1) return null;
  const [removed] = library.splice(index, 1);
  await db().set(LIBRARY_KEY, library);
  return removed;
}

export type ResolvedCard = { playbackId: string; aspectRatio: string };

// What the carousel actually needs: no manual per-card assignment — the
// library fills the spiral on its own. Fewer than MIN_CARDS videos loop
// round to reach it; MIN_CARDS or more get one card each, so the spiral
// just grows past the minimum instead of ever leaving cards unused.
export async function resolveCards(): Promise<ResolvedCard[]> {
  const library = await getLibrary();
  if (library.length === 0) return [];
  const count = Math.max(MIN_CARDS, library.length);
  return Array.from({ length: count }, (_, i) => {
    const video = library[i % library.length];
    return { playbackId: video.playbackId, aspectRatio: video.aspectRatio };
  });
}
