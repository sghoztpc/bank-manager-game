import {
  ALTERNATIVE_RETURN,
  ECONOMY,
  FALSE_BLOCK_LOSS,
  FINAL_QUESTION_BONUS,
  FRAUD_MISS_LOSS,
  FRAUD_REWARD,
  REFERENCE_LOAN_GAIN,
  REFERENCE_LOAN_LOSS,
  ELIMINATION,
  POWER_UP,
  SPEED_TIERS,
  timing,
} from "../config";
import { floorActive } from "../engine/elimination";
import { unusedPowerUps } from "../engine/powerups";
import { getQuizQuestion } from "../engine/quiz";
import { DECISION_COUNT, getCase } from "../engine/schedule";
import { correctChoice, resolveDecision } from "../engine/scoring";
import type { DecisionCase, EliminationRecord, HistoryEntry, LeaderEntry, PlayerRecord, SessionMeta, Submission } from "../types";
import type {
  EconomyView,
  EliminationView,
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
  quizSeconds: timing(1).questionMs / 1000,
  eliminationQuota: ELIMINATION.quota,
  safetyFloor: ELIMINATION.safetyFloor,
  powerUpBoostPct: POWER_UP.boostPct,
  wrongAnswerPenaltyPct: POWER_UP.wrongAnswerPenaltyPct,
};

const eliminationView = (e: EliminationRecord): EliminationView => ({ order: e.order, name: e.name, cause: e.cause, change: e.change, before: e.before, at: e.at });

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

type Viewer = { role: "host" } | { role: "screen" } | { role: "player"; player: PlayerRecord };

function itemView(meta: SessionMeta, viewer: Viewer): ItemView | null {
  if (meta.phase === "lobby" || meta.phase === "intro") return null;
  const full = viewer.role === "host";
  const item = meta.schedule[meta.itemIndex];
  const revealed = full || isRevealPhase(meta);
  if (item.type === "decision") {
    const view: ItemView = { index: meta.itemIndex, type: "decision", decisionNo: item.decisionNo, mode: item.mode };
    // Eliminated banks no longer receive cases.
    if (viewer.role === "player" && viewer.player.status === "eliminated") return view;
    const c = getCase(item.caseId);
    if (full || meta.phase !== "ready") view.case = publicCase(c);
    if (revealed) view.revealed = revealedCase(c);
    return view;
  }
  const view: ItemView = { index: meta.itemIndex, type: "question", questionNo: item.questionNo, reward: item.reward };
  // Each player has their own question; only that player's phone ever receives it.
  if (viewer.role !== "player" || viewer.player.status === "eliminated" || viewer.player.joinedAtItem > meta.itemIndex) return view;
  const assignment = viewer.player.quiz[item.questionNo - 1];
  const q = getQuizQuestion(assignment.questionId);
  view.question = { id: q.id, topic: q.topic, prompt: q.prompt, options: assignment.order.map((id) => ({ id, text: q.options[id] })) };
  // The source's answer line starts with its own letter ("B. ..."), which no longer matches this
  // player's shuffled order, so the letter is dropped for display. The phone highlights the option.
  if (revealed) view.answer = { id: q.answerIndex, text: q.suppliedAnswer.replace(/^[A-D]\.\s*/, "") };
  return view;
}

function baseView(meta: SessionMeta, now: number, playerCount: number, viewer: Viewer): SessionView {
  const t = timing(meta.scale);
  const full = viewer.role === "host";
  // The final table stays hidden from phones and the projector until the host reveals the podium.
  const finalHidden = meta.phase === "final" && !meta.podiumRevealed;
  const spectator = viewer.role === "player" && viewer.player.status === "eliminated";
  const showBoard =
    full ||
    (!finalHidden && (meta.phase === "qreveal" || meta.phase === "final" || spectator || (viewer.role === "screen" && meta.settings.boardOnScreen)));
  const podium = (full || meta.podiumRevealed) && meta.phase === "final" ? meta.leaderboard.filter((e) => e.rank !== null && e.rank <= 3) : null;
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
    item: itemView(meta, viewer),
    stats: isRevealPhase(meta) && meta.lastReveal?.itemIndex === meta.itemIndex ? meta.lastReveal : null,
    leaderboard: showBoard ? meta.leaderboard : null,
    eliminatedBoard: showBoard ? meta.eliminatedBoard : null,
    podium,
    podiumRevealed: meta.podiumRevealed,
    endedEarly: meta.endedEarly,
    playerCount,
    quota: { used: meta.eliminations.length, total: ELIMINATION.quota, floorActive: floorActive(meta.eliminations) },
    eliminations: meta.eliminations.map(eliminationView),
    economy: ECONOMY_VIEW,
  };
}

function itemTitle(meta: SessionMeta, h: HistoryEntry): string {
  if (h.kind === "adjust") return `Host ${h.raw >= 0 ? "addition" : "deduction"}: ${h.reason ?? ""}`;
  const item = meta.schedule[h.i];
  if (item.type === "question") return `Quiz ${item.questionNo}`;
  return `${item.decisionNo}. ${getCase(item.caseId).customer}`;
}

export function playerView(meta: SessionMeta, player: PlayerRecord, submission: Submission | null, now: number, playerCount: number): PlayerView {
  const base = baseView(meta, now, playerCount, { role: "player", player });
  const entry = isRevealPhase(meta) ? player.history.find((h) => h.kind !== "adjust" && h.i === meta.itemIndex) : undefined;
  let result: MeView["result"] = null;
  if (entry) {
    const item = meta.schedule[entry.i];
    if (item.type === "decision") {
      const c = getCase(item.caseId);
      const r = resolveDecision(c, entry.c === "a" || entry.c === "d" ? entry.c : null, entry.ms);
      result = { ...entry, label: r.label, roi: c.kind === "loan" ? entry.raw / ECONOMY.loanStake : null };
    } else {
      result = { ...entry, label: entry.ok ? "Correct" : entry.c === null ? "No answer" : "Wrong", roi: null };
    }
  }
  const elimination = meta.eliminations.find((e) => e.playerId === player.id);
  const hideRank = meta.phase === "final" && !meta.podiumRevealed;
  const me: MeView = {
    id: player.id,
    name: player.name,
    balance: player.balance,
    correct: player.correct,
    rank: hideRank ? null : player.rank,
    rankChange: hideRank || player.rank === null || player.prevRank === null ? 0 : player.prevRank - player.rank,
    late: player.joinedAtItem >= 0,
    status: player.status,
    elimination: elimination ? eliminationView(elimination) : null,
    inventory: player.inventory,
    submitted: submission?.choice ?? null,
    result,
    adjustments: player.history.filter((h) => h.kind === "adjust").slice(-3),
    history: meta.phase === "final" || player.status === "eliminated" ? player.history.map((h) => ({ ...h, title: itemTitle(meta, h) })) : null,
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
      powerUps: unusedPowerUps(p).length,
      status: p.status,
      eliminationOrder: p.eliminationOrder,
    }))
    .sort((a, b) => (a.rank ?? 1e6 + (a.eliminationOrder ?? 0)) - (b.rank ?? 1e6 + (b.eliminationOrder ?? 0)) || a.name.localeCompare(b.name));
  return {
    ...baseView(meta, now, live.length, { role: "host" }),
    activeCount: rows.filter((r) => r.active && r.status === "active").length,
    submitted,
    players: rows,
    storeKind,
    adjustments: meta.adjustments,
    settings: meta.settings,
  };
}

export function screenView(
  meta: SessionMeta,
  playerCount: number,
  activeCount: number,
  submitted: number,
  names: string[] | null,
  now: number,
  finalBoard: LeaderEntry[] | null = null,
): ScreenView {
  const base = baseView(meta, now, playerCount, { role: "screen" });
  return {
    ...base,
    leaderboard: finalBoard ?? base.leaderboard,
    activeCount,
    submitted,
    names,
    announcements: meta.settings.announceEliminations ? meta.announcements : [],
    settings: meta.settings,
  };
}
