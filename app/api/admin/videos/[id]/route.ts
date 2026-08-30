import { removeLibraryVideo } from "@/lib/library";
import { mux } from "@/lib/mux";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const removed = await removeLibraryVideo(id);
  if (!removed) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Best-effort: the library entry is already gone either way, so a Mux
  // hiccup here shouldn't block the admin from seeing it disappear.
  await mux()
    .video.assets.delete(removed.assetId)
    .catch((err) => console.error("Failed to delete Mux asset", err));

  return Response.json({ ok: true });
}
