import { MIN_RESUME_MS, NETWORK, type Timing } from "../config";
import type { SessionMeta } from "../types";

// Pure session clock. The service calls `nextPhase` when a phase's time is up, when every
// active player has answered, or when the host skips; resolution of the item being left happens
// in the service before the new phase is stored.

type PhaseFields = Pick<SessionMeta, "status" | "phase" | "itemIndex" | "phaseStartedAt" | "phaseEndsAt" | "openedAt">;

/** If the clock fell this far behind (nobody polling), restart the window instead of opening it half-spent. */
const MAX_CATCH_UP_MS = 2_000;

function enterItem(meta: SessionMeta, index: number, now: number, t: Timing): PhaseFields {
  if (index >= meta.schedule.length) {
    return { status: "finished", phase: "final", itemIndex: meta.schedule.length - 1, phaseStartedAt: now, phaseEndsAt: null, openedAt: null };
  }
  const item = meta.schedule[index];
  if (item.type === "decision") {
    return { status: "running", phase: "ready", itemIndex: index, phaseStartedAt: now, phaseEndsAt: now + t.readyMs, openedAt: null };
  }
  return { status: "running", phase: "question", itemIndex: index, phaseStartedAt: now, phaseEndsAt: now + t.questionMs, openedAt: null };
}

/** Deadline for submissions on the server: the decision window plus the network grace. */
export function decisionClosesAt(openedAt: number, t: Timing): number {
  return openedAt + t.decisionMs + NETWORK.latencyGraceMs;
}

export function nextPhase(meta: SessionMeta, now: number, t: Timing): PhaseFields {
  switch (meta.phase) {
    case "lobby":
      return { status: "running", phase: "intro", itemIndex: 0, phaseStartedAt: now, phaseEndsAt: now + t.introMs, openedAt: null };
    case "intro":
      return enterItem(meta, 0, now, t);
    case "ready": {
      // The case opens at its scheduled moment, which every phone has been counting down to.
      const scheduled = meta.phaseEndsAt ?? now;
      const openedAt = now - scheduled <= MAX_CATCH_UP_MS ? Math.min(scheduled, now) : now;
      return { status: "running", phase: "open", itemIndex: meta.itemIndex, phaseStartedAt: openedAt, phaseEndsAt: decisionClosesAt(openedAt, t), openedAt };
    }
    case "open":
      return { status: "running", phase: "reveal", itemIndex: meta.itemIndex, phaseStartedAt: now, phaseEndsAt: now + t.revealMs, openedAt: meta.openedAt };
    case "question":
      return { status: "running", phase: "qreveal", itemIndex: meta.itemIndex, phaseStartedAt: now, phaseEndsAt: now + t.questionRevealMs, openedAt: null };
    case "reveal":
    case "qreveal":
      return enterItem(meta, meta.itemIndex + 1, now, t);
    case "final":
      return { status: "finished", phase: "final", itemIndex: meta.itemIndex, phaseStartedAt: meta.phaseStartedAt, phaseEndsAt: null, openedAt: null };
  }
}

export function pause(meta: SessionMeta, now: number): SessionMeta {
  if (meta.status !== "running" || meta.phaseEndsAt === null) return meta;
  return { ...meta, status: "paused", pausedAt: now, pausedRemainingMs: Math.max(0, meta.phaseEndsAt - now) };
}

/**
 * Continue: restores the saved remaining time (not a fresh timer). A decision or quiz window that
 * was almost over gets at least MIN_RESUME_MS back so Continue never causes an instant timeout.
 * The case's opening time moves with the deadline, so response times exclude the pause.
 */
export function resume(meta: SessionMeta, now: number, t: Timing): SessionMeta {
  if (meta.status !== "paused" || meta.pausedAt === null) return meta;
  const live = meta.phase === "open" || meta.phase === "question";
  const saved = meta.pausedRemainingMs ?? 0;
  const remaining = live ? Math.max(saved, Math.round(MIN_RESUME_MS * meta.scale)) : saved;
  const phaseEndsAt = now + remaining;
  return {
    ...meta,
    status: "running",
    phaseEndsAt,
    openedAt: meta.openedAt === null ? null : meta.phase === "open" ? phaseEndsAt - t.decisionMs - NETWORK.latencyGraceMs : meta.openedAt + (now - meta.pausedAt),
    phaseStartedAt: meta.phase === "question" ? meta.phaseStartedAt + (now - meta.pausedAt) : meta.phaseStartedAt,
    pausedAt: null,
    pausedRemainingMs: null,
  };
}
