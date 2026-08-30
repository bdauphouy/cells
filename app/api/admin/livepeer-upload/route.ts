import type { NextRequest } from "next/server";
import { livepeer } from "@/lib/livepeer";

// Server only mints the direct-upload endpoint; the actual video bytes go
// straight from the browser to Livepeer over tus, not through this app.
// Called lazily right as an upload starts, so a Livepeer-side failure (e.g. a
// plan's asset cap) is a real, expected outcome the client needs valid JSON
// to react to — not just an uncaught throw.
export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    return Response.json({ error: "name required" }, { status: 400 });
  }

  try {
    const { data } = await livepeer().asset.create({ name });
    if (!data) {
      return Response.json(
        { error: "Couldn't start the upload with Livepeer." },
        { status: 502 },
      );
    }
    return Response.json({
      tusEndpoint: data.tusEndpoint,
      assetId: data.asset.id,
    });
  } catch (err) {
    console.error("Failed to create Livepeer upload", err);
    return Response.json(
      { error: "Couldn't start the upload with Livepeer." },
      { status: 502 },
    );
  }
}

// Cancels an upload or in-progress encode. This asset was never saved to the
// library — it only exists as a Livepeer asset the client is still polling —
// so there's no library entry to remove, just the asset itself.
export async function DELETE(request: NextRequest) {
  const assetId = request.nextUrl.searchParams.get("assetId");
  if (!assetId) {
    return Response.json({ error: "assetId required" }, { status: 400 });
  }

  await livepeer()
    .asset.delete(assetId)
    .catch((err) => console.error("Failed to cancel Livepeer asset", err));

  return Response.json({ ok: true });
}
