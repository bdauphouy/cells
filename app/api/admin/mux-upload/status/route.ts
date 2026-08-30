import type { NextRequest } from "next/server";
import { mux } from "@/lib/mux";

export async function GET(request: NextRequest) {
  const uploadId = request.nextUrl.searchParams.get("uploadId");
  if (!uploadId) {
    return Response.json({ error: "uploadId required" }, { status: 400 });
  }

  const upload = await mux().video.uploads.retrieve(uploadId);
  if (upload.status === "errored") {
    return Response.json({ status: "errored", error: upload.error });
  }
  if (!upload.asset_id) {
    return Response.json({ status: "waiting" });
  }

  const asset = await mux().video.assets.retrieve(upload.asset_id);
  if (asset.status === "errored") {
    return Response.json({ status: "errored", error: asset.errors });
  }
  if (asset.status !== "ready") {
    return Response.json({ status: "waiting" });
  }

  const playbackId = asset.playback_ids?.[0]?.id;
  if (!playbackId) {
    return Response.json({ status: "errored", error: "No playback id" });
  }

  return Response.json({
    status: "ready",
    assetId: asset.id,
    playbackId,
    aspectRatio: asset.aspect_ratio ?? "16:9",
  });
}
