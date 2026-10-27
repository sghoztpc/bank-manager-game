// Every balancing number lives here. docs/DESIGN.md explains where each one comes from;
// `npm run simulate` re-checks the strategy outcomes after any change.

/** Game money is "credits" (Cr): fictional classroom points, not a banking forecast. */
export const ECONOMY = {
  startingBalance: 10_000,
  /** Desk capital committed by every loan file, whatever the customer's requested amount. */
  loanStake: 2_000,
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

export const REFERENCE_LOAN_GAIN = Math.round(ECONOMY.loanStake * ECONOMY.referenceLoanReturnPct); // 400
export const REFERENCE_LOAN_LOSS = Math.round(ECONOMY.loanStake * ECONOMY.referenceLoanLossPct); // 600
export const ALTERNATIVE_RETURN = Math.round(ECONOMY.loanStake * ECONOMY.alternativeInvestmentPct); // 60
export const FRAUD_REWARD = Math.round(REFERENCE_LOAN_GAIN * ECONOMY.fraudRewardWeight); // 120
export const FRAUD_MISS_LOSS = Math.round(REFERENCE_LOAN_LOSS * ECONOMY.fraudMissWeight); // 180
export const FALSE_BLOCK_LOSS = Math.round(FRAUD_REWARD * ECONOMY.falseBlockWeight); // 60
export const FINAL_QUESTION_BONUS = Math.round(ECONOMY.startingBalance * ECONOMY.finalQuestionWeight); // 200

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

// Worst case (every case runs its full 20 s): 24 x (2 + 20 + 6) + 5 x (15 + 7) + 20 = 802 s, about 13.4 min.
// Cases close early when every connected player has answered; the host can skip any reveal.
const BASE_TIMING = {
  introMs: 20_000,
  readyMs: 2_000,
  decisionMs: 20_000,
  revealMs: 6_000,
  questionMs: 15_000,
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
