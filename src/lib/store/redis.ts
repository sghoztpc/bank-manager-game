import { Redis } from "@upstash/redis";
import { SESSION_TTL_SECONDS } from "../config";
import type { PlayerRecord, SessionMeta, Submission } from "../types";
import { keys, type Store, type SubmitResult } from "./types";

// Upstash Redis over HTTP (works from Vercel functions; no persistent connections needed).
// Every key expires SESSION_TTL_SECONDS after its last write.

const TTL = SESSION_TTL_SECONDS;

const ADD_PLAYER = `
if redis.call('SCARD', KEYS[1]) >= tonumber(ARGV[3]) then return 0 end
redis.call('SADD', KEYS[1], ARGV[1])
redis.call('EXPIRE', KEYS[1], ARGV[4])
redis.call('SET', KEYS[2], ARGV[2], 'EX', ARGV[4])
return 1`;

const SUBMIT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return -1 end
local r = redis.call('HSETNX', KEYS[2], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[2], ARGV[3])
return r`;

const parse = <T>(raw: unknown): T | null => (typeof raw === "string" ? (JSON.parse(raw) as T) : null);

/** With automaticDeserialization off, HGETALL comes back as the raw [field, value, ...] list. */
function hashEntries(raw: unknown): [string, string][] {
  if (Array.isArray(raw)) {
    const out: [string, string][] = [];
    for (let i = 0; i + 1 < raw.length; i += 2) out.push([String(raw[i]), String(raw[i + 1])]);
    return out;
  }
  return raw && typeof raw === "object" ? Object.entries(raw as Record<string, string>) : [];
}

export class RedisStore implements Store {
  readonly kind = "redis" as const;
  constructor(private redis: Redis) {}

  async createMeta(meta: SessionMeta) {
    const r = await this.redis.set(keys.meta(meta.code), JSON.stringify(meta), { nx: true, ex: TTL });
    if (r !== "OK") return false;
    // Create the presence set with its TTL now, so heartbeats can be a bare ZADD.
    // The sentinel's score (-1) is never inside an activeSince() window.
    const p = this.redis.pipeline();
    p.zadd(keys.seen(meta.code), { score: -1, member: "~" });
    p.expire(keys.seen(meta.code), TTL);
    await p.exec();
    return true;
  }

  async getMeta(code: string) {
    return parse<SessionMeta>(await this.redis.get(keys.meta(code)));
  }

  async putMeta(meta: SessionMeta) {
    await this.redis.set(keys.meta(meta.code), JSON.stringify(meta), { ex: TTL });
  }

  async getMetaAndPlayer(code: string, playerId: string): Promise<[SessionMeta | null, PlayerRecord | null]> {
    const [m, p] = await this.redis.mget<(string | null)[]>(keys.meta(code), keys.player(code, playerId));
    return [parse<SessionMeta>(m), parse<PlayerRecord>(p)];
  }

  async lock(key: string, ttlMs: number) {
    return (await this.redis.set(keys.lock(key), "1", { nx: true, px: ttlMs })) === "OK";
  }

  async unlock(key: string) {
    await this.redis.del(keys.lock(key));
  }

  async claimName(code: string, nameKey: string) {
    const p = this.redis.pipeline();
    p.sadd(keys.names(code), nameKey);
    p.expire(keys.names(code), TTL);
    const [added] = await p.exec<[number, number]>();
    return added === 1;
  }

  async releaseName(code: string, nameKey: string) {
    await this.redis.srem(keys.names(code), nameKey);
  }

  async addPlayer(player: PlayerRecord, code: string, max: number) {
    const r = await this.redis.eval(
      ADD_PLAYER,
      [keys.players(code), keys.player(code, player.id)],
      [player.id, JSON.stringify(player), String(max), String(TTL)],
    );
    return Number(r) === 1;
  }

  async removePlayer(code: string, playerId: string) {
    await this.redis.srem(keys.players(code), playerId);
  }

  async countPlayers(code: string) {
    return this.redis.scard(keys.players(code));
  }

  async getPlayer(code: string, playerId: string) {
    return parse<PlayerRecord>(await this.redis.get(keys.player(code, playerId)));
  }

  async getPlayers(code: string) {
    const ids = await this.redis.smembers(keys.players(code));
    if (ids.length === 0) return [];
    const raw = await this.redis.mget<(string | null)[]>(...ids.map((id) => keys.player(code, id)));
    return raw.map((r) => parse<PlayerRecord>(r)).filter((p): p is PlayerRecord => p !== null);
  }

  async putPlayers(code: string, players: PlayerRecord[]) {
    if (players.length === 0) return;
    const p = this.redis.pipeline();
    for (const pl of players) p.set(keys.player(code, pl.id), JSON.stringify(pl), { ex: TTL });
    await p.exec();
  }

  async submit(code: string, itemIndex: number, playerId: string, sub: Submission): Promise<SubmitResult> {
    const r = Number(
      await this.redis.eval(
        SUBMIT,
        [keys.closed(code, itemIndex), keys.subs(code, itemIndex)],
        [playerId, JSON.stringify(sub), String(TTL)],
      ),
    );
    return r === -1 ? "closed" : r === 1 ? "ok" : "duplicate";
  }

  async getSubmission(code: string, itemIndex: number, playerId: string) {
    return parse<Submission>(await this.redis.hget(keys.subs(code, itemIndex), playerId));
  }

  async closeItem(code: string, itemIndex: number) {
    await this.redis.set(keys.closed(code, itemIndex), "1", { ex: TTL });
  }

  async getSubmissions(code: string, itemIndex: number) {
    const raw = await this.redis.hgetall(keys.subs(code, itemIndex));
    return Object.fromEntries(hashEntries(raw).map(([k, v]) => [k, parse<Submission>(v)!]));
  }

  async countSubmissions(code: string, itemIndex: number) {
    return this.redis.hlen(keys.subs(code, itemIndex));
  }

  async markViewed(code: string, itemIndex: number, playerId: string, offsetMs: number) {
    const p = this.redis.pipeline();
    p.hsetnx(keys.views(code, itemIndex), playerId, String(offsetMs));
    p.expire(keys.views(code, itemIndex), TTL);
    await p.exec();
  }

  async getViews(code: string, itemIndex: number) {
    const raw = await this.redis.hgetall(keys.views(code, itemIndex));
    return Object.fromEntries(hashEntries(raw).map(([k, v]) => [k, Number(v)]));
  }

  async touch(code: string, playerId: string, at: number) {
    await this.redis.zadd(keys.seen(code), { score: at, member: playerId });
  }

  async activeSince(code: string, since: number) {
    return this.redis.zrange<string[]>(keys.seen(code), since, "+inf", { byScore: true });
  }

  async forget(code: string, playerId: string) {
    await this.redis.zrem(keys.seen(code), playerId);
  }
}
