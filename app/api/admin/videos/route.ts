import { addLibraryVideo, reconcileLibrary } from "@/lib/library";

export async function GET() {
  const library = await reconcileLibrary();
  return Response.json({ library });
}

// Called once the client has polled livepeer-upload/status to "ready" — this
// is what actually adds the finished asset to the library.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { title, description, assetId, playbackId, hlsUrl, posterUrl, aspectRatio } =
    body ?? {};
  if (
    typeof title !== "string" ||
    !title.trim() ||
    typeof assetId !== "string" ||
    typeof playbackId !== "string" ||
    typeof hlsUrl !== "string" ||
    typeof aspectRatio !== "string" ||
    (posterUrl !== undefined && typeof posterUrl !== "string") ||
    (description !== undefined && typeof description !== "string")
  ) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const video = await addLibraryVideo({
    title: title.trim(),
    description: description?.trim() || undefined,
    assetId,
    playbackId,
    hlsUrl,
    posterUrl,
    aspectRatio,
  });
  return Response.json({ video });
}
