import { Livepeer } from "livepeer";

let _livepeer: Livepeer | null = null;
export function livepeer(): Livepeer {
  if (!_livepeer) {
    const apiKey = process.env.LIVEPEER_API_KEY;
    if (!apiKey) throw new Error("LIVEPEER_API_KEY is not set");
    _livepeer = new Livepeer({ apiKey });
  }
  return _livepeer;
}

export type Playback = {
  hlsUrl: string;
  posterUrl?: string;
  aspectRatio: string;
};

// Livepeer publishes thumbnails as a WebVTT track pointing at keyframe
// images rather than as one addressable image URL, so the poster takes a
// hop through that manifest. Cues look like:
//
//   00:00:00.000 --> 00:00:05.000
//   keyframes_0.png
//
// The first cue's image is the poster. Best-effort — a card without one
// falls back to a flat fill, so a hiccup here shouldn't fail the upload.
async function posterFromThumbnailTrack(
  vttUrl: string,
): Promise<string | undefined> {
  try {
    const res = await fetch(vttUrl);
    if (!res.ok) return undefined;
    const cue = (await res.text())
      .split("\n")
      .map((line) => line.trim())
      // Skip the WEBVTT header, blank lines, and the timestamp lines; the
      // first thing left is the image reference.
      .find(
        (line) =>
          line && line !== "WEBVTT" && !line.includes("-->") && !/^\d+$/.test(line),
      );
    if (!cue) return undefined;
    // Cues are relative to the manifest, and may carry a sprite fragment
    // (#xywh=) that has no meaning for a plain <img>/texture.
    return new URL(cue.split("#")[0], vttUrl).toString();
  } catch {
    return undefined;
  }
}

// Livepeer explicitly warns against hand-building playback URLs from a
// playback id — the format is theirs to change. The playback-info endpoint is
// the supported way to get them, so resolve once when an asset turns ready
// and store the result rather than templating URLs at render time.
//
// It's also the only place the video's dimensions show up: the asset's own
// `videoSpec` carries just format/bitrate/duration, with no track list.
export async function resolvePlayback(
  playbackId: string,
): Promise<Playback | null> {
  const { playbackInfo } = await livepeer().playback.get(playbackId);
  const sources = playbackInfo?.meta.source ?? [];

  const hlsUrl = sources.find(
    (s) => s.type === "html5/application/vnd.apple.mpegurl",
  )?.url;
  if (!hlsUrl) return null;

  const sized = sources.find((s) => s.width && s.height);
  // parseAspect only ever divides the two numbers, so raw pixel dimensions
  // work as-is — no need to reduce them to a "16:9" style ratio.
  const aspectRatio = sized ? `${sized.width}:${sized.height}` : "16:9";

  // A direct image source is preferred when one exists; otherwise fall back
  // to the VTT keyframe track, which is what VOD assets actually get.
  const directImage = sources.find(
    (s) => s.type === "image/jpeg" || s.type === "image/png",
  )?.url;
  const vttUrl = sources.find((s) => s.type === "text/vtt")?.url;
  const posterUrl =
    directImage ?? (vttUrl ? await posterFromThumbnailTrack(vttUrl) : undefined);

  return { hlsUrl, posterUrl, aspectRatio };
}
