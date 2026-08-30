import { removeLibraryVideo, updateLibraryVideo } from "@/lib/library";
import { livepeer } from "@/lib/livepeer";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = await request.json().catch(() => null);
  const { title, description } = body ?? {};
  if (
    (title !== undefined && (typeof title !== "string" || !title.trim())) ||
    (description !== undefined && typeof description !== "string")
  ) {
    return Response.json({ error: "Invalid body" }, { status: 400 });
  }

  const video = await updateLibraryVideo(id, {
    title: typeof title === "string" ? title.trim() : undefined,
    description: typeof description === "string" ? description.trim() : undefined,
  });
  if (!video) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }
  return Response.json({ video });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const removed = await removeLibraryVideo(id);
  if (!removed) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  // Best-effort: the library entry is already gone either way, so a Livepeer
  // hiccup here shouldn't block the admin from seeing it disappear.
  await livepeer()
    .asset.delete(removed.assetId)
    .catch((err) => console.error("Failed to delete Livepeer asset", err));

  return Response.json({ ok: true });
}
