// Shapes sent to browsers. Kept free of server imports so client components can use them.

import type { FraudCategory, HistoryEntry, LeaderEntry, Phase, PowerUpToken, RevealStats, Signal } from "./types";

export interface PublicRow {
  label: string;
  value: string;
}

export type PublicCase =
  | {
      kind: "loan";
      customer: string;
      profile: string;
      segment: string;
      purpose: string;
      amount: string;
      term: string;
      evidence: PublicRow[];
    }
  | {
      kind: "fraud";
      customer: string;
      headline: string;
      profile: PublicRow[];
      alert: PublicRow[];
    };

export interface RevealedCase {
  correct: "a" | "d";
  signals: Signal[];
  title: string;
  category: FraudCategory | "Credit risk";
  story: string;
  explanation: string;
  /** Loans: the return or loss on the stake if approved. */
  approvePct: number | null;
}

export interface ItemView {
  index: number;
  type: "decision" | "question";
  decisionNo?: number;
  mode?: "loan" | "fraud";
  questionNo?: number;
  reward?: "powerup" | "money";
  case?: PublicCase;
  revealed?: RevealedCase;
  question?: { topic: string; prompt: string; options: string[] };
  answer?: { answerIndex: number; explanation: string };
}

export interface EconomyView {
  startingBalance: number;
  loanStake: number;
  alternativeReturn: number;
  referenceLoanGain: number;
  referenceLoanLoss: number;
  fraudReward: number;
  fraudMissLoss: number;
  falseBlockLoss: number;
  finalQuestionBonus: number;
  speedTiers: { upToMs: number; bonus: number }[];
  decisionSeconds: number;
}

export interface SessionView {
  code: string;
  serverNow: number;
  seq: number;
  status: "lobby" | "running" | "paused" | "finished";
  phase: Phase;
  itemIndex: number;
  totalItems: number;
  totalDecisions: number;
  phaseEndsAt: number | null;
  /** Decision cases: when the case opened and when the 20-second window ends (scaled clock). */
  openedAt: number | null;
  deadlineAt: number | null;
  pausedRemainingMs: number | null;
  scale: number;
  item: ItemView | null;
  stats: RevealStats | null;
  leaderboard: LeaderEntry[] | null;
  playerCount: number;
  economy: EconomyView;
}

export interface MeView {
  id: string;
  name: string;
  balance: number;
  correct: number;
  rank: number | null;
  late: boolean;
  inventory: PowerUpToken[];
  /** The player's answer to the current open item, if any. */
  submitted: "a" | "d" | number | null;
  /** Outcome for the current item once revealed. */
  result: (HistoryEntry & { label: string; roi: number | null }) | null;
  /** Full history, sent only at the end. */
  history: (HistoryEntry & { title: string; kind: string })[] | null;
}

export interface PlayerView extends SessionView {
  me: MeView;
}

export interface HostPlayerRow {
  id: string;
  name: string;
  balance: number;
  correct: number;
  rank: number | null;
  late: boolean;
  active: boolean;
  powerUps: number;
}

export interface HostView extends SessionView {
  activeCount: number;
  submitted: number;
  players: HostPlayerRow[];
  storeKind: string;
}

export interface ScreenView extends SessionView {
  activeCount: number;
  submitted: number;
  /** Lobby only: names as they join. */
  names: string[] | null;
}
