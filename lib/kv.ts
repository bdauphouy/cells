import { Redis } from "@upstash/redis";

// Lazy, not module-top-level: the modules that use this are imported at build
// time too, and the env vars it needs aren't guaranteed to exist yet at that
// point.
let _redis: Redis | null = null;

export function db(): Redis {
  if (!_redis) {
    const url = process.env.KV_REST_API_URL;
    const token = process.env.KV_REST_API_TOKEN;
    if (!url || !token) {
      throw new Error("KV_REST_API_URL / KV_REST_API_TOKEN are not set");
    }
    _redis = new Redis({ url, token });
  }
  return _redis;
}
