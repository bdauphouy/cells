import { ImageResponse } from "next/og";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { SITE_NAME } from "@/lib/site";

// Replaces the old static opengraph-image.png: same 1200×630 black card, but
// just the wordmark centred — no tagline line underneath.
export const alt = `${SITE_NAME} — Celeste Cuestas, video editor`;
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// The mark is already white-on-transparent, so it drops straight onto the
// black field. Read once at module scope — it never varies per request.
const logo = await readFile(join(process.cwd(), "public/logo.svg"), "utf8");
const logoSrc = `data:image/svg+xml;base64,${Buffer.from(logo).toString("base64")}`;

export default function Image() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#000000",
        }}
      >
        {/* 1366×886 native, held to ~55% of the card's width. */}
        <img src={logoSrc} width={660} height={428} alt="" />
      </div>
    ),
    { ...size },
  );
}
