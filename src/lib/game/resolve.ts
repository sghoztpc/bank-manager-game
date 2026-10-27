import { NETWORK } from "../config";
import { grantPowerUp } from "../engine/powerups";
import { rankPlayers, toLeaderEntries } from "../engine/ranking";
import { getCase, getQuestion } from "../engine/schedule";
import { resolveDecision, resolveQuestion, type Choice } from "../engine/scoring";
import type { LeaderEntry, PlayerRecord, RevealStats, SessionMeta, Submission } from "../types";

// The only code that changes balances. It runs once per item, under the session lock, and is
// idempotent per player (lastResolved), so a retry after a crash cannot double-count.

export const LEADERBOARD_SIZE = 10;

/**
 * Response time on the unscaled clock: from when the case reached this player's phone
 * (capped at maxViewLagMs after opening) to when the server received the decision.
 */
export function responseMs(sub: Submission, viewOffsetMs: number | undefined, scale: number): number {
  const lag = Math.min(Math.max(viewOffsetMs ?? 0, 0), NETWORK.maxViewLagMs * scale);
  return Math.max(0, sub.elapsedMs - lag) / scale;
}

export interface Resolution {
  players: PlayerRecord[];
  stats: RevealStats;
  leaderboard: LeaderEntry[];
  rankedCount: number;
}

export function resolveItem(
  meta: SessionMeta,
  itemIndex: number,
  players: PlayerRecord[],
  subs: Record<string, Submission>,
  views: Record<string, number>,
): Resolution {
  const item = meta.schedule[itemIndex];
  const stats: RevealStats = { itemIndex, approve: 0, decline: 0, timeout: 0, correct: 0 };

  if (item.type === "decision") {
    const c = getCase(item.caseId);
    for (const p of players) {
      if (p.kicked || p.joinedAtItem > itemIndex || p.lastResolved >= itemIndex) continue;
      const sub = subs[p.id];
      const choice = sub && (sub.choice === "a" || sub.choice === "d") ? (sub.choice as Choice) : null;
      const ms = sub && choice ? responseMs(sub, views[p.id], meta.scale) : null;
      const r = resolveDecision(c, choice, ms);
      p.balance += r.delta;
      if (r.ok) {
        p.correct += 1;
        p.correctMs += Math.round(ms ?? 0);
        stats.correct += 1;
      }
      if (r.timedOut) stats.timeout += 1;
      else if (r.applied === "a") stats.approve += 1;
      else stats.decline += 1;
      p.history.push({ i: itemIndex, c: choice, delta: r.delta, speedBonus: r.speedBonus, ok: r.ok, ms: ms === null ? null : Math.round(ms) });
      p.lastResolved = itemIndex;
    }
  } else {
    const q = getQuestion(item.questionId);
    stats.options = q.options.map(() => 0);
    for (const p of players) {
      if (p.kicked || p.joinedAtItem > itemIndex || p.lastResolved >= itemIndex) continue;
      const sub = subs[p.id];
      const answer = sub && typeof sub.choice === "number" ? sub.choice : null;
      const r = resolveQuestion(q, answer, item.reward);
      if (answer === null) stats.timeout += 1;
      else if (answer >= 0 && answer < q.options.length) stats.options[answer] += 1;
      if (r.ok) stats.correct += 1;
      p.balance += r.delta;
      if (r.grantsPowerUp) grantPowerUp(p, `Q${item.questionNo}`, itemIndex);
      p.history.push({ i: itemIndex, c: answer, delta: r.delta, speedBonus: 0, ok: r.ok, ms: null });
      p.lastResolved = itemIndex;
    }
  }

  const ranked = rankPlayers(players);
  return { players, stats, leaderboard: toLeaderEntries(ranked, LEADERBOARD_SIZE), rankedCount: ranked.length };
}
