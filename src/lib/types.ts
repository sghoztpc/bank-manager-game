// ---------- Content ----------

export type Signal = "good" | "bad" | "neutral";

export interface EvidenceRow {
  label: string;
  value: string;
  /** Revealed only after the case closes, to highlight what mattered. */
  signal: Signal;
}

export interface LoanCase {
  id: string;
  kind: "loan";
  customer: string;
  profile: string;
  segment: "Personal" | "Small business";
  purpose: string;
  amount: string;
  term: string;
  evidence: EvidenceRow[];
  outcome: {
    result: "repaid" | "default";
    /** Repaid: fictional return on the stake. Default: loss on the stake after recovery. */
    pct: number;
    story: string;
  };
  explanation: string;
}

export type FraudCategory = "Payment fraud screening" | "Scam / social engineering" | "Cybersecurity incident";

export interface FraudCase {
  id: string;
  kind: "fraud";
  category: FraudCategory;
  title: string;
  customer: string;
  /** Normal activity on file. */
  profile: EvidenceRow[];
  /** The alert itself. */
  alert: EvidenceRow[];
  headline: string;
  truth: "fraud" | "legit";
  story: string;
  explanation: string;
}

export type DecisionCase = LoanCase | FraudCase;

export type QuizCategory = "warm-up" | "tricky" | "hardcore" | "core";

export interface QuizQuestion {
  id: string;
  category: QuizCategory;
  topic: string;
  prompt: string;
  /** Source order; an option's id is its index here, whatever order a player sees. */
  options: [string, string, string, string];
  answerIndex: number;
  /** The answer line as supplied in the source document, shown at the reveal. */
  suppliedAnswer: string;
  /** Why the item is held back, and the proposed correction. */
  review: string | null;
  playable: boolean;
}

/** One player's question for one quiz slot, fixed at join and never rerolled. */
export interface QuizAssignment {
  questionId: string;
  /** Option ids (source indexes) in the order this player sees them. */
  order: number[];
}

// ---------- Schedule ----------

export type ScheduleItem =
  | { type: "decision"; decisionNo: number; mode: "loan" | "fraud"; caseId: string }
  | { type: "question"; questionNo: number; afterDecision: number; reward: "powerup" | "money" };

// ---------- Session state ----------

export type Phase =
  | "lobby"
  | "intro"
  | "ready" // decision case announced, content not yet released
  | "open" // decision window
  | "reveal" // decision outcome
  | "question" // bonus question window
  | "qreveal" // bonus answer + leaderboard break
  | "final";

export interface RevealStats {
  itemIndex: number;
  /** "approve" covers Approve/Allow, "decline" covers Decline/Block. */
  approve: number;
  decline: number;
  timeout: number;
  correct: number;
  /** Quiz items: answered but wrong (each player has their own question). */
  wrong?: number;
  /** Players eliminated by this item. */
  eliminated?: number;
}

export interface LeaderEntry {
  id: string;
  name: string;
  balance: number;
  correct: number;
  /** Shared competitive rank among active players; null for eliminated players. */
  rank: number | null;
  /** Positive = moved up since the previous update. */
  rankChange: number;
  late: boolean;
  status: PlayerStatus;
  eliminationOrder: number | null;
}

export type PlayerStatus = "active" | "eliminated";

export interface EliminationRecord {
  order: number;
  playerId: string;
  name: string;
  /** What triggered it, e.g. "Case 7 · loan defaulted" or "Host deduction: ...". */
  cause: string;
  itemIndex: number | null;
  before: number;
  /** The change as computed, before the balance was set to 0. */
  change: number;
  at: number;
}

export interface AdjustmentRecord {
  /** Idempotency key chosen by the host's form; a repeated submission is not applied again. */
  id: string;
  playerId: string;
  name: string;
  amount: number;
  op: "add" | "subtract";
  reason: string;
  actor: string;
  before: number;
  after: number;
  outcome: "applied" | "eliminated" | "floored";
  at: number;
}

export interface Announcement {
  id: string;
  kind: "elimination" | "floor";
  text: string;
  /** Set when the projector may show it: never while a case or quiz is open. */
  showFrom: number | null;
}

export interface SessionMeta {
  code: string;
  seq: number;
  createdAt: number;
  hostTokenHash: string;
  seed: number;
  /** Game-clock multiplier fixed at creation (1 in real classes). */
  scale: number;
  schedule: ScheduleItem[];
  status: "lobby" | "running" | "paused" | "finished";
  phase: Phase;
  itemIndex: number;
  phaseStartedAt: number;
  /** Null while waiting on the host (lobby, final). */
  phaseEndsAt: number | null;
  /** Decision items: when the case content was released to players. */
  openedAt: number | null;
  /** Paused: milliseconds that were left in the phase. */
  pausedRemainingMs: number | null;
  pausedAt: number | null;
  lastReveal: RevealStats | null;
  /** Top of the active table, refreshed on every money-changing event. */
  leaderboard: LeaderEntry[];
  /** Every eliminated player, in elimination order. */
  eliminatedBoard: LeaderEntry[];
  /** Active players ranked at the last update ("rank 5 of 47"). */
  rankedCount: number;
  /** Authoritative elimination order; the quota and the safety floor derive from it. */
  eliminations: EliminationRecord[];
  adjustments: AdjustmentRecord[];
  announcements: Announcement[];
  settings: {
    /** Show elimination announcements on the projector. */
    announceEliminations: boolean;
    announceDismissedAt: number | null;
    /** Host toggle: keep the leaderboard on the projector. */
    boardOnScreen: boolean;
  };
  /** Host-only tutorial demonstration (Brief 3), lobby only; never touches competition state. */
  tutorial: {
    open: boolean;
    step: "inspect" | "decide" | "reveal";
    choice: "a" | "d" | null;
    /** Shown at least once this session: the intro screen can then be shorter. */
    shown: boolean;
  };
  /** Final phase: the host reveals the podium; afterwards results are frozen. */
  podiumRevealed: boolean;
  endedEarly: boolean;
}

export interface HistoryEntry {
  kind: "decision" | "quiz" | "adjust";
  /** Schedule index; -1 for host adjustments. */
  i: number;
  /** "a" approve/allow, "d" decline/block, null timed out; quizzes store the chosen option id. */
  c: "a" | "d" | number | null;
  /** The change actually applied to the balance (after elimination or the safety floor). */
  delta: number;
  /** The change as computed by the rules. Differs from delta only when the balance hit zero. */
  raw: number;
  speedBonus: number;
  ok: boolean;
  ms: number | null;
  /** "eliminated" or "floored" when the zero rule applied. */
  note?: "eliminated" | "floored";
  /** Decisions: the power-up boost included in delta. */
  boost?: number;
  /** Host adjustments: the recorded reason and record id. */
  reason?: string;
  ref?: string;
  at: number;
}

export interface PowerUpToken {
  tokenId: string;
  /** See src/lib/engine/powerups.ts. */
  kind: string;
  source: string;
  grantedAtItem: number;
  /** The decision it boosted; null while still waiting for the next correct decision. */
  usedAtItem: number | null;
}

export interface PlayerRecord {
  id: string;
  name: string;
  tokenHash: string;
  joinedAt: number;
  /** -1 for players who joined before the first case; otherwise the first schedule item they play. */
  joinedAtItem: number;
  kicked: boolean;
  status: PlayerStatus;
  eliminationOrder: number | null;
  balance: number;
  correct: number;
  /** Sum of response times of correct submitted decisions (reported, not a tie-breaker). */
  correctMs: number;
  lastResolved: number;
  rank: number | null;
  prevRank: number | null;
  history: HistoryEntry[];
  inventory: PowerUpToken[];
  /** Five questions, one per quiz slot, drawn at join. */
  quiz: QuizAssignment[];
}

export interface Submission {
  choice: "a" | "d" | number;
  receivedAt: number;
  /** Game-clock ms between the case opening and the server receiving this (pauses excluded). */
  elapsedMs: number;
}
