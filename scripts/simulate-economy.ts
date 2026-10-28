// Strategy check for the balancing numbers in src/lib/config.ts.
// Runs every strategy over many session draws using the real case pool and scoring code.
//   npm run simulate

import { ECONOMY, ELIMINATION, FINAL_QUESTION_BONUS } from "../src/lib/config";
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

/** Totals ignore elimination (so strategies compare on equal terms); `bust` records whether the running balance ever reached zero. */
function run(s: Strategy, seed: number, salt = 0) {
  const rand = mulberry32(seed * 7919 + 1 + salt * 104729);
  let loans = 0;
  let fraud = 0;
  let bust = false;
  for (const item of buildSchedule(seed)) {
    if (item.type !== "decision") continue;
    const c = getCase(item.caseId);
    const choice = s.pick(correctChoice(c), rand, item.mode);
    const r = resolveDecision(c, choice, choice === null ? null : s.ms);
    if (item.mode === "loan") loans += r.delta;
    else fraud += r.delta;
    if (ECONOMY.startingBalance + loans + fraud <= 0) bust = true;
  }
  return { loans, fraud, bust };
}

const rows = STRATEGIES.map((s) => {
  let loans = 0;
  let fraud = 0;
  let busts = 0;
  for (let seed = 1; seed <= SEEDS; seed++) {
    const r = run(s, seed);
    loans += r.loans;
    fraud += r.fraud;
    if (r.bust) busts++;
  }
  return { name: s.name, loans: loans / SEEDS, fraud: fraud / SEEDS, bust: busts / SEEDS };
});

const vnd = (n: number) => `${n < 0 ? "−" : n > 0 ? "+" : ""}${Math.abs(Math.round(n / 1e6)).toLocaleString("vi-VN")}m`;
console.log(`Average result of 24 decisions over ${SEEDS} session draws, in million VND (start ${ECONOMY.startingBalance / 1e6}m VND).`);
console.log(`Quizzes excluded: the final one adds ${FINAL_QUESTION_BONUS / 1e6}m VND for a correct answer.\n`);
console.log("| Strategy | Loans | Fraud desk | Total | Reaches 0 VND |");
console.log("| --- | ---: | ---: | ---: | ---: |");
for (const r of rows) {
  console.log(`| ${r.name} | ${vnd(r.loans)} | ${vnd(r.fraud)} | ${vnd(r.loans + r.fraud)} | ${(r.bust * 100).toFixed(1)}% |`);
}

// A 47-player class of mixed skill: how many banks reach zero (only the first five are eliminated)?
const CLASS: [Strategy, number][] = [
  [STRATEGIES[0], 2], // approves everything
  [STRATEGIES[3], 5], // guesses
  [accuracy(0.6, 8000), 12],
  [accuracy(0.7, 8000), 15],
  [accuracy(0.8, 12000), 10],
  [accuracy(0.9, 12000), 3],
];
const counts: number[] = [];
for (let seed = 1; seed <= 1000; seed++) {
  let n = 0;
  let salt = 0;
  for (const [s, k] of CLASS) for (let i = 0; i < k; i++) if (run(s, seed, ++salt).bust) n++;
  counts.push(n);
}
counts.sort((a, b) => a - b);
const mean = counts.reduce((a, b) => a + b, 0) / counts.length;
const full = counts.filter((n) => n >= ELIMINATION.quota).length / counts.length;
console.log(`\nMixed class of 47 (2 approve-all, 5 guessers, 12/15/10/3 at 60/70/80/90% accuracy):`);
console.log(`banks reaching zero per session: mean ${mean.toFixed(1)}, median ${counts[500]}, 10th-90th percentile ${counts[100]}-${counts[900]}`);
console.log(`sessions where the quota of ${ELIMINATION.quota} fills (so the 1 VND floor starts): ${(full * 100).toFixed(0)}%`);
const perfect = rows.find((r) => r.name.startsWith("Perfect, fast"))!;
console.log(`\nFraud desk share of a perfect game: ${Math.round((perfect.fraud / (perfect.loans + perfect.fraud)) * 100)}%`);
