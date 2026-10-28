import { ELIMINATION } from "../config";
import type { EliminationRecord, PlayerRecord } from "../types";

// The single rule for every balance change (case settlement, quiz reward, host adjustment):
//   1. the caller has already checked the event is valid and not yet applied;
//   2. compute the resulting balance;
//   3. positive: apply it;
//   4. zero or below, fewer than five eliminated: balance 0, eliminated, one quota slot used;
//   5. zero or below, quota used up: stay active at the 1 VND safety floor.
// Callers apply events in one authoritative order under the session lock, so the quota can
// never be over-filled.

export type BalanceOutcome = "applied" | "eliminated" | "floored";

export interface BalanceEvent {
  cause: string;
  itemIndex: number | null;
  at: number;
}

export interface BalanceResult {
  outcome: BalanceOutcome;
  before: number;
  after: number;
  /** What actually changed (after - before). */
  applied: number;
  record?: EliminationRecord;
}

export function floorActive(eliminations: EliminationRecord[]): boolean {
  return eliminations.length >= ELIMINATION.quota;
}

/** What would happen, without changing anything (used for the host's preview). */
export function previewBalanceChange(balance: number, change: number, eliminations: EliminationRecord[]): { outcome: BalanceOutcome; after: number; order: number | null } {
  const next = balance + change;
  if (next > 0) return { outcome: "applied", after: next, order: null };
  if (!floorActive(eliminations)) return { outcome: "eliminated", after: 0, order: eliminations.length + 1 };
  return { outcome: "floored", after: ELIMINATION.safetyFloor, order: null };
}

/** Mutates the player and, on elimination, appends to `eliminations`. */
export function applyBalanceChange(player: PlayerRecord, change: number, event: BalanceEvent, eliminations: EliminationRecord[]): BalanceResult {
  if (player.status === "eliminated") throw new Error(`${player.name} is already eliminated`);
  const before = player.balance;
  const p = previewBalanceChange(before, change, eliminations);
  player.balance = p.after;
  let record: EliminationRecord | undefined;
  if (p.outcome === "eliminated") {
    record = {
      order: p.order!,
      playerId: player.id,
      name: player.name,
      cause: event.cause,
      itemIndex: event.itemIndex,
      before,
      change,
      at: event.at,
    };
    eliminations.push(record);
    player.status = "eliminated";
    player.eliminationOrder = record.order;
    player.rank = null;
  }
  return { outcome: p.outcome, before, after: p.after, applied: p.after - before, record };
}
