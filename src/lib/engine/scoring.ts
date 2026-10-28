import {
  ALTERNATIVE_RETURN,
  ECONOMY,
  FALSE_BLOCK_LOSS,
  FINAL_QUESTION_BONUS,
  FRAUD_MISS_LOSS,
  FRAUD_REWARD,
  POWER_UP,
  SPEED_TIERS,
  vnd,
} from "../config";
import type { DecisionCase, QuizQuestion } from "../types";

export type Choice = "a" | "d";

export interface DecisionResult {
  /** What actually happened: a timeout is applied as "d" (decline / block). */
  applied: Choice;
  timedOut: boolean;
  /** The decision was right on the merits. Timeouts never count as correct. */
  ok: boolean;
  base: number;
  speedBonus: number;
  delta: number;
  /** Fictional return on the loan stake; null for fraud cases. */
  roi: number | null;
  label: string;
}

/** Relative bonus for an elapsed time in unscaled ms. Boundaries are inclusive. */
export function speedBonusRate(elapsedMs: number | null): number {
  if (elapsedMs === null) return 0;
  for (const tier of SPEED_TIERS) if (elapsedMs <= tier.upToMs) return tier.bonus;
  return 0;
}

export function correctChoice(c: DecisionCase): Choice {
  if (c.kind === "loan") return c.outcome.result === "repaid" ? "a" : "d";
  return c.truth === "legit" ? "a" : "d";
}

/**
 * @param choice null when the player did not submit before the deadline.
 * @param elapsedMs response time on the unscaled game clock, or null.
 */
export function resolveDecision(c: DecisionCase, choice: Choice | null, elapsedMs: number | null): DecisionResult {
  const timedOut = choice === null;
  const applied: Choice = choice ?? "d";
  const rightOnMerits = applied === correctChoice(c);
  const ok = rightOnMerits && !timedOut;

  let base: number;
  let label: string;
  if (c.kind === "loan") {
    const amount = vnd(ECONOMY.loanStake * c.outcome.pct);
    if (applied === "a") {
      base = c.outcome.result === "repaid" ? amount : -amount;
      label = c.outcome.result === "repaid" ? "Loan repaid" : "Loan defaulted";
    } else {
      base = ALTERNATIVE_RETURN;
      label = timedOut ? "Timed out: declined, stake placed in government bills" : "Declined: stake placed in government bills";
    }
  } else if (applied === "a") {
    base = c.truth === "legit" ? FRAUD_REWARD : -FRAUD_MISS_LOSS;
    label = c.truth === "legit" ? "Genuine payment cleared" : "Fraud got through";
  } else {
    base = c.truth === "fraud" ? FRAUD_REWARD : -FALSE_BLOCK_LOSS;
    const prefix = timedOut ? "Timed out: auto-blocked. " : "";
    label = prefix + (c.truth === "fraud" ? "Fraud stopped" : "Genuine customer blocked");
  }

  const speedBonus = ok && base > 0 ? vnd(base * speedBonusRate(elapsedMs)) : 0;
  const delta = base + speedBonus;
  return {
    applied,
    timedOut,
    ok,
    base,
    speedBonus,
    delta,
    roi: c.kind === "loan" ? delta / ECONOMY.loanStake : null,
    label,
  };
}

/**
 * `answer` is the chosen option id (its index in the source), not its on-screen position.
 * Quizzes 1-4 ("powerup"): correct grants a boost token; wrong or no answer loses 20% of the
 * balance. Quiz 5 ("money"): correct pays the final bonus; wrong costs nothing.
 */
export function resolveQuestion(q: QuizQuestion, answer: number | null, reward: "powerup" | "money", balance: number) {
  const ok = answer === q.answerIndex;
  let delta = 0;
  if (reward === "money" && ok) delta = FINAL_QUESTION_BONUS;
  // `|| 0` turns a zero penalty (a bank on the 1 VND floor) into 0 rather than -0.
  if (reward === "powerup" && !ok) delta = -vnd(balance * POWER_UP.wrongAnswerPenaltyPct) || 0;
  return { ok, delta, grantsPowerUp: ok && reward === "powerup" };
}
