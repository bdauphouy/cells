import { addLibraryVideo, getLibrary } from "@/lib/library";

export async function GET() {
  const library = await getLibrary();
  return Response.json({ library });
}

// Called once the client has polled mux-upload/status to "ready" — this is
// what actually adds the finished asset to the library.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const { title, assetId, playbackId, aspectRatio } = body ?? {};
  if (
    typeof title !== "string" ||
    !title.trim() ||
    typeof assetId !== "string" ||
    typeof playbackId !== "string" ||
    typeof aspectRatio !== "string"
  ) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const video = await addLibraryVideo({
    title: title.trim(),
    assetId,
    playbackId,
    aspectRatio,
  });
  return Response.json({ video });
}
