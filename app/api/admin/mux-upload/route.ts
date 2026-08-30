import { mux } from "@/lib/mux";

// Server only mints the direct-upload URL; the actual video bytes go
// straight from the browser to Mux, not through this app.
export async function POST(request: Request) {
  const origin = request.headers.get("origin") ?? "*";
  const upload = await mux().video.uploads.create({
    cors_origin: origin,
    new_asset_settings: { playback_policy: ["public"] },
  });
  return Response.json({ uploadUrl: upload.url, uploadId: upload.id });
}
