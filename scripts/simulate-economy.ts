// Strategy check for the balancing numbers in src/lib/config.ts.
// Runs every strategy over many session draws using the real case pool and scoring code.
//   npm run simulate

import { ECONOMY, FINAL_QUESTION_BONUS } from "../src/lib/config";
import { buildSchedule, getCase } from "../src/lib/engine/schedule";
import { correctChoice, resolveDecision, type Choice } from "../src/lib/engine/scoring";
import { mulberry32 } from "../src/lib/engine/schedule";

type Strategy = { name: string; pick: (right: Choice, rand: () => number, mode: "loan" | "fraud") => Choice | null; ms: number };

const accuracy = (p: number, ms: number): Strategy => ({
  name: `${Math.round(p * 100)}% accurate, ${ms / 1000}s`,
  pick: (right, rand) => (rand() < p ? right : right === "a" ? "d" : "a"),
  ms,
});

const STRATEGIES: Strategy[] = [
  { name: "Approve / allow everything (fast)", pick: () => "a", ms: 2000 },
  { name: "Decline / block everything (fast)", pick: () => "d", ms: 2000 },
  { name: "Never answer (all timeouts)", pick: () => null, ms: 0 },
  { name: "Coin flip (fast)", pick: (_r, rand) => (rand() < 0.5 ? "a" : "d"), ms: 2000 },
  accuracy(0.6, 8000),
  accuracy(0.7, 8000),
  accuracy(0.8, 12000),
  accuracy(0.9, 12000),
  { name: "Perfect, slow (16s)", pick: (r) => r, ms: 16000 },
  { name: "Perfect, fast (4s)", pick: (r) => r, ms: 4000 },
];

const SEEDS = 2000;

function run(s: Strategy, seed: number) {
  const rand = mulberry32(seed * 7919 + 1);
  let loans = 0;
  let fraud = 0;
  for (const item of buildSchedule(seed)) {
    if (item.type !== "decision") continue;
    const c = getCase(item.caseId);
    const choice = s.pick(correctChoice(c), rand, item.mode);
    const r = resolveDecision(c, choice, choice === null ? null : s.ms);
    if (item.mode === "loan") loans += r.delta;
    else fraud += r.delta;
  }
  return { loans, fraud };
}

const rows = STRATEGIES.map((s) => {
  let loans = 0;
  let fraud = 0;
  let min = Infinity;
  let max = -Infinity;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = run(s, seed);
    loans += r.loans;
    fraud += r.fraud;
    min = Math.min(min, r.loans + r.fraud);
    max = Math.max(max, r.loans + r.fraud);
  }
  return { name: s.name, loans: loans / SEEDS, fraud: fraud / SEEDS, min, max };
});

const fmt = (n: number) => (n >= 0 ? "+" : "") + Math.round(n).toLocaleString("en-US");
console.log(`Average result of 24 decisions over ${SEEDS} session draws (start ${ECONOMY.startingBalance.toLocaleString("en-US")} Cr).`);
console.log(`Bonus questions excluded: the final one adds ${FINAL_QUESTION_BONUS} Cr for a correct answer.\n`);
console.log("| Strategy | Loans | Fraud desk | Total | Range |");
console.log("| --- | ---: | ---: | ---: | ---: |");
for (const r of rows) {
  console.log(`| ${r.name} | ${fmt(r.loans)} | ${fmt(r.fraud)} | ${fmt(r.loans + r.fraud)} | ${fmt(r.min)} to ${fmt(r.max)} |`);
}
const perfect = rows.find((r) => r.name.startsWith("Perfect, fast"))!;
console.log(`\nFraud desk share of a perfect game: ${Math.round((perfect.fraud / (perfect.loans + perfect.fraud)) * 100)}%`);
