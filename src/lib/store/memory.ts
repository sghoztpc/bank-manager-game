import type { PlayerRecord, SessionMeta, Submission } from "../types";
import type { Store, SubmitResult } from "./types";

// Single-process store for local development and tests. JavaScript runs each method body
// without interleaving, which gives the same atomicity the Redis scripts provide.
// Not usable on Vercel: separate function instances would each hold their own copy.

const clone = <T>(v: T): T => structuredClone(v);

interface SessionData {
  meta: SessionMeta;
  players: Map<string, PlayerRecord>;
  /** The roster; removed players keep their record (as in Redis) but leave this set. */
  members: Set<string>;
  names: Set<string>;
  subs: Map<number, Map<string, Submission>>;
  closed: Set<number>;
  views: Map<number, Map<string, number>>;
  seen: Map<string, number>;
  ready: Set<string>;
}

export class MemoryStore implements Store {
  readonly kind = "memory" as const;
  private sessions = new Map<string, SessionData>();
  private locks = new Map<string, number>();

  private s(code: string): SessionData {
    const s = this.sessions.get(code);
    if (!s) throw new Error(`No session ${code}`);
    return s;
  }

  async createMeta(meta: SessionMeta) {
    if (this.sessions.has(meta.code)) return false;
    this.sessions.set(meta.code, {
      meta: clone(meta),
      players: new Map(),
      members: new Set(),
      names: new Set(),
      subs: new Map(),
      closed: new Set(),
      views: new Map(),
      seen: new Map(),
      ready: new Set(),
    });
    return true;
  }

  async getMeta(code: string) {
    const s = this.sessions.get(code);
    return s ? clone(s.meta) : null;
  }

  async putMeta(meta: SessionMeta) {
    this.s(meta.code).meta = clone(meta);
  }

  async getMetaAndPlayer(code: string, playerId: string): Promise<[SessionMeta | null, PlayerRecord | null]> {
    const s = this.sessions.get(code);
    if (!s) return [null, null];
    const p = s.players.get(playerId);
    return [clone(s.meta), p ? clone(p) : null];
  }

  async lock(key: string, ttlMs: number) {
    const now = Date.now();
    const until = this.locks.get(key);
    if (until !== undefined && until > now) return false;
    this.locks.set(key, now + ttlMs);
    return true;
  }

  async unlock(key: string) {
    this.locks.delete(key);
  }

  async claimName(code: string, nameKey: string) {
    const names = this.s(code).names;
    if (names.has(nameKey)) return false;
    names.add(nameKey);
    return true;
  }

  async releaseName(code: string, nameKey: string) {
    this.s(code).names.delete(nameKey);
  }

  async addPlayer(player: PlayerRecord, code: string, max: number) {
    const s = this.s(code);
    if (s.members.size >= max) return false;
    s.players.set(player.id, clone(player));
    s.members.add(player.id);
    return true;
  }

  async removePlayer(code: string, playerId: string) {
    this.s(code).members.delete(playerId);
  }

  async countPlayers(code: string) {
    return this.sessions.get(code)?.members.size ?? 0;
  }

  async getPlayer(code: string, playerId: string) {
    const p = this.sessions.get(code)?.players.get(playerId);
    return p ? clone(p) : null;
  }

  async getPlayers(code: string) {
    const s = this.s(code);
    return [...s.members].map((id) => clone(s.players.get(id)!));
  }

  async putPlayers(code: string, players: PlayerRecord[]) {
    const s = this.s(code);
    for (const p of players) s.players.set(p.id, clone(p));
  }

  async submit(code: string, itemIndex: number, playerId: string, sub: Submission): Promise<SubmitResult> {
    const s = this.s(code);
    if (s.closed.has(itemIndex)) return "closed";
    let m = s.subs.get(itemIndex);
    if (!m) s.subs.set(itemIndex, (m = new Map()));
    if (m.has(playerId)) return "duplicate";
    m.set(playerId, clone(sub));
    return "ok";
  }

  async getSubmission(code: string, itemIndex: number, playerId: string) {
    const sub = this.s(code).subs.get(itemIndex)?.get(playerId);
    return sub ? clone(sub) : null;
  }

  async closeItem(code: string, itemIndex: number) {
    this.s(code).closed.add(itemIndex);
  }

  async getSubmissions(code: string, itemIndex: number) {
    return Object.fromEntries([...(this.s(code).subs.get(itemIndex) ?? new Map())].map(([k, v]) => [k, clone(v)]));
  }

  async countSubmissions(code: string, itemIndex: number) {
    return this.s(code).subs.get(itemIndex)?.size ?? 0;
  }

  async markViewed(code: string, itemIndex: number, playerId: string, offsetMs: number) {
    const s = this.s(code);
    let m = s.views.get(itemIndex);
    if (!m) s.views.set(itemIndex, (m = new Map()));
    if (!m.has(playerId)) m.set(playerId, offsetMs);
  }

  async getViews(code: string, itemIndex: number) {
    return Object.fromEntries(this.s(code).views.get(itemIndex) ?? new Map());
  }

  async setReady(code: string, playerId: string, ready: boolean) {
    const s = this.s(code);
    if (ready) s.ready.add(playerId);
    else s.ready.delete(playerId);
  }

  async readyIds(code: string) {
    return [...this.s(code).ready];
  }

  async touch(code: string, playerId: string, at: number) {
    this.sessions.get(code)?.seen.set(playerId, at);
  }

  async activeSince(code: string, since: number) {
    return [...this.s(code).seen].filter(([, at]) => at >= since).map(([id]) => id);
  }

  async forget(code: string, playerId: string) {
    this.s(code).seen.delete(playerId);
  }
}
