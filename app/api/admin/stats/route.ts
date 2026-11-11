import type { NextRequest } from "next/server";
import { getStats, STATS_RANGES, type StatsRange } from "@/lib/analytics";

export async function GET(request: NextRequest) {
  const requested = Number(request.nextUrl.searchParams.get("range"));
  const range: StatsRange = STATS_RANGES.includes(requested as StatsRange)
    ? (requested as StatsRange)
    : 30;
  return Response.json(await getStats(range));
}
