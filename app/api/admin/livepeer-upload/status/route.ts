import type { NextRequest } from "next/server";
import { livepeer, resolvePlayback } from "@/lib/livepeer";

export async function GET(request: NextRequest) {
  const assetId = request.nextUrl.searchParams.get("assetId");
  if (!assetId) {
    return Response.json({ error: "assetId required" }, { status: 400 });
  }

  const { asset } = await livepeer().asset.get(assetId);
  const phase = asset?.status?.phase;
  if (phase === "failed") {
    return Response.json({
      status: "errored",
      error: asset?.status?.errorMessage,
    });
  }
  if (phase !== "ready" || !asset?.playbackId) {
    // Only "processing" (post-upload transcoding) has a meaningful
    // progress fraction; "waiting" (queued, pre-transcode) never does.
    const progress =
      phase === "processing" ? asset?.status?.progress : undefined;
    return Response.json({ status: "waiting", progress });
  }

  const playback = await resolvePlayback(asset.playbackId);
  if (!playback) {
    return Response.json({ status: "errored", error: "No playback URL" });
  }

  return Response.json({
    status: "ready",
    assetId: asset.id,
    playbackId: asset.playbackId,
    ...playback,
  });
}
