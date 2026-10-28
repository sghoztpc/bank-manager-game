import { NETWORK } from "../config";
import { applyBalanceChange } from "../engine/elimination";
import { grantPowerUp, useBoost } from "../engine/powerups";
import { getQuizQuestion } from "../engine/quiz";
import { eliminatedPlayers, rankPlayers, toLeaderEntries, toLeaderEntry } from "../engine/ranking";
import { getCase } from "../engine/schedule";
import { resolveDecision, resolveQuestion, type Choice } from "../engine/scoring";
import type { EliminationRecord, LeaderEntry, PlayerRecord, RevealStats, SessionMeta, Submission } from "../types";

// The only code that changes balances during play (host adjustments use the same balance rule
// in service.ts). It runs once per item, under the session lock, and is idempotent per player
// (lastResolved), so a retry after a crash cannot double-count.

export const LEADERBOARD_SIZE = 10;

/**
 * Response time on the unscaled clock: from when the case reached this player's phone
 * (capped at maxViewLagMs after opening) to when the server received the decision.
 */
export function responseMs(sub: Submission, viewOffsetMs: number | undefined, scale: number): number {
  const lag = Math.min(Math.max(viewOffsetMs ?? 0, 0), NETWORK.maxViewLagMs * scale);
  return Math.max(0, sub.elapsedMs - lag) / scale;
}

export interface Standings {
  leaderboard: LeaderEntry[];
  eliminatedBoard: LeaderEntry[];
  rankedCount: number;
}

/** Re-ranks everyone; called after every money-changing event. */
export function standings(players: PlayerRecord[]): Standings {
  const ranked = rankPlayers(players);
  return {
    leaderboard: toLeaderEntries(ranked, LEADERBOARD_SIZE),
    eliminatedBoard: eliminatedPlayers(players).map(toLeaderEntry),
    rankedCount: ranked.length,
  };
}

export interface Resolution extends Standings {
  players: PlayerRecord[];
  stats: RevealStats;
  /** Eliminations committed by this item, in order. */
  newEliminations: EliminationRecord[];
}

export function resolveItem(
  meta: SessionMeta,
  itemIndex: number,
  players: PlayerRecord[],
  subs: Record<string, Submission>,
  views: Record<string, number>,
  /** When the window closed (the deadline, or earlier if it closed early); timeouts are ordered here, after submissions. */
  deadlineAt: number,
  eliminations: EliminationRecord[],
): Resolution {
  const item = meta.schedule[itemIndex];
  const stats: RevealStats = { itemIndex, approve: 0, decline: 0, timeout: 0, correct: 0, eliminated: 0 };
  const before = eliminations.length;
  const eligible = players.filter((p) => !p.kicked && p.status === "active" && p.joinedAtItem <= itemIndex && p.lastResolved < itemIndex);

  if (item.type === "decision") {
    const c = getCase(item.caseId);
    const results = eligible.map((p) => {
      const sub = subs[p.id];
      const choice = sub && (sub.choice === "a" || sub.choice === "d") ? (sub.choice as Choice) : null;
      const ms = sub && choice ? responseMs(sub, views[p.id], meta.scale) : null;
      return { p, choice, ms, at: sub && choice ? sub.receivedAt : deadlineAt, r: resolveDecision(c, choice, ms) };
    });
    // One authoritative order: when the server received each decision (timeouts at the
    // deadline), then join order. If several players hit zero at once, earlier events take
    // the remaining elimination slots and later ones get the safety floor.
    results.sort((a, b) => a.at - b.at || Number(a.choice === null) - Number(b.choice === null) || a.p.joinedAt - b.p.joinedAt);
    for (const { p, choice, ms, at, r } of results) {
      // A waiting power-up token adds 10% to what a correct decision earns.
      const boost = r.ok ? useBoost(p, r.delta, itemIndex) : 0;
      const change = r.delta + boost;
      const b = applyBalanceChange(p, change, { cause: `Case ${item.decisionNo} · ${r.label}`, itemIndex, at }, eliminations);
      if (r.ok) {
        p.correct += 1;
        p.correctMs += Math.round(ms ?? 0);
        stats.correct += 1;
      }
      if (r.timedOut) stats.timeout += 1;
      else if (r.applied === "a") stats.approve += 1;
      else stats.decline += 1;
      p.history.push({
        kind: "decision",
        i: itemIndex,
        c: choice,
        delta: b.applied,
        raw: change,
        speedBonus: r.speedBonus,
        boost: boost || undefined,
        ok: r.ok,
        ms: ms === null ? null : Math.round(ms),
        note: b.outcome === "applied" ? undefined : b.outcome,
        at,
      });
      p.lastResolved = itemIndex;
    }
  } else {
    stats.wrong = 0;
    const ordered = eligible.slice().sort((a, b) => (subs[a.id]?.receivedAt ?? deadlineAt) - (subs[b.id]?.receivedAt ?? deadlineAt) || a.joinedAt - b.joinedAt);
    for (const p of ordered) {
      const assignment = p.quiz[item.questionNo - 1];
      const q = getQuizQuestion(assignment.questionId);
      const sub = subs[p.id];
      const answer = sub && typeof sub.choice === "number" ? sub.choice : null;
      const r = resolveQuestion(q, answer, item.reward, p.balance);
      if (answer === null) stats.timeout += 1;
      else if (r.ok) stats.correct += 1;
      else stats.wrong += 1;
      const at = sub?.receivedAt ?? deadlineAt;
      const b = applyBalanceChange(p, r.delta, { cause: `Quiz ${item.questionNo} · wrong answer`, itemIndex, at }, eliminations);
      if (r.grantsPowerUp) grantPowerUp(p, `Q${item.questionNo}`, itemIndex);
      p.history.push({ kind: "quiz", i: itemIndex, c: answer, delta: b.applied, raw: r.delta, speedBonus: 0, ok: r.ok, ms: null, at });
      p.lastResolved = itemIndex;
    }
  }

  const newEliminations = eliminations.slice(before);
  stats.eliminated = newEliminations.length;
  return { players, stats, newEliminations, ...standings(players) };
}
