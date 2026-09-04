import { del, put } from "@vercel/blob";
import { getHeroSettings, updateHeroSettings } from "@/lib/hero-settings";

// Well under the platform's 100MB body cap — a CV that doesn't fit here is a
// mistake (a video, a raw scan) rather than a legitimate upload.
const MAX_BYTES = 10 * 1024 * 1024;

/**
 * Uploads replace the stored CV immediately rather than staging it until the
 * admin hits "Save changes": the bytes are already in blob storage by the time
 * the request returns, so leaving the pointer unsaved would just orphan them.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "No file received." }, { status: 400 });
  }
  if (file.type !== "application/pdf") {
    return Response.json({ error: "The CV must be a PDF." }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "The CV must be under 10MB." }, { status: 400 });
  }

  const settings = await getHeroSettings();

  // Keep the original basename as the last path segment — it's what the
  // download lands on disk as — and make the URL unique with a directory
  // above it instead. `addRandomSuffix` would mangle the basename, and
  // reusing one pathname would serve the previous CV from the CDN cache.
  const basename = file.name.split(/[\\/]/).pop()?.replace(/[^\w.\- ]+/g, "") || "cv.pdf";

  let blob;
  try {
    blob = await put(`cv/${crypto.randomUUID()}/${basename}`, file, { access: "public" });
  } catch (err) {
    console.error("Failed to upload CV to blob storage", err);
    return Response.json({ error: "Couldn't upload the CV." }, { status: 502 });
  }

  const cv = { url: blob.url, downloadUrl: blob.downloadUrl, filename: file.name };
  await updateHeroSettings({ ...settings, cv });

  // Best-effort: the new CV is already live, so a failed cleanup of the old
  // blob shouldn't fail the request.
  if (settings.cv?.url) {
    await del(settings.cv.url).catch((err) => console.error("Failed to delete old CV blob", err));
  }

  return Response.json({ cv });
}

export async function DELETE() {
  const settings = await getHeroSettings();
  if (!settings.cv) return Response.json({ cv: null });

  await updateHeroSettings({ ...settings, cv: null });
  await del(settings.cv.url).catch((err) => console.error("Failed to delete CV blob", err));

  return Response.json({ cv: null });
}
