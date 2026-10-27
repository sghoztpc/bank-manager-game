import { Redis } from "@upstash/redis";
import { MemoryStore } from "./memory";
import { RedisStore } from "./redis";
import type { Store } from "./types";

const g = globalThis as unknown as { __bmgStore?: Store };

export class StoreConfigError extends Error {}

/** Exact name first, then any prefixed variant (the Vercel integration can add a custom prefix). */
function envEndingWith(suffix: string): string | undefined {
  if (process.env[suffix]) return process.env[suffix];
  const key = Object.keys(process.env).find((k) => k.endsWith(`_${suffix}`) && process.env[k]);
  return key ? process.env[key] : undefined;
}

/** Upstash when configured; otherwise an in-process store, which is refused on Vercel. */
export function getStore(): Store {
  if (g.__bmgStore) return g.__bmgStore;
  const url = envEndingWith("KV_REST_API_URL") ?? envEndingWith("UPSTASH_REDIS_REST_URL");
  const token = envEndingWith("KV_REST_API_TOKEN") ?? envEndingWith("UPSTASH_REDIS_REST_TOKEN");
  if (url && token) {
    g.__bmgStore = new RedisStore(new Redis({ url, token, automaticDeserialization: false }));
  } else if (process.env.VERCEL) {
    throw new StoreConfigError(
      "No shared database configured. Add an Upstash Redis store to this Vercel project (KV_REST_API_URL / KV_REST_API_TOKEN).",
    );
  } else {
    g.__bmgStore = new MemoryStore();
  }
  return g.__bmgStore;
}

/** Tests inject their own store. */
export function setStore(store: Store | undefined) {
  g.__bmgStore = store;
}
