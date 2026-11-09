import {
  ALL_FORMATS,
  BlobSource,
  BufferTarget,
  Conversion,
  Input,
  Mp4OutputFormat,
  Output,
  QUALITY_HIGH,
  type VideoSample,
} from "mediabunny";
import { watermarkRect, type WatermarkSettings } from "@/lib/watermark";

// Browser-only. Uploads go straight from the browser to Livepeer over tus,
// and Livepeer has no VOD overlay feature — so the watermark is burned into
// the frames here, before the bytes leave the machine. WebCodecs does the
// decode/encode, so it runs on the GPU's hardware codecs where available.

// Loaded once per upload rather than per frame. The blob is fetched rather
// than pointed at by an <img>, which would taint the canvas cross-origin.
export async function loadWatermarkLogo(url: string): Promise<ImageBitmap> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("Couldn't load the watermark logo.");
  return createImageBitmap(await res.blob());
}

export async function burnWatermark(
  file: File,
  settings: Pick<WatermarkSettings, "position" | "scale" | "opacity" | "margin">,
  logo: ImageBitmap,
  { onProgress, signal }: { onProgress?: (fraction: number) => void; signal?: AbortSignal } = {},
): Promise<File> {
  const input = new Input({ source: new BlobSource(file), formats: ALL_FORMATS });
  const output = new Output({
    // Fast start puts the index up front: Livepeer can start reading the
    // file without seeking to its end.
    format: new Mp4OutputFormat({ fastStart: "in-memory" }),
    target: new BufferTarget(),
  });

  let canvas: OffscreenCanvas | null = null;
  let ctx: OffscreenCanvasRenderingContext2D | null = null;

  const process = (sample: VideoSample) => {
    const width = sample.displayWidth;
    const height = sample.displayHeight;
    if (!canvas || canvas.width !== width || canvas.height !== height) {
      canvas = new OffscreenCanvas(width, height);
      ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Canvas 2D isn't available in this browser.");
    }
    const c = ctx!;
    c.globalAlpha = 1;
    // drawWithFit applies the sample's own rotation, so a phone clip shot
    // vertically lands upright even though its pixels are stored sideways.
    sample.drawWithFit(c, { fit: "fill" });
    const rect = watermarkRect({ width, height }, logo, settings);
    c.globalAlpha = settings.opacity;
    c.drawImage(logo, rect.x, rect.y, rect.width, rect.height);
    return canvas;
  };

  try {
    const conversion = await Conversion.init({
      input,
      output,
      video: {
        // Rotation is baked into the frames by `process`, so the output must
        // not also carry rotation metadata — it would rotate twice.
        allowTransformationMetadata: false,
        forceTranscode: true,
        bitrate: QUALITY_HIGH,
        process,
      },
      showWarnings: false,
    });

    // A track dropped for any reason other than our own choice means the
    // output would silently lose its audio (or video) — refuse instead.
    const lost = conversion.discardedTracks.filter((t) => t.reason !== "discarded_by_user");
    if (!conversion.isValid || lost.length > 0) {
      const what = lost.some((t) => t.track.isAudioTrack()) ? "audio" : "video";
      throw new Error(
        `This browser can't re-encode the ${what} of this file to add the watermark.`,
      );
    }

    if (onProgress) conversion.onProgress = (p) => onProgress(p);
    const onAbort = () => void conversion.cancel();
    signal?.addEventListener("abort", onAbort, { once: true });
    try {
      await conversion.execute();
    } finally {
      signal?.removeEventListener("abort", onAbort);
    }

    const buffer = output.target.buffer;
    if (!buffer) throw new Error("Watermarking produced no output.");
    const name = file.name.replace(/\.[^.]+$/, "") + ".mp4";
    return new File([buffer], name, { type: "video/mp4" });
  } finally {
    input.dispose();
  }
}
