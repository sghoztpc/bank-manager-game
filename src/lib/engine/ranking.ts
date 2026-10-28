import type { LeaderEntry, PlayerRecord } from "../types";

/**
 * Active players: balance, highest first; then correct decisions, most first. Players equal on
 * both share a competitive rank (1, 1, 3); the display order of tied rows (join order) does not
 * break the tie. Eliminated players are not ranked; they are listed separately by elimination order.
 */
export function compareStanding(a: PlayerRecord, b: PlayerRecord): number {
  return b.balance - a.balance || b.correct - a.correct;
}

/** Ranks active players in place (keeping their previous rank for the rank-change arrow). */
export function rankPlayers(players: PlayerRecord[]): PlayerRecord[] {
  const active = players
    .filter((p) => !p.kicked && p.status === "active")
    .sort((a, b) => compareStanding(a, b) || a.joinedAt - b.joinedAt);
  active.forEach((p, i) => {
    p.prevRank = p.rank;
    p.rank = i > 0 && compareStanding(active[i - 1], p) === 0 ? active[i - 1].rank : i + 1;
  });
  for (const p of players) if (p.status === "eliminated") p.rank = null;
  return active;
}

export function eliminatedPlayers(players: PlayerRecord[]): PlayerRecord[] {
  return players.filter((p) => !p.kicked && p.status === "eliminated").sort((a, b) => (a.eliminationOrder ?? 0) - (b.eliminationOrder ?? 0));
}

export function toLeaderEntry(p: PlayerRecord): LeaderEntry {
  return {
    id: p.id,
    name: p.name,
    balance: p.balance,
    correct: p.correct,
    rank: p.rank,
    rankChange: p.rank !== null && p.prevRank !== null ? p.prevRank - p.rank : 0,
    late: p.joinedAtItem >= 0,
    status: p.status,
    eliminationOrder: p.eliminationOrder,
  };
}

/** Top `limit` rows, extended to include everyone tied with the last shown rank (so a tied third place is never cut). */
export function toLeaderEntries(ranked: PlayerRecord[], limit: number): LeaderEntry[] {
  let n = Math.min(limit, ranked.length);
  while (n < ranked.length && ranked[n].rank === ranked[n - 1].rank) n++;
  return ranked.slice(0, n).map(toLeaderEntry);
}
