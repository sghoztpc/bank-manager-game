import {
  ALTERNATIVE_RETURN,
  ECONOMY,
  FALSE_BLOCK_LOSS,
  FINAL_QUESTION_BONUS,
  FRAUD_MISS_LOSS,
  FRAUD_REWARD,
  REFERENCE_LOAN_GAIN,
  REFERENCE_LOAN_LOSS,
  SPEED_TIERS,
  timing,
} from "../config";
import { DECISION_COUNT, getCase, getQuestion } from "../engine/schedule";
import { correctChoice, resolveDecision } from "../engine/scoring";
import type { DecisionCase, PlayerRecord, SessionMeta, Submission } from "../types";
import type {
  EconomyView,
  HostView,
  ItemView,
  MeView,
  PlayerView,
  PublicCase,
  RevealedCase,
  ScreenView,
  SessionView,
} from "../view-types";

// Answers, signals and outcomes are only included once an item has been resolved
// (or for the host, who needs them to run the debrief).

const ECONOMY_VIEW: EconomyView = {
  startingBalance: ECONOMY.startingBalance,
  loanStake: ECONOMY.loanStake,
  alternativeReturn: ALTERNATIVE_RETURN,
  referenceLoanGain: REFERENCE_LOAN_GAIN,
  referenceLoanLoss: REFERENCE_LOAN_LOSS,
  fraudReward: FRAUD_REWARD,
  fraudMissLoss: FRAUD_MISS_LOSS,
  falseBlockLoss: FALSE_BLOCK_LOSS,
  finalQuestionBonus: FINAL_QUESTION_BONUS,
  speedTiers: SPEED_TIERS.map((t) => ({ ...t })),
  decisionSeconds: 20,
};

function publicCase(c: DecisionCase): PublicCase {
  const rows = (rs: { label: string; value: string }[]) => rs.map(({ label, value }) => ({ label, value }));
  if (c.kind === "loan") {
    return {
      kind: "loan",
      customer: c.customer,
      profile: c.profile,
      segment: c.segment,
      purpose: c.purpose,
      amount: c.amount,
      term: c.term,
      evidence: rows(c.evidence),
    };
  }
  return { kind: "fraud", customer: c.customer, headline: c.headline, profile: rows(c.profile), alert: rows(c.alert) };
}

function revealedCase(c: DecisionCase): RevealedCase {
  if (c.kind === "loan") {
    return {
      correct: correctChoice(c),
      signals: c.evidence.map((r) => r.signal),
      title: c.outcome.result === "repaid" ? "Repaid" : "Defaulted",
      category: "Credit risk",
      story: c.outcome.story,
      explanation: c.explanation,
      approvePct: c.outcome.result === "repaid" ? c.outcome.pct : -c.outcome.pct,
    };
  }
  return {
    correct: correctChoice(c),
    signals: [...c.profile, ...c.alert].map((r) => r.signal),
    title: c.title,
    category: c.category,
    story: c.story,
    explanation: c.explanation,
    approvePct: null,
  };
}

/** Phases in which the current item's outcome is public. */
const isRevealPhase = (m: SessionMeta) => m.phase === "reveal" || m.phase === "qreveal" || m.phase === "final";

function itemView(meta: SessionMeta, full: boolean): ItemView | null {
  if (meta.phase === "lobby" || meta.phase === "intro") return null;
  const item = meta.schedule[meta.itemIndex];
  const revealed = full || isRevealPhase(meta);
  if (item.type === "decision") {
    const c = getCase(item.caseId);
    const view: ItemView = { index: meta.itemIndex, type: "decision", decisionNo: item.decisionNo, mode: item.mode };
    if (full || meta.phase !== "ready") view.case = publicCase(c);
    if (revealed) view.revealed = revealedCase(c);
    return view;
  }
  const q = getQuestion(item.questionId);
  const view: ItemView = {
    index: meta.itemIndex,
    type: "question",
    questionNo: item.questionNo,
    reward: item.reward,
    question: { topic: q.topic, prompt: q.prompt, options: q.options },
  };
  if (revealed) view.answer = { answerIndex: q.answerIndex, explanation: q.explanation };
  return view;
}

function baseView(meta: SessionMeta, now: number, playerCount: number, full: boolean): SessionView {
  const t = timing(meta.scale);
  const showBoard = full || meta.phase === "qreveal" || meta.phase === "final";
  return {
    code: meta.code,
    serverNow: now,
    seq: meta.seq,
    status: meta.status,
    phase: meta.phase,
    itemIndex: meta.itemIndex,
    totalItems: meta.schedule.length,
    totalDecisions: DECISION_COUNT,
    phaseEndsAt: meta.phaseEndsAt,
    openedAt: meta.openedAt,
    deadlineAt: meta.openedAt === null ? null : meta.openedAt + t.decisionMs,
    pausedRemainingMs: meta.pausedRemainingMs,
    scale: meta.scale,
    item: itemView(meta, full),
    stats: isRevealPhase(meta) && meta.lastReveal?.itemIndex === meta.itemIndex ? meta.lastReveal : null,
    leaderboard: showBoard ? meta.leaderboard : null,
    playerCount,
    economy: ECONOMY_VIEW,
  };
}

function itemTitle(meta: SessionMeta, i: number): { title: string; kind: string } {
  const item = meta.schedule[i];
  if (item.type === "question") return { title: `Bonus question ${item.questionNo}`, kind: "question" };
  const c = getCase(item.caseId);
  return { title: `${item.decisionNo}. ${c.customer}`, kind: item.mode };
}

export function playerView(meta: SessionMeta, player: PlayerRecord, submission: Submission | null, now: number, playerCount: number): PlayerView {
  const base = baseView(meta, now, playerCount, false);
  const entry = isRevealPhase(meta) ? player.history.find((h) => h.i === meta.itemIndex) : undefined;
  let result: MeView["result"] = null;
  if (entry) {
    const item = meta.schedule[entry.i];
    if (item.type === "decision") {
      const c = getCase(item.caseId);
      const r = resolveDecision(c, entry.c === "a" || entry.c === "d" ? entry.c : null, entry.ms);
      result = { ...entry, label: r.label, roi: c.kind === "loan" ? entry.delta / ECONOMY.loanStake : null };
    } else {
      result = { ...entry, label: entry.ok ? "Correct" : entry.c === null ? "No answer" : "Not quite", roi: null };
    }
  }
  const me: MeView = {
    id: player.id,
    name: player.name,
    balance: player.balance,
    correct: player.correct,
    rank: player.rank,
    late: player.joinedAtItem >= 0,
    inventory: player.inventory,
    submitted: submission?.choice ?? null,
    result,
    history: meta.phase === "final" ? player.history.map((h) => ({ ...h, ...itemTitle(meta, h.i) })) : null,
  };
  return { ...base, me };
}

export function hostView(
  meta: SessionMeta,
  players: PlayerRecord[],
  activeIds: Set<string>,
  submitted: number,
  now: number,
  storeKind: string,
): HostView {
  const live = players.filter((p) => !p.kicked);
  const rows = live
    .map((p) => ({
      id: p.id,
      name: p.name,
      balance: p.balance,
      correct: p.correct,
      rank: p.rank,
      late: p.joinedAtItem >= 0,
      active: activeIds.has(p.id),
      powerUps: p.inventory.length,
    }))
    .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || a.name.localeCompare(b.name));
  return {
    ...baseView(meta, now, live.length, true),
    activeCount: rows.filter((r) => r.active).length,
    submitted,
    players: rows,
    storeKind,
  };
}

export function screenView(meta: SessionMeta, playerCount: number, activeCount: number, submitted: number, names: string[] | null, now: number): ScreenView {
  return { ...baseView(meta, now, playerCount, false), activeCount, submitted, names };
}
