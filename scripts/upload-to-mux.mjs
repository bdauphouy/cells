// Pushes a local video file to Mux and prints the playback ID to put in
// NEXT_PUBLIC_MUX_PLAYBACK_ID. Not part of the app's runtime — run by hand
// whenever the source video changes.
//
//   node --env-file=.env.local scripts/upload-to-mux.mjs path/to/video.mp4
import { readFileSync } from "node:fs";
import Mux from "@mux/mux-node";

const POLL_MS = 2000;

const path = process.argv[2];
if (!path) {
  console.error("Usage: upload-to-mux.mjs <path-to-video>");
  process.exit(1);
}

const mux = new Mux({
  tokenId: process.env.MUX_TOKEN_ID,
  tokenSecret: process.env.MUX_TOKEN_SECRET,
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log("Creating direct upload…");
  const upload = await mux.video.uploads.create({
    cors_origin: "*",
    new_asset_settings: { playback_policy: ["public"] },
  });

  console.log(`Uploading ${path}…`);
  const body = readFileSync(path);
  const res = await fetch(upload.url, { method: "PUT", body });
  if (!res.ok) {
    throw new Error(`Upload PUT failed: ${res.status} ${res.statusText}`);
  }

  console.log("Waiting for Mux to attach the asset…");
  let assetId;
  while (!assetId) {
    await sleep(POLL_MS);
    const current = await mux.video.uploads.retrieve(upload.id);
    if (current.status === "errored") {
      throw new Error(`Upload errored: ${JSON.stringify(current.error)}`);
    }
    assetId = current.asset_id;
  }

  console.log("Waiting for the asset to finish encoding…");
  let asset = await mux.video.assets.retrieve(assetId);
  while (asset.status !== "ready") {
    if (asset.status === "errored") {
      throw new Error(`Asset errored: ${JSON.stringify(asset.errors)}`);
    }
    await sleep(POLL_MS);
    asset = await mux.video.assets.retrieve(assetId);
  }

  const playbackId = asset.playback_ids?.[0]?.id;
  console.log(`\nReady. Playback ID: ${playbackId}`);
  console.log(
    "Set NEXT_PUBLIC_MUX_PLAYBACK_ID to it in .env.local and in Vercel",
    "(`vercel env add NEXT_PUBLIC_MUX_PLAYBACK_ID`) to point the carousel at it.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
