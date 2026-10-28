import type { PlayerRecord, SessionMeta, Submission } from "../types";

export type SubmitResult = "ok" | "duplicate" | "closed";

/**
 * Persistence used by the game service. Every method that must be atomic across concurrent
 * serverless instances says so; the Redis implementation does those in one Lua script.
 */
export interface Store {
  readonly kind: "memory" | "redis";

  /** Creates the session only if the code is unused. */
  createMeta(meta: SessionMeta): Promise<boolean>;
  getMeta(code: string): Promise<SessionMeta | null>;
  putMeta(meta: SessionMeta): Promise<void>;
  /** One round trip for the common player poll. */
  getMetaAndPlayer(code: string, playerId: string): Promise<[SessionMeta | null, PlayerRecord | null]>;

  /** Short-lived mutual exclusion (SET NX PX). */
  lock(key: string, ttlMs: number): Promise<boolean>;
  unlock(key: string): Promise<void>;

  /** Atomically reserves a nickname (case-insensitive key). */
  claimName(code: string, nameKey: string): Promise<boolean>;
  releaseName(code: string, nameKey: string): Promise<void>;
  /** Atomic: refuses when the session already holds `max` players. */
  addPlayer(player: PlayerRecord, code: string, max: number): Promise<boolean>;
  removePlayer(code: string, playerId: string): Promise<void>;
  countPlayers(code: string): Promise<number>;
  getPlayer(code: string, playerId: string): Promise<PlayerRecord | null>;
  getPlayers(code: string): Promise<PlayerRecord[]>;
  putPlayers(code: string, players: PlayerRecord[]): Promise<void>;

  /** Atomic: first submission wins, and nothing is accepted once the item is closed. */
  submit(code: string, itemIndex: number, playerId: string, sub: Submission): Promise<SubmitResult>;
  getSubmission(code: string, itemIndex: number, playerId: string): Promise<Submission | null>;
  /** Marks the item closed; later submit() calls return "closed". */
  closeItem(code: string, itemIndex: number): Promise<void>;
  getSubmissions(code: string, itemIndex: number): Promise<Record<string, Submission>>;
  countSubmissions(code: string, itemIndex: number): Promise<number>;

  /** Records when a player first received an open case (first write wins). */
  markViewed(code: string, itemIndex: number, playerId: string, offsetMs: number): Promise<void>;
  getViews(code: string, itemIndex: number): Promise<Record<string, number>>;

  /** Lobby Ready check (Brief 3): a set of player ids, so repeated presses have no extra effect. */
  setReady(code: string, playerId: string, ready: boolean): Promise<void>;
  readyIds(code: string): Promise<string[]>;

  /** Presence heartbeat. */
  touch(code: string, playerId: string, at: number): Promise<void>;
  activeSince(code: string, since: number): Promise<string[]>;
  forget(code: string, playerId: string): Promise<void>;
}

export const keys = {
  meta: (c: string) => `bmg:${c}:meta`,
  players: (c: string) => `bmg:${c}:players`,
  player: (c: string, id: string) => `bmg:${c}:p:${id}`,
  names: (c: string) => `bmg:${c}:names`,
  subs: (c: string, i: number) => `bmg:${c}:subs:${i}`,
  closed: (c: string, i: number) => `bmg:${c}:closed:${i}`,
  views: (c: string, i: number) => `bmg:${c}:views:${i}`,
  seen: (c: string) => `bmg:${c}:seen`,
  ready: (c: string) => `bmg:${c}:ready`,
  lock: (name: string) => `bmg:lock:${name}`,
};
