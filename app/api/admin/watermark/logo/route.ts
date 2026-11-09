import { del, put } from "@vercel/blob";
import { getWatermarkSettings, updateWatermarkSettings } from "@/lib/watermark-settings";

const MAX_BYTES = 2 * 1024 * 1024;
// Raster formats with alpha are what a watermark actually wants. SVG is left
// out on purpose: drawn onto a canvas it needs intrinsic dimensions many
// exported SVGs don't carry, and it's a script-capable format on a public URL.
const ACCEPTED_TYPES = new Set(["image/png", "image/webp"]);

/**
 * Like the CV, an upload replaces the stored logo immediately: the bytes are
 * in blob storage by the time this returns, so staging the pointer until
 * "Save" would only risk orphaning them.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return Response.json({ error: "No file received." }, { status: 400 });
  }
  if (!ACCEPTED_TYPES.has(file.type)) {
    return Response.json(
      { error: "The logo must be a PNG or WebP (transparent background recommended)." },
      { status: 400 },
    );
  }
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "The logo must be under 2MB." }, { status: 400 });
  }

  const settings = await getWatermarkSettings();
  const basename = file.name.split(/[\\/]/).pop()?.replace(/[^\w.\- ]+/g, "") || "logo.png";

  let blob;
  try {
    // Unique directory per upload: reusing one pathname would serve the
    // previous logo from the CDN cache.
    blob = await put(`watermark/${crypto.randomUUID()}/${basename}`, file, {
      access: "public",
    });
  } catch (err) {
    console.error("Failed to upload watermark logo to blob storage", err);
    return Response.json({ error: "Couldn't upload the logo." }, { status: 502 });
  }

  const logo = { url: blob.url, filename: file.name };
  await updateWatermarkSettings({ ...settings, logo });

  if (settings.logo?.url) {
    await del(settings.logo.url).catch((err) =>
      console.error("Failed to delete old watermark logo blob", err),
    );
  }

  return Response.json({ logo });
}

export async function DELETE() {
  const settings = await getWatermarkSettings();
  if (!settings.logo) return Response.json({ logo: null });

  await updateWatermarkSettings({ ...settings, logo: null });
  await del(settings.logo.url).catch((err) =>
    console.error("Failed to delete watermark logo blob", err),
  );

  return Response.json({ logo: null });
}
