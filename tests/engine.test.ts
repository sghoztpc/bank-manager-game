import { describe, expect, it } from "vitest";
import {
  ALTERNATIVE_RETURN,
  ECONOMY,
  ELIMINATION,
  FALSE_BLOCK_LOSS,
  FINAL_QUESTION_BONUS,
  FRAUD_MISS_LOSS,
  FRAUD_REWARD,
  REFERENCE_LOAN_GAIN,
} from "@/lib/config";
import { FRAUD_CASES } from "@/lib/content/fraud";
import { LOANS } from "@/lib/content/loans";
import { PLAYABLE_QUESTIONS, QUIZ_POOL, SLOT_CATEGORIES } from "@/lib/content/questions";
import { applyBalanceChange, floorActive, previewBalanceChange } from "@/lib/engine/elimination";
import { assignQuiz, getQuizQuestion } from "@/lib/engine/quiz";
import { eliminatedPlayers, rankPlayers, toLeaderEntries } from "@/lib/engine/ranking";
import { buildSchedule, drawCases, getCase } from "@/lib/engine/schedule";
import { resolveDecision, resolveQuestion, speedBonusRate } from "@/lib/engine/scoring";
import type { EliminationRecord, LoanCase, PlayerRecord } from "@/lib/types";

const good = LOANS.find((c) => c.outcome.result === "repaid")!;
const bad = LOANS.find((c) => c.outcome.result === "default")!;
const fraud = FRAUD_CASES.find((c) => c.truth === "fraud")!;
const legit = FRAUD_CASES.find((c) => c.truth === "legit")!;

function player(id: string, balance: number, extra: Partial<PlayerRecord> = {}): PlayerRecord {
  return {
    id,
    name: id,
    tokenHash: "",
    joinedAt: 0,
    joinedAtItem: -1,
    kicked: false,
    status: "active",
    eliminationOrder: null,
    balance,
    correct: 0,
    correctMs: 0,
    lastResolved: -1,
    rank: null,
    prevRank: null,
    history: [],
    inventory: [],
    quiz: [],
    ...extra,
  };
}

describe("schedule", () => {
  const s = buildSchedule(42);

  it("has 24 decisions and 5 quiz slots, 29 interactions", () => {
    expect(s).toHaveLength(29);
    expect(s.filter((i) => i.type === "decision")).toHaveLength(24);
    expect(s.filter((i) => i.type === "question")).toHaveLength(5);
  });

  it("puts fraud cases at decisions 4, 8, 12, 16, 20 and 24", () => {
    const fraudNos = s.flatMap((i) => (i.type === "decision" && i.mode === "fraud" ? [i.decisionNo] : []));
    expect(fraudNos).toEqual([4, 8, 12, 16, 20, 24]);
    for (const i of s) if (i.type === "decision") expect(getCase(i.caseId).kind).toBe(i.mode);
  });

  it("opens quizzes right after decisions 5, 10, 15, 20, 24, with money only for the last", () => {
    const qs = s.flatMap((item, idx) => (item.type === "question" ? [{ idx, ...item }] : []));
    expect(qs.map((q) => q.afterDecision)).toEqual([5, 10, 15, 20, 24]);
    expect(qs.map((q) => q.reward)).toEqual(["powerup", "powerup", "powerup", "powerup", "money"]);
    for (const q of qs) {
      const prev = s[q.idx - 1];
      expect(prev.type === "decision" && prev.decisionNo).toBe(q.afterDecision);
    }
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

  it("has well-formed case content in VND", () => {
    const ids = [...LOANS, ...FRAUD_CASES].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of LOANS) {
      expect(c.outcome.pct).toBeGreaterThanOrEqual(0.18);
      expect(c.outcome.pct).toBeLessThanOrEqual(0.35);
    }
    for (const c of FRAUD_CASES.filter((c) => c.truth === "legit")) {
      expect([...c.profile, ...c.alert].some((r) => r.signal === "bad")).toBe(true);
    }
    expect(JSON.stringify([LOANS, FRAUD_CASES])).not.toContain("₫");
  });
});

describe("quiz pool and assignment", () => {
  it("holds all 30 source questions with the supplied keys (23 B, 7 A)", () => {
    expect(QUIZ_POOL).toHaveLength(30);
    const keys = QUIZ_POOL.map((q) => "ABCD"[q.answerIndex]);
    expect(keys.filter((k) => k === "B")).toHaveLength(23);
    expect(keys.filter((k) => k === "A")).toHaveLength(7);
    expect(QUIZ_POOL.filter((q) => q.category === "warm-up")).toHaveLength(7);
    expect(QUIZ_POOL.filter((q) => q.category === "tricky")).toHaveLength(6);
    expect(QUIZ_POOL.filter((q) => q.category === "hardcore")).toHaveLength(7);
    expect(QUIZ_POOL.filter((q) => q.category === "core")).toHaveLength(10);
  });

  it("keeps the three questionable items (Q02, Q09, Q14) out of play, with a proposed correction", () => {
    const held = QUIZ_POOL.filter((q) => !q.playable);
    expect(held.map((q) => q.id)).toEqual(["Q02", "Q09", "Q14"]);
    for (const q of held) expect(q.review).toBeTruthy();
    expect(PLAYABLE_QUESTIONS).toHaveLength(27);
  });

  it("gives each player five distinct questions, one per slot from that slot's category", () => {
    for (let i = 0; i < 300; i++) {
      const a = assignQuiz(123, `player-${i}`);
      expect(a).toHaveLength(5);
      expect(new Set(a.map((x) => x.questionId)).size).toBe(5);
      a.forEach((x, slot) => {
        const q = getQuizQuestion(x.questionId);
        expect(q.playable).toBe(true);
        expect(q.category).toBe(SLOT_CATEGORIES[slot]);
        expect([...x.order].sort()).toEqual([0, 1, 2, 3]);
      });
    }
  });

  it("randomises independently per player but is stable for the same player", () => {
    expect(assignQuiz(9, "abc")).toEqual(assignQuiz(9, "abc"));
    const sets = new Set(Array.from({ length: 50 }, (_, i) => JSON.stringify(assignQuiz(9, `p${i}`).map((x) => x.questionId))));
    expect(sets.size).toBeGreaterThan(25);
  });

  it("shuffles options so the correct answer is not stuck in position B", () => {
    const positions = [0, 0, 0, 0];
    for (let i = 0; i < 2000; i++) {
      for (const x of assignQuiz(77, `p${i}`)) positions[x.order.indexOf(getQuizQuestion(x.questionId).answerIndex)] += 1;
    }
    for (const n of positions) expect(n / 10000).toBeGreaterThan(0.2);
  });

  it("grades by option id, not by on-screen position", () => {
    const q = getQuizQuestion("Q01");
    expect(resolveQuestion(q, q.answerIndex, "powerup")).toEqual({ ok: true, delta: 0, grantsPowerUp: true });
    expect(resolveQuestion(q, (q.answerIndex + 1) % 4, "powerup")).toEqual({ ok: false, delta: 0, grantsPowerUp: false });
    expect(resolveQuestion(q, q.answerIndex, "money")).toEqual({ ok: true, delta: FINAL_QUESTION_BONUS, grantsPowerUp: false });
    expect(resolveQuestion(q, null, "money")).toEqual({ ok: false, delta: 0, grantsPowerUp: false });
  });
});

describe("VND money model", () => {
  it("uses whole VND with the documented references", () => {
    expect(ECONOMY.startingBalance).toBe(300_000_000);
    expect(REFERENCE_LOAN_GAIN).toBe(100_000_000);
    expect(ALTERNATIVE_RETURN).toBe(15_000_000);
    expect(FRAUD_REWARD).toBe(30_000_000); // 30% of the reference successful loan gain
    expect(FRAUD_MISS_LOSS).toBe(45_000_000);
    expect(FALSE_BLOCK_LOSS).toBe(15_000_000);
    expect(FINAL_QUESTION_BONUS).toBe(6_000_000); // 2% of the common starting balance
    for (const c of [...LOANS, ...FRAUD_CASES]) {
      for (const choice of ["a", "d", null] as const) {
        for (const ms of [1000, 7000, 12000, 18000]) {
          const r = resolveDecision(c, choice, ms);
          expect(Number.isInteger(r.delta)).toBe(true);
          expect(Number.isInteger(r.speedBonus)).toBe(true);
        }
      }
    }
  });

  it("speed bonus tiers are inclusive and stop after 15 seconds", () => {
    expect(speedBonusRate(5000)).toBe(0.05);
    expect(speedBonusRate(5001)).toBe(0.04);
    expect(speedBonusRate(10000)).toBe(0.04);
    expect(speedBonusRate(15000)).toBe(0.03);
    expect(speedBonusRate(15001)).toBe(0);
    expect(speedBonusRate(20000)).toBe(0);
    const base = Math.round(ECONOMY.loanStake * good.outcome.pct);
    expect(resolveDecision(good, "a", 3000)).toMatchObject({ ok: true, base, speedBonus: Math.round(base * 0.05) });
    expect(resolveDecision(good, "a", 17000)).toMatchObject({ speedBonus: 0, delta: base });
    expect(resolveDecision(good, "d", 1000)).toMatchObject({ ok: false, speedBonus: 0 });
    expect(resolveDecision(fraud, "d", 4000)).toMatchObject({ ok: true, base: FRAUD_REWARD, speedBonus: 1_500_000 });
  });

  it("timeouts decline or block, are never correct, never earn a bonus", () => {
    expect(resolveDecision(bad, null, null)).toMatchObject({ applied: "d", ok: false, delta: ALTERNATIVE_RETURN });
    expect(resolveDecision(legit, null, null)).toMatchObject({ applied: "d", ok: false, delta: -FALSE_BLOCK_LOSS });
  });

  it("makes bankruptcy reachable: the worst possible game goes below zero", () => {
    const worst =
      LOANS.filter((c) => c.outcome.result === "default")
        .map((c) => Math.round(ECONOMY.loanStake * c.outcome.pct))
        .sort((a, b) => b - a)
        .slice(0, 7)
        .reduce((a, b) => a + b, 0) +
      3 * FRAUD_MISS_LOSS;
    expect(ECONOMY.startingBalance - worst).toBeLessThan(0);
    // ...and a single bad loan never does it on its own from the start.
    expect(ECONOMY.startingBalance - Math.max(...LOANS.map((c) => Math.round(ECONOMY.loanStake * c.outcome.pct)))).toBeGreaterThan(0);
  });
});

describe("elimination rule", () => {
  const ev = (cause = "test") => ({ cause, itemIndex: 3, at: 1 });

  it("applies positive results normally", () => {
    const p = player("a", 100);
    expect(applyBalanceChange(p, -40, ev(), [])).toMatchObject({ outcome: "applied", after: 60, applied: -40 });
    expect(p.status).toBe("active");
  });

  it("eliminates on exactly zero, and on losses that overshoot zero, showing 0", () => {
    const elims: EliminationRecord[] = [];
    const a = player("a", 100);
    const b = player("b", 100);
    expect(applyBalanceChange(a, -100, ev("exact"), elims)).toMatchObject({ outcome: "eliminated", after: 0 });
    expect(applyBalanceChange(b, -1_000_000, ev("overshoot"), elims)).toMatchObject({ outcome: "eliminated", after: 0, applied: -100 });
    expect([a.status, a.balance, a.eliminationOrder]).toEqual(["eliminated", 0, 1]);
    expect([b.status, b.balance, b.eliminationOrder]).toEqual(["eliminated", 0, 2]);
    expect(elims.map((e) => [e.order, e.playerId, e.change])).toEqual([
      [1, "a", -100],
      [2, "b", -1_000_000],
    ]);
  });

  it("eliminates exactly five distinct players, then holds everyone at the 1 VND floor", () => {
    const elims: EliminationRecord[] = [];
    const ps = Array.from({ length: 8 }, (_, i) => player(`p${i}`, 10));
    ps.forEach((p) => applyBalanceChange(p, -50, ev(), elims));
    expect(elims).toHaveLength(ELIMINATION.quota);
    expect(ps.filter((p) => p.status === "eliminated").map((p) => p.id)).toEqual(["p0", "p1", "p2", "p3", "p4"]);
    expect(ps.slice(5).map((p) => [p.status, p.balance])).toEqual([
      ["active", 1],
      ["active", 1],
      ["active", 1],
    ]);
    expect(floorActive(elims)).toBe(true);
    // A survivor keeps losing: still active at 1 VND, quota unchanged.
    for (let i = 0; i < 5; i++) applyBalanceChange(ps[7], -1_000_000, ev(), elims);
    expect([ps[7].status, ps[7].balance, elims.length]).toEqual(["active", 1, 5]);
    // And can climb back up.
    expect(applyBalanceChange(ps[7], 40, ev(), elims).after).toBe(41);
  });

  it("refuses to change an eliminated player, and the preview matches the result", () => {
    const elims: EliminationRecord[] = [];
    const p = player("a", 10);
    expect(previewBalanceChange(10, -10, elims)).toEqual({ outcome: "eliminated", after: 0, order: 1 });
    applyBalanceChange(p, -10, ev(), elims);
    expect(() => applyBalanceChange(p, 500, ev(), elims)).toThrow(/already eliminated/);
  });
});

describe("ranking", () => {
  it("ranks active players by balance, then correct decisions, sharing ranks on full ties", () => {
    const ps = [player("a", 100, { correct: 5 }), player("b", 200, { correct: 1 }), player("c", 100, { correct: 6 }), player("d", 100, { correct: 5, joinedAt: -1 })];
    const ranked = rankPlayers(ps);
    expect(ranked.map((x) => [x.id, x.rank])).toEqual([
      ["b", 1],
      ["c", 2],
      ["d", 3],
      ["a", 3],
    ]);
  });

  it("keeps eliminated players out of the ranking, listed by elimination order", () => {
    const ps = [player("a", 50), player("x", 0, { status: "eliminated", eliminationOrder: 2 }), player("y", 0, { status: "eliminated", eliminationOrder: 1 })];
    expect(rankPlayers(ps).map((p) => p.id)).toEqual(["a"]);
    expect(eliminatedPlayers(ps).map((p) => p.id)).toEqual(["y", "x"]);
    expect(ps[1].rank).toBeNull();
  });

  it("never cuts a tied place off the shown table", () => {
    const ps = Array.from({ length: 13 }, (_, i) => player(`p${i}`, i < 2 ? 100 : 50));
    const entries = toLeaderEntries(rankPlayers(ps), 10);
    expect(entries).toHaveLength(13);
    expect(entries.filter((e) => e.rank === 3)).toHaveLength(11);
  });

  it("reports rank changes between updates", () => {
    const a = player("a", 10);
    const b = player("b", 20);
    rankPlayers([a, b]);
    a.balance = 30;
    rankPlayers([a, b]);
    expect(toLeaderEntries([a, b], 10).map((e) => [e.id, e.rankChange])).toEqual([
      ["a", 1],
      ["b", -1],
    ]);
  });
});
