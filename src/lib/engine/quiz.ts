import { PLAYABLE_QUESTIONS, QUIZ_POOL, SLOT_CATEGORIES } from "../content/questions";
import type { QuizAssignment, QuizQuestion } from "../types";
import { mulberry32 } from "./schedule";

const BY_ID = new Map(QUIZ_POOL.map((q) => [q.id, q]));

export function getQuizQuestion(id: string): QuizQuestion {
  const q = BY_ID.get(id);
  if (!q) throw new Error(`Unknown quiz question ${id}`);
  return q;
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Five distinct questions for one player, one per slot, each slot drawn from its category,
 * with the four options shuffled (the source keys are almost all "B"). Independent per player;
 * derived from the session seed and player id, and stored on the player record at join so
 * it never changes afterwards.
 */
export function assignQuiz(seed: number, playerId: string, pool: QuizQuestion[] = PLAYABLE_QUESTIONS): QuizAssignment[] {
  const rand = mulberry32((seed ^ hash(playerId)) >>> 0);
  const used = new Set<string>();
  return SLOT_CATEGORIES.map((category) => {
    const candidates = pool.filter((q) => q.category === category && !used.has(q.id));
    const fallback = pool.filter((q) => !used.has(q.id));
    const from = candidates.length > 0 ? candidates : fallback;
    if (from.length === 0) throw new Error("Not enough playable quiz questions for five distinct slots.");
    const q = from[Math.floor(rand() * from.length)];
    used.add(q.id);
    return { questionId: q.id, order: shuffle([0, 1, 2, 3], rand) };
  });
}
