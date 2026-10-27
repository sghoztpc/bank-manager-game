import { Redis } from "@upstash/redis";
import { MemoryStore } from "./memory";
import { RedisStore } from "./redis";
import type { Store } from "./types";

const g = globalThis as unknown as { __bmgStore?: Store };

export class StoreConfigError extends Error {}

/** Upstash when configured; otherwise an in-process store, which is refused on Vercel. */
export function getStore(): Store {
  if (g.__bmgStore) return g.__bmgStore;
  const url = process.env.KV_REST_API_URL ?? process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN ?? process.env.UPSTASH_REDIS_REST_TOKEN;
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
