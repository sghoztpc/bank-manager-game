// Shapes sent to browsers. Kept free of server imports so client components can use them.

import type { AdjustmentRecord, Announcement, EliminationRecord, FraudCategory, HistoryEntry, LeaderEntry, Phase, PowerUpToken, RevealStats, SessionMeta, Signal } from "./types";

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

export interface QuizOptionView {
  /** Stable option id (its index in the source); this is what the phone submits. */
  id: number;
  text: string;
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
  /** Player views only: this player's own question, options in their personal order. */
  question?: { id: string; topic: string; prompt: string; options: QuizOptionView[] };
  /** Player views only, once the quiz closes. */
  answer?: { id: number; text: string };
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
  quizSeconds: number;
  eliminationQuota: number;
  safetyFloor: number;
  powerUpBoostPct: number;
  wrongAnswerPenaltyPct: number;
}

/** Host tutorial (Brief 3): sent to the host and projector only, never to phones. */
export interface TutorialView {
  step: "inspect" | "decide" | "reveal";
  choice: "a" | "d" | null;
  case: PublicCase;
  /** Plain-language notes keyed by evidence label, plus "amount" and "stake". */
  notes: Record<string, string>;
  /** Reveal step: which rows mattered, the story and explanation. */
  revealed: RevealedCase | null;
  /** Both choices, computed by the live scoring rules, for the example bank. */
  outcomes: Record<"a" | "d", { label: string; change: number; roi: number; after: number }>;
  exampleBalance: number;
  stake: number;
}

export interface LobbyView {
  total: number;
  ready: number;
  notReady: number;
  connected: number;
  disconnected: number;
}

export interface QuotaView {
  used: number;
  total: number;
  floorActive: boolean;
}

export type EliminationView = Pick<EliminationRecord, "order" | "name" | "cause" | "change" | "before" | "at">;

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
  /** Active players, top of the table. Null when the viewer may not see it yet. */
  leaderboard: LeaderEntry[] | null;
  /** Eliminated players, in elimination order. */
  eliminatedBoard: LeaderEntry[] | null;
  /** Final podium (everyone ranked 1-3, ties included); only once the host reveals it. */
  podium: LeaderEntry[] | null;
  podiumRevealed: boolean;
  endedEarly: boolean;
  playerCount: number;
  quota: QuotaView;
  eliminations: EliminationView[];
  economy: EconomyView;
}

export interface MeView {
  id: string;
  name: string;
  balance: number;
  correct: number;
  /** Hidden in the final phase until the podium is revealed. */
  rank: number | null;
  rankChange: number;
  late: boolean;
  status: "active" | "eliminated";
  /** Lobby only: this player's Ready state; null once the game has started. */
  ready: boolean | null;
  elimination: EliminationView | null;
  inventory: PowerUpToken[];
  /** The player's answer to the current open item, if any. */
  submitted: "a" | "d" | number | null;
  /** Outcome for the current item once revealed. */
  result: (HistoryEntry & { label: string; roi: number | null }) | null;
  /** Recent host adjustments to this player, newest last. */
  adjustments: HistoryEntry[];
  /** Full history, sent only at the end. */
  history: (HistoryEntry & { title: string })[] | null;
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
  status: "active" | "eliminated";
  eliminationOrder: number | null;
  /** Lobby only; null once the game has started. */
  ready: boolean | null;
}

export interface HostView extends SessionView {
  activeCount: number;
  submitted: number;
  players: HostPlayerRow[];
  storeKind: string;
  adjustments: AdjustmentRecord[];
  settings: SessionMeta["settings"];
  /** Lobby only: Ready check summary. */
  lobby: LobbyView | null;
  tutorial: TutorialView | null;
  tutorialShown: boolean;
}

export interface ScreenView extends SessionView {
  activeCount: number;
  submitted: number;
  /** Lobby only: names as they join. */
  names: string[] | null;
  announcements: Announcement[];
  settings: SessionMeta["settings"];
  /** Lobby only: how many joined players have pressed Ready. */
  readyCount: number | null;
  tutorial: TutorialView | null;
}
