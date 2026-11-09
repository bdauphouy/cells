// Shared between the server (validation, storage) and the browser (preview,
// burn-in), so it stays free of server-only imports.

export const WATERMARK_POSITIONS = [
  "top-left",
  "top-right",
  "bottom-left",
  "bottom-right",
  "center",
] as const;
export type WatermarkPosition = (typeof WATERMARK_POSITIONS)[number];

export const WATERMARK_POSITION_LABELS: Record<WatermarkPosition, string> = {
  "top-left": "Top left",
  "top-right": "Top right",
  "bottom-left": "Bottom left",
  "bottom-right": "Bottom right",
  center: "Center",
};

// The logo lives in Vercel Blob, like the CV; only this pointer is in Redis.
export type WatermarkLogo = { url: string; filename: string };

export type WatermarkSettings = {
  // Default for new uploads — the upload form can still opt a single video out.
  enabled: boolean;
  logo: WatermarkLogo | null;
  position: WatermarkPosition;
  // Logo width as a percentage of the video's width, so the mark reads the
  // same on a vertical reel and a 4K landscape.
  scale: number;
  // 0–1.
  opacity: number;
  // Gap to the frame edges, as a percentage of the video's shorter side.
  margin: number;
};

export const WATERMARK_LIMITS = {
  scale: { min: 5, max: 50 },
  opacity: { min: 0.05, max: 1 },
  margin: { min: 0, max: 20 },
} as const;

export const DEFAULT_WATERMARK: WatermarkSettings = {
  enabled: true,
  logo: null,
  position: "bottom-right",
  scale: 15,
  opacity: 0.8,
  margin: 4,
};

export type WatermarkRect = { x: number; y: number; width: number; height: number };

// One placement function for both the admin preview and the actual burn-in,
// so what the preview shows is exactly what lands in the video.
export function watermarkRect(
  frame: { width: number; height: number },
  logo: { width: number; height: number },
  settings: Pick<WatermarkSettings, "position" | "scale" | "margin">,
): WatermarkRect {
  const width = (frame.width * settings.scale) / 100;
  const height = width * (logo.height / logo.width);
  const margin = (Math.min(frame.width, frame.height) * settings.margin) / 100;

  const left = margin;
  const right = frame.width - width - margin;
  const top = margin;
  const bottom = frame.height - height - margin;

  switch (settings.position) {
    case "top-left":
      return { x: left, y: top, width, height };
    case "top-right":
      return { x: right, y: top, width, height };
    case "bottom-left":
      return { x: left, y: bottom, width, height };
    case "bottom-right":
      return { x: right, y: bottom, width, height };
    case "center":
      return {
        x: (frame.width - width) / 2,
        y: (frame.height - height) / 2,
        width,
        height,
      };
  }
}

// Lives here rather than next to burnWatermark() so the upload form can check
// support without pulling the encoder library into the initial bundle.
export function canBurnWatermark(): boolean {
  return (
    typeof window !== "undefined" &&
    "VideoEncoder" in window &&
    "VideoDecoder" in window &&
    typeof OffscreenCanvas !== "undefined"
  );
}
