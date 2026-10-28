import { DRAW } from "../config";
import { FRAUD_CASES } from "../content/fraud";
import { LOANS } from "../content/loans";
import type { DecisionCase, ScheduleItem } from "../types";

export const DECISION_COUNT = 24;
export const FRAUD_EVERY = 4;
/** Decision number after which each bonus question appears; the last one awards money only. */
export const QUESTION_AFTER = [5, 10, 15, 20, 24] as const;

/** Deterministic PRNG so a session's draw can be reproduced from its seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Same shuffled set for every player in a session. The good/bad mix is fixed per session
 * (stratified draw) so sessions are comparable; only which cases and their order vary.
 */
export function drawCases(seed: number): { loans: string[]; fraud: string[] } {
  const rand = mulberry32(seed);
  const good = shuffle(LOANS.filter((c) => c.outcome.result === "repaid"), rand).slice(0, DRAW.goodLoans);
  const bad = shuffle(LOANS.filter((c) => c.outcome.result === "default"), rand).slice(0, DRAW.badLoans);
  const fraud = shuffle(FRAUD_CASES.filter((c) => c.truth === "fraud"), rand).slice(0, DRAW.fraudulent);
  const legit = shuffle(FRAUD_CASES.filter((c) => c.truth === "legit"), rand).slice(0, DRAW.legitimate);
  return {
    loans: shuffle([...good, ...bad], rand).map((c) => c.id),
    fraud: shuffle([...fraud, ...legit], rand).map((c) => c.id),
  };
}

/** 24 decisions (three loans then one fraud case, six times) with 5 bonus questions interleaved. */
export function buildSchedule(seed: number): ScheduleItem[] {
  const { loans, fraud } = drawCases(seed);
  const items: ScheduleItem[] = [];
  let loanIdx = 0;
  let fraudIdx = 0;
  for (let n = 1; n <= DECISION_COUNT; n++) {
    const isFraud = n % FRAUD_EVERY === 0;
    items.push({
      type: "decision",
      decisionNo: n,
      mode: isFraud ? "fraud" : "loan",
      caseId: isFraud ? fraud[fraudIdx++] : loans[loanIdx++],
    });
    const q = QUESTION_AFTER.indexOf(n as (typeof QUESTION_AFTER)[number]);
    if (q >= 0) {
      items.push({
        type: "question",
        questionNo: q + 1,
        afterDecision: n,
        reward: q === QUESTION_AFTER.length - 1 ? "money" : "powerup",
      });
    }
  }
  return items;
}

const CASES = new Map<string, DecisionCase>([...LOANS, ...FRAUD_CASES].map((c) => [c.id, c]));

export function getCase(id: string): DecisionCase {
  const c = CASES.get(id);
  if (!c) throw new Error(`Unknown case ${id}`);
  return c;
}
