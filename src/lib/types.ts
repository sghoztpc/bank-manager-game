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

export interface BonusQuestion {
  id: string;
  topic: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  explanation: string;
}

// ---------- Schedule ----------

export type ScheduleItem =
  | { type: "decision"; decisionNo: number; mode: "loan" | "fraud"; caseId: string }
  | { type: "question"; questionNo: number; afterDecision: number; reward: "powerup" | "money"; questionId: string };

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
  /** Bonus questions: count per option. */
  options?: number[];
}

export interface LeaderEntry {
  id: string;
  name: string;
  balance: number;
  correct: number;
  rank: number;
  late: boolean;
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
  /** Top of the table, refreshed whenever an item is resolved. */
  leaderboard: LeaderEntry[];
  /** Players ranked at the last resolution ("rank 5 of 47"). */
  rankedCount: number;
}

export interface HistoryEntry {
  /** Schedule index. */
  i: number;
  /** "a" approve/allow, "d" decline/block, null timed out; questions store the option index. */
  c: "a" | "d" | number | null;
  delta: number;
  speedBonus: number;
  ok: boolean;
  ms: number | null;
}

export interface PowerUpToken {
  tokenId: string;
  /** "unassigned" until a power-up catalogue is designed (see src/lib/engine/powerups.ts). */
  kind: string;
  source: string;
  grantedAtItem: number;
}

export interface PlayerRecord {
  id: string;
  name: string;
  tokenHash: string;
  joinedAt: number;
  /** -1 for players who joined before the first case; otherwise the first schedule item they play. */
  joinedAtItem: number;
  kicked: boolean;
  balance: number;
  correct: number;
  /** Sum of response times of correct submitted decisions; third tie-breaker. */
  correctMs: number;
  lastResolved: number;
  rank: number | null;
  history: HistoryEntry[];
  inventory: PowerUpToken[];
}

export interface Submission {
  choice: "a" | "d" | number;
  receivedAt: number;
  /** Game-clock ms between the case opening and the server receiving this (pauses excluded). */
  elapsedMs: number;
}
