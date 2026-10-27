import type { LeaderEntry, PlayerRecord } from "../types";

/**
 * Money first; then more correct decisions; then less total time spent on those correct
 * decisions. Players equal on all three share a rank (listed in join order).
 */
export function compareStanding(a: PlayerRecord, b: PlayerRecord): number {
  return b.balance - a.balance || b.correct - a.correct || a.correctMs - b.correctMs;
}

export function rankPlayers(players: PlayerRecord[]): PlayerRecord[] {
  const sorted = players
    .filter((p) => !p.kicked)
    .sort((a, b) => compareStanding(a, b) || a.joinedAt - b.joinedAt);
  sorted.forEach((p, i) => {
    p.rank = i > 0 && compareStanding(sorted[i - 1], p) === 0 ? sorted[i - 1].rank : i + 1;
  });
  return sorted;
}

export function toLeaderEntries(ranked: PlayerRecord[], limit: number): LeaderEntry[] {
  return ranked.slice(0, limit).map((p) => ({
    id: p.id,
    name: p.name,
    balance: p.balance,
    correct: p.correct,
    rank: p.rank ?? 0,
    late: p.joinedAtItem >= 0,
  }));
}
