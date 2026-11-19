import { db } from "@/lib/kv";
import { livepeer, resolvePlayback } from "@/lib/livepeer";

export type LibraryVideo = {
  id: string;
  title: string;
  description?: string;
  assetId: string; // Livepeer asset id — needed to delete the asset itself
  playbackId: string;
  hlsUrl: string;
  posterUrl?: string;
  aspectRatio: string; // "W:H", e.g. "16:9"
  createdAt: number;
};

const LIBRARY_KEY = "livepeer:library";

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

export async function updateLibraryVideo(
  id: string,
  updates: { title?: string; description?: string },
): Promise<LibraryVideo | null> {
  const library = await getLibrary();
  const video = library.find((v) => v.id === id);
  if (!video) return null;
  if (updates.title !== undefined) video.title = updates.title;
  if (updates.description !== undefined) video.description = updates.description;
  await db().set(LIBRARY_KEY, library);
  return video;
}

// Livepeer is the actual source of truth for what assets exist — videos can
// land there without going through this app's upload flow (e.g. uploaded
// straight from Livepeer Studio), and assets can vanish the same way. Called
// on every admin dashboard load so both directions stay caught up: ready
// assets we don't know about yet get added, and entries whose asset no
// longer exists upstream get dropped.
export async function reconcileLibrary(): Promise<LibraryVideo[]> {
  const library = await getLibrary();
  const { data: assets } = await livepeer().asset.getAll();
  const remoteAssets = assets ?? [];
  const remoteIds = new Set(remoteAssets.map((a) => a.id));

  let changed = false;
  const next = library.filter((v) => {
    const keep = remoteIds.has(v.assetId);
    if (!keep) changed = true;
    return keep;
  });

  const knownIds = new Set(next.map((v) => v.assetId));
  const newlyReady = remoteAssets.filter(
    (a) => a.status?.phase === "ready" && a.playbackId && !knownIds.has(a.id),
  );

  for (const asset of newlyReady) {
    const playback = await resolvePlayback(asset.playbackId!);
    if (!playback) continue;
    next.push({
      id: crypto.randomUUID(),
      title: asset.name,
      assetId: asset.id,
      playbackId: asset.playbackId!,
      hlsUrl: playback.hlsUrl,
      posterUrl: playback.posterUrl,
      aspectRatio: playback.aspectRatio,
      createdAt: asset.createdAt ?? Date.now(),
    });
    changed = true;
  }

  if (changed) await db().set(LIBRARY_KEY, next);
  return next;
}

export type ResolvedCard = {
  hlsUrl: string;
  posterUrl?: string;
  aspectRatio: string;
  title: string;
  description?: string;
};

// What the carousel actually needs: the library once each, in upload order.
// No padding — the spiral loops it on its own (see SpiralCarousel's
// assignMedia), which is the only way to guarantee a clip doesn't come back
// until every other one has been shown. Padding it here, and then having the
// phone cut the padded list short, is what put repeats four cards apart.
export async function resolveCards(): Promise<ResolvedCard[]> {
  const library = await getLibrary();
  return library.map((video) => ({
    hlsUrl: video.hlsUrl,
    posterUrl: video.posterUrl,
    aspectRatio: video.aspectRatio,
    title: video.title,
    description: video.description,
  }));
}
