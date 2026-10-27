import { describe, expect, it } from "vitest";
import { ECONOMY, FALSE_BLOCK_LOSS, FINAL_QUESTION_BONUS, FRAUD_MISS_LOSS, FRAUD_REWARD } from "@/lib/config";
import { FRAUD_CASES } from "@/lib/content/fraud";
import { LOANS } from "@/lib/content/loans";
import { QUESTIONS } from "@/lib/content/questions";
import { rankPlayers } from "@/lib/engine/ranking";
import { buildSchedule, drawCases, getCase, getQuestion } from "@/lib/engine/schedule";
import { resolveDecision, resolveQuestion, speedBonusRate } from "@/lib/engine/scoring";
import type { LoanCase, PlayerRecord } from "@/lib/types";

const good = LOANS.find((c) => c.outcome.result === "repaid")!;
const bad = LOANS.find((c) => c.outcome.result === "default")!;
const fraud = FRAUD_CASES.find((c) => c.truth === "fraud")!;
const legit = FRAUD_CASES.find((c) => c.truth === "legit")!;

describe("schedule", () => {
  const s = buildSchedule(42);

  it("has 24 decisions and 5 questions, 29 interactions", () => {
    expect(s).toHaveLength(29);
    expect(s.filter((i) => i.type === "decision")).toHaveLength(24);
    expect(s.filter((i) => i.type === "question")).toHaveLength(5);
  });

  it("puts fraud cases at decisions 4, 8, 12, 16, 20 and 24", () => {
    const fraudNos = s.flatMap((i) => (i.type === "decision" && i.mode === "fraud" ? [i.decisionNo] : []));
    expect(fraudNos).toEqual([4, 8, 12, 16, 20, 24]);
    for (const i of s) if (i.type === "decision") expect(getCase(i.caseId).kind).toBe(i.mode);
  });

  it("asks questions right after decisions 5, 10, 15, 20, 24, with money only for the last", () => {
    const qs = s.flatMap((item, idx) => (item.type === "question" ? [{ idx, ...item }] : []));
    expect(qs.map((q) => q.afterDecision)).toEqual([5, 10, 15, 20, 24]);
    expect(qs.map((q) => q.reward)).toEqual(["powerup", "powerup", "powerup", "powerup", "money"]);
    for (const q of qs) {
      const prev = s[q.idx - 1];
      expect(prev.type === "decision" && prev.decisionNo).toBe(q.afterDecision);
    }
    // Collisions: decision 20 (fraud) resolves, then question 4; decision 24 (fraud), then question 5 ends the game.
    expect(s[s.length - 1]).toMatchObject({ type: "question", questionNo: 5, reward: "money" });
    expect(s[s.length - 2]).toMatchObject({ type: "decision", decisionNo: 24, mode: "fraud" });
  });

  it("draws the same cases for the same seed, with a fixed mix and no repeats", () => {
    expect(drawCases(7)).toEqual(drawCases(7));
    expect(drawCases(7)).not.toEqual(drawCases(8));
    for (const seed of [1, 2, 3, 99, 12345]) {
      const d = drawCases(seed);
      expect(new Set(d.loans).size).toBe(18);
      expect(new Set(d.fraud).size).toBe(6);
      const loans = d.loans.map((id) => getCase(id) as LoanCase);
      expect(loans.filter((c) => c.outcome.result === "repaid")).toHaveLength(11);
      expect(d.fraud.filter((id) => FRAUD_CASES.find((c) => c.id === id)!.truth === "fraud")).toHaveLength(3);
    }
  });

  it("has well-formed content", () => {
    const ids = [...LOANS, ...FRAUD_CASES].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const q of QUESTIONS) expect(q.answerIndex).toBeLessThan(q.options.length);
    for (const c of LOANS) {
      expect(c.outcome.pct).toBeGreaterThanOrEqual(0.18);
      expect(c.outcome.pct).toBeLessThanOrEqual(0.35);
    }
    // Every genuine fraud-desk case has at least one alarming signal.
    for (const c of FRAUD_CASES.filter((c) => c.truth === "legit")) {
      expect([...c.profile, ...c.alert].some((r) => r.signal === "bad")).toBe(true);
    }
  });
});

describe("speed bonus", () => {
  it("uses inclusive tier boundaries and nothing after 15 seconds", () => {
    expect(speedBonusRate(0)).toBe(0.05);
    expect(speedBonusRate(5000)).toBe(0.05);
    expect(speedBonusRate(5001)).toBe(0.04);
    expect(speedBonusRate(10000)).toBe(0.04);
    expect(speedBonusRate(10001)).toBe(0.03);
    expect(speedBonusRate(15000)).toBe(0.03);
    expect(speedBonusRate(15001)).toBe(0);
    expect(speedBonusRate(20000)).toBe(0);
    expect(speedBonusRate(null)).toBe(0);
  });

  it("multiplies positive earnings of correct decisions only", () => {
    const base = Math.round(ECONOMY.loanStake * good.outcome.pct);
    expect(resolveDecision(good, "a", 3000)).toMatchObject({ ok: true, base, speedBonus: Math.round(base * 0.05) });
    expect(resolveDecision(good, "a", 17000)).toMatchObject({ ok: true, speedBonus: 0, delta: base });
    // Wrong decisions never earn a bonus, even when fast and even when the outcome is positive.
    expect(resolveDecision(good, "d", 1000)).toMatchObject({ ok: false, speedBonus: 0, delta: 60 });
    expect(resolveDecision(bad, "a", 1000).speedBonus).toBe(0);
    expect(resolveDecision(fraud, "d", 4000)).toMatchObject({ ok: true, base: FRAUD_REWARD, speedBonus: 6 });
  });
});

describe("outcomes", () => {
  it("approving loans pays the case return or loss on the stake", () => {
    expect(resolveDecision(good, "a", null).delta).toBe(Math.round(2000 * good.outcome.pct));
    expect(resolveDecision(bad, "a", null).delta).toBe(-Math.round(2000 * bad.outcome.pct));
  });

  it("declining earns the alternative investment return either way", () => {
    expect(resolveDecision(good, "d", null).delta).toBe(60);
    expect(resolveDecision(bad, "d", 2000)).toMatchObject({ ok: true, delta: 63 });
  });

  it("fraud weights: reward 30% of a successful loan, losses scaled separately", () => {
    expect(FRAUD_REWARD).toBe(120);
    expect(resolveDecision(fraud, "a", 1000).delta).toBe(-FRAUD_MISS_LOSS);
    expect(resolveDecision(legit, "d", 1000).delta).toBe(-FALSE_BLOCK_LOSS);
    expect(resolveDecision(legit, "a", 16000)).toMatchObject({ ok: true, delta: FRAUD_REWARD });
  });

  it("a timeout is a decline or block, never correct and never a bonus", () => {
    expect(resolveDecision(bad, null, null)).toMatchObject({ applied: "d", timedOut: true, ok: false, delta: 60 });
    expect(resolveDecision(good, null, null)).toMatchObject({ applied: "d", ok: false, delta: 60 });
    expect(resolveDecision(legit, null, null)).toMatchObject({ applied: "d", ok: false, delta: -FALSE_BLOCK_LOSS });
    expect(resolveDecision(fraud, null, null)).toMatchObject({ applied: "d", ok: false, speedBonus: 0 });
  });

  it("final question pays 2% of the starting balance and no power-up", () => {
    const q = getQuestion("Q5");
    expect(resolveQuestion(q, q.answerIndex, "money")).toEqual({ ok: true, delta: FINAL_QUESTION_BONUS, grantsPowerUp: false });
    expect(FINAL_QUESTION_BONUS).toBe(200);
    expect(resolveQuestion(q, (q.answerIndex + 1) % 4, "money")).toEqual({ ok: false, delta: 0, grantsPowerUp: false });
    const q1 = getQuestion("Q1");
    expect(resolveQuestion(q1, q1.answerIndex, "powerup")).toEqual({ ok: true, delta: 0, grantsPowerUp: true });
  });

  it("no strategy can deplete the starting balance", () => {
    const worstLoans = LOANS.filter((c) => c.outcome.result === "default")
      .map((c) => Math.round(2000 * c.outcome.pct))
      .sort((a, b) => b - a)
      .slice(0, 7)
      .reduce((a, b) => a + b, 0);
    expect(ECONOMY.startingBalance - worstLoans - 3 * FRAUD_MISS_LOSS - 3 * FALSE_BLOCK_LOSS).toBeGreaterThan(0);
  });
});

describe("ranking", () => {
  const p = (id: string, balance: number, correct: number, correctMs: number, joinedAt: number): PlayerRecord => ({
    id,
    name: id,
    tokenHash: "",
    joinedAt,
    joinedAtItem: -1,
    kicked: false,
    balance,
    correct,
    correctMs,
    lastResolved: -1,
    rank: null,
    history: [],
    inventory: [],
  });

  it("orders by money, then correct decisions, then time on correct decisions", () => {
    const ranked = rankPlayers([p("a", 100, 5, 900, 1), p("b", 200, 1, 1, 2), p("c", 100, 6, 9999, 3), p("d", 100, 5, 100, 4)]);
    expect(ranked.map((x) => [x.id, x.rank])).toEqual([
      ["b", 1],
      ["c", 2],
      ["d", 3],
      ["a", 4],
    ]);
  });

  it("shares a rank only on a full tie", () => {
    const ranked = rankPlayers([p("a", 100, 5, 100, 2), p("b", 100, 5, 100, 1), p("c", 50, 0, 0, 0)]);
    expect(ranked.map((x) => [x.id, x.rank])).toEqual([
      ["b", 1],
      ["a", 1],
      ["c", 3],
    ]);
  });
});
