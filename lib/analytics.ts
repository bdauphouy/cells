import { createHmac } from "node:crypto";
import { db } from "@/lib/kv";

// Cookieless, self-hosted visit counting in the same Redis as everything
// else. Each UTC day gets one hash of counters (views plus one field per
// country / browser / OS / device / referrer) and one HyperLogLog of
// visitor fingerprints. No IP or user agent is ever stored: the fingerprint
// is an HMAC over IP + UA + the day, so it can't be reversed and the same
// person can't be followed from one day to the next.

const RETENTION_SECONDS = 60 * 60 * 24 * 400;
export const STATS_RANGES = [7, 30, 90] as const;
export type StatsRange = (typeof STATS_RANGES)[number];

const countersKey = (day: string) => `stats:d:${day}`;
const visitorsKey = (day: string) => `stats:u:${day}`;
const dayOf = (date: Date) => date.toISOString().slice(0, 10);

// Field prefixes inside the day hash. One hash per day instead of one key
// per dimension keeps a recorded visit to a single pipeline of few commands.
const DIMENSIONS = {
  country: "c:",
  browser: "b:",
  os: "o:",
  device: "d:",
  referrer: "r:",
} as const;
type Dimension = keyof typeof DIMENSIONS;

const BOT_UA =
  /bot|crawl|spider|slurp|headless|lighthouse|pagespeed|preview|facebookexternalhit|embedly|curl|wget|python|node-fetch|axios|go-http/i;

export function isBot(ua: string): boolean {
  return !ua || BOT_UA.test(ua);
}

// A deliberately small parser: enough to bucket real traffic into the
// handful of names worth showing, without pulling in a UA library. Order
// matters — in-app browsers and Chromium forks also claim to be Chrome and
// Safari, so they're checked first.
export function parseUserAgent(ua: string) {
  const browser =
    /Instagram/.test(ua) ? "Instagram"
    : /BytedanceWebview|musical_ly|TikTok/i.test(ua) ? "TikTok"
    : /FBAN|FBAV/.test(ua) ? "Facebook"
    : /Edg(e|A|iOS)?\//.test(ua) ? "Edge"
    : /OPR\/|Opera/.test(ua) ? "Opera"
    : /SamsungBrowser/.test(ua) ? "Samsung Internet"
    : /Firefox\/|FxiOS/.test(ua) ? "Firefox"
    : /Chrome\/|CriOS/.test(ua) ? "Chrome"
    : /Safari\//.test(ua) ? "Safari"
    : "Other";

  const os =
    /iPhone|iPad|iPod/.test(ua) ? "iOS"
    : /Android/.test(ua) ? "Android"
    : /Windows/.test(ua) ? "Windows"
    : /CrOS/.test(ua) ? "ChromeOS"
    : /Mac OS X|Macintosh/.test(ua) ? "macOS"
    : /Linux/.test(ua) ? "Linux"
    : "Other";

  const device =
    /iPad|Tablet/.test(ua) || (/Android/.test(ua) && !/Mobile/.test(ua))
      ? "Tablet"
      : /Mobi|iPhone|iPod|Android/.test(ua)
        ? "Mobile"
        : "Desktop";

  return { browser, os, device };
}

// Only the referring host is kept — a full URL can carry search terms or
// tokens. Visits from the site itself are not a referral.
export function referrerHost(referrer: unknown, ownHost: string | null): string {
  if (typeof referrer !== "string" || !referrer) return "Direct";
  try {
    const host = new URL(referrer).hostname.replace(/^www\./, "");
    if (!host || host === ownHost?.replace(/^www\./, "")) return "Direct";
    // Instagram / Facebook link shims (l.instagram.com, lm.facebook.com…)
    // are the same source as the bare domain.
    return host.replace(/^(l|lm|m)\.(instagram|facebook)\.com$/, "$2.com");
  } catch {
    return "Direct";
  }
}

function fingerprint(day: string, ip: string, ua: string): string {
  const secret = process.env.ANALYTICS_SALT ?? process.env.KV_REST_API_TOKEN ?? "";
  return createHmac("sha256", secret).update(`${day}|${ip}|${ua}`).digest("hex").slice(0, 16);
}

export async function recordVisit(visit: {
  ip: string;
  ua: string;
  country: string;
  referrer: string;
}) {
  const day = dayOf(new Date());
  const { browser, os, device } = parseUserAgent(visit.ua);
  const key = countersKey(day);

  const p = db().pipeline();
  p.hincrby(key, "views", 1);
  p.hincrby(key, DIMENSIONS.country + visit.country, 1);
  p.hincrby(key, DIMENSIONS.browser + browser, 1);
  p.hincrby(key, DIMENSIONS.os + os, 1);
  p.hincrby(key, DIMENSIONS.device + device, 1);
  p.hincrby(key, DIMENSIONS.referrer + visit.referrer, 1);
  p.expire(key, RETENTION_SECONDS);
  p.pfadd(visitorsKey(day), fingerprint(day, visit.ip, visit.ua));
  p.expire(visitorsKey(day), RETENTION_SECONDS);
  await p.exec();
}

export type StatsEntry = { name: string; count: number };
export type StatsReport = {
  range: StatsRange;
  views: number;
  // Unique over the whole range would need a cross-day identifier, which is
  // exactly what the per-day fingerprint avoids. This is the sum of daily
  // uniques: someone who comes back on three days counts three times.
  visitors: number;
  daily: { day: string; views: number; visitors: number }[];
  breakdown: Record<Dimension, StatsEntry[]>;
};

export async function getStats(range: StatsRange): Promise<StatsReport> {
  const today = new Date();
  const days = Array.from({ length: range }, (_, i) => {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - (range - 1 - i));
    return dayOf(d);
  });

  const p = db().pipeline();
  for (const day of days) {
    p.hgetall(countersKey(day));
    p.pfcount(visitorsKey(day));
  }
  const results = await p.exec();

  const totals = Object.fromEntries(
    Object.keys(DIMENSIONS).map((d) => [d, new Map<string, number>()]),
  ) as Record<Dimension, Map<string, number>>;
  const daily: StatsReport["daily"] = [];

  days.forEach((day, i) => {
    const counters = (results[i * 2] ?? {}) as Record<string, number | string>;
    const visitors = Number(results[i * 2 + 1] ?? 0);
    daily.push({ day, views: Number(counters.views ?? 0), visitors });

    for (const [field, raw] of Object.entries(counters)) {
      const dim = (Object.keys(DIMENSIONS) as Dimension[]).find((d) =>
        field.startsWith(DIMENSIONS[d]),
      );
      if (!dim) continue;
      const name = field.slice(DIMENSIONS[dim].length);
      totals[dim].set(name, (totals[dim].get(name) ?? 0) + Number(raw));
    }
  });

  const breakdown = Object.fromEntries(
    (Object.keys(totals) as Dimension[]).map((dim) => [
      dim,
      [...totals[dim]]
        .map(([name, count]) => ({ name, count }))
        .sort((a, b) => b.count - a.count),
    ]),
  ) as StatsReport["breakdown"];

  return {
    range,
    views: daily.reduce((n, d) => n + d.views, 0),
    visitors: daily.reduce((n, d) => n + d.visitors, 0),
    daily,
    breakdown,
  };
}
