// Every balancing number lives here. docs/DESIGN.md explains where each one comes from;
// `npm run simulate` re-checks the strategy outcomes after any change.

/**
 * Money is VND: a fictional classroom bank balance, always whole numbers.
 *
 * The starting balance is the bank's own capital, deliberately smaller than one loan stake
 * (loans are funded mostly by deposits, so losses come out of a thin capital base). That makes
 * bankruptcy reachable for reckless lending, which the elimination rule needs, while careful
 * play is almost never at risk. See docs/DESIGN.md "Brief 2".
 *
 * Rounding: every amount is rounded to the nearest whole VND, halves away from zero.
 */
export const ECONOMY = {
  startingBalance: 300_000_000,
  /** Desk exposure on every loan file, whatever the customer's requested amount. */
  loanStake: 500_000_000,
  /** The "comparable successful regular case": an approved loan that is repaid. */
  referenceLoanReturnPct: 0.2,
  /** The comparable failed regular case: an approved loan that defaults (after recovery). */
  referenceLoanLossPct: 0.3,
  /** Declined loans: the stake goes into short-term government bills instead. */
  alternativeInvestmentPct: 0.03,
  /** Fraud reward = 30% of the reference successful loan gain. */
  fraudRewardWeight: 0.3,
  /** Missed fraud loss = 30% of the reference failed loan loss (scaled separately). */
  fraudMissWeight: 0.3,
  /** Blocking a genuine transaction costs half the fraud reward (complaint handling, goodwill). */
  falseBlockWeight: 0.5,
  /** Final question reward = 2% of the common starting balance (identical for every player). */
  finalQuestionWeight: 0.02,
} as const;

/** Nearest whole VND, halves away from zero. */
export function vnd(amount: number): number {
  return Math.sign(amount) * Math.round(Math.abs(amount));
}

export const REFERENCE_LOAN_GAIN = vnd(ECONOMY.loanStake * ECONOMY.referenceLoanReturnPct); // 100.000.000
export const REFERENCE_LOAN_LOSS = vnd(ECONOMY.loanStake * ECONOMY.referenceLoanLossPct); // 150.000.000
export const ALTERNATIVE_RETURN = vnd(ECONOMY.loanStake * ECONOMY.alternativeInvestmentPct); // 15.000.000
export const FRAUD_REWARD = vnd(REFERENCE_LOAN_GAIN * ECONOMY.fraudRewardWeight); // 30.000.000
export const FRAUD_MISS_LOSS = vnd(REFERENCE_LOAN_LOSS * ECONOMY.fraudMissWeight); // 45.000.000
export const FALSE_BLOCK_LOSS = vnd(FRAUD_REWARD * ECONOMY.falseBlockWeight); // 15.000.000
export const FINAL_QUESTION_BONUS = vnd(ECONOMY.startingBalance * ECONOMY.finalQuestionWeight); // 6.000.000

/** Brief 2: the first five players whose balance reaches zero are eliminated; then a 1 VND floor. */
export const ELIMINATION = { quota: 5, safetyFloor: 1 } as const;

/**
 * Quizzes 1-4. Correct: a power-up token that adds 10% to what the player's next correct case
 * decision earns (used automatically, one token per decision). Wrong or no answer: lose 20% of
 * the current balance. Quiz 5 stays money only.
 */
export const POWER_UP = { boostPct: 0.1, wrongAnswerPenaltyPct: 0.2 } as const;

/** Host balance adjustments: positive whole VND up to this amount. */
export const ADJUSTMENT_MAX = 10_000_000_000;

/**
 * Speed bonus: a relative multiplier on the positive earnings of a correct, submitted decision.
 * Measured in unscaled milliseconds; boundaries are inclusive (exactly 5000 ms earns 5%).
 */
export const SPEED_TIERS = [
  { upToMs: 5_000, bonus: 0.05 },
  { upToMs: 10_000, bonus: 0.04 },
  { upToMs: 15_000, bonus: 0.03 },
] as const;

/** Session draw: how many cases of each kind every session uses. */
export const DRAW = {
  goodLoans: 11,
  badLoans: 7,
  fraudulent: 3,
  legitimate: 3,
} as const;

export const CAPACITY = { maxPlayers: 100 } as const;

// Worst case (every window runs to its limit): 24 x (2 + 20 + 6) + 5 x (25 + 7) + 20 = 852 s, about 14.2 min.
// Cases close early when every connected player has answered; the host can skip any reveal.
const BASE_TIMING = {
  introMs: 20_000,
  /** The rules screen is shorter when the host has already run the tutorial. */
  introAfterTutorialMs: 10_000,
  readyMs: 2_000,
  decisionMs: 20_000,
  revealMs: 6_000,
  /** Quiz options are long (about 100 characters each), so the quiz gets its own, longer limit. */
  questionMs: 25_000,
  questionRevealMs: 7_000,
};

/** Fixed real-time allowances that are not part of the game clock and never scale. */
export const NETWORK = {
  /** A submission that reaches the server this soon after the deadline still counts (no bonus). */
  latencyGraceMs: 400,
  /** How late a phone may first load an open case and still have its own clock start then. */
  maxViewLagMs: 2_000,
  /** A player who has not polled for this long no longer holds up an early close. */
  activeWindowMs: 10_000,
} as const;

/**
 * Lobby only: a phone counts as connected for the Ready check if it checked in within this window.
 * Longer than in play, because phones lock their screens while the host explains the tutorial.
 */
export const LOBBY_CONNECTED_WINDOW_MS = 60_000;

/** On Continue, a decision or quiz window that was nearly over gets at least this much time back. */
export const MIN_RESUME_MS = 3_000;

/** Rehearsals and tests can run the whole session faster; production uses 1. */
export function timeScale(): number {
  const raw = Number(process.env.GAME_TIME_SCALE ?? "1");
  return Number.isFinite(raw) && raw > 0 && raw <= 1 ? raw : 1;
}

export type Timing = typeof BASE_TIMING;

export function timing(scale = timeScale()): Timing {
  const out = {} as Timing;
  for (const key of Object.keys(BASE_TIMING) as (keyof Timing)[]) {
    out[key] = Math.round(BASE_TIMING[key] * scale);
  }
  return out;
}

export const SESSION_TTL_SECONDS = 6 * 60 * 60;
