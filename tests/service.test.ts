import { beforeEach, describe, expect, it } from "vitest";
import { CAPACITY, ECONOMY, ELIMINATION, FINAL_QUESTION_BONUS, MIN_RESUME_MS, NETWORK, timing } from "@/lib/config";
import { getQuizQuestion } from "@/lib/engine/quiz";
import { buildSchedule, getCase } from "@/lib/engine/schedule";
import { correctChoice, resolveDecision } from "@/lib/engine/scoring";
import { GameService } from "@/lib/game/service";
import { hostView, playerView, screenView } from "@/lib/game/views";
import { MemoryStore } from "@/lib/store/memory";
import { RedisStore } from "@/lib/store/redis";
import type { Store } from "@/lib/store/types";
import { Redis } from "@upstash/redis";
import type { SessionMeta } from "@/lib/types";

const T = timing(1);

class Clock {
  t = 1_000_000;
  now = () => this.t;
  advance(ms: number) {
    this.t += ms;
  }
}

// TEST_KV_URL=http://localhost:8079 runs this suite against Redis through scripts/upstash-shim.ts.
const makeStore = (): Store =>
  process.env.TEST_KV_URL
    ? new RedisStore(new Redis({ url: process.env.TEST_KV_URL, token: "local", automaticDeserialization: false, enableTelemetry: false }))
    : new MemoryStore();

let store: Store;
let clock: Clock;
let svc: GameService;

beforeEach(() => {
  store = makeStore();
  clock = new Clock();
  svc = new GameService(store, clock.now);
});

type P = { playerId: string; token: string; name: string };

async function setup(names: string[], seed = 42) {
  const { code, hostToken } = await svc.createSession(seed);
  const players: P[] = [];
  for (const n of names) players.push(await svc.join(code, n));
  return { code, hostToken, players };
}

const meta = async (code: string) => (await store.getMeta(code)) as SessionMeta;
const rec = async (code: string, p: P) => (await store.getPlayer(code, p.playerId))!;
const poll = (code: string, p: P, firstView = false) => svc.playerPoll(code, p.playerId, p.token, { heartbeat: true, firstView });

async function pollAll(code: string, players: P[]) {
  for (const p of players) {
    try {
      await poll(code, p);
    } catch {
      // Removed players cannot poll.
    }
  }
}

async function toPhase(code: string, phase: string, players: P[] = []) {
  for (let i = 0; i < 300; i++) {
    const m = await svc.tick(code);
    if (m.phase === phase) return m;
    clock.advance(Math.max(1, (m.phaseEndsAt ?? clock.t) - clock.t));
    await pollAll(code, players);
  }
  throw new Error(`never reached ${phase}`);
}

let adjCount = 0;
const adjust = (code: string, host: string, p: P, op: "add" | "subtract", amount: number, id = `adj-${++adjCount}-test`) =>
  svc.adjust(code, host, { id, playerId: p.playerId, op, amount, reason: "test" }, "Host (test)");

async function setBalance(code: string, host: string, p: P, target: number) {
  const r = await rec(code, p);
  if (r.balance !== target) await adjust(code, host, p, target > r.balance ? "add" : "subtract", Math.abs(target - r.balance));
}

/** The choice that loses money on this case, if any (approving a bad loan, allowing fraud, blocking a genuine customer). */
function losingChoice(m: SessionMeta, i: number): "a" | "d" | null {
  const item = m.schedule[i];
  if (item.type !== "decision") return null;
  const c = getCase(item.caseId);
  if (correctChoice(c) === "d") return "a";
  return c.kind === "fraud" ? "d" : null;
}

/** Moves to the next open decision whose wrong answer loses money. */
async function toLosingCase(code: string, host: string, players: P[]) {
  for (let k = 0; k < 30; k++) {
    const m = await toPhase(code, "open", players);
    const choice = losingChoice(m, m.itemIndex);
    if (choice) return { m, choice };
    await svc.hostAction(code, host, "skip");
  }
  throw new Error("no losing case");
}

/** First seed whose decision 5 (schedule index 4, right before quiz 1) can lose money. */
function seedWithLosingCase5(): number {
  for (let s = 1; s < 500; s++) {
    const item = buildSchedule(s)[4];
    if (item.type === "decision" && correctChoice(getCase(item.caseId)) === "d") return s;
  }
  throw new Error("no seed");
}

describe("session flow", () => {
  it("runs all 29 interactions in order, resolving each decision before the quiz that follows", async () => {
    const { code, hostToken, players } = await setup(["Chi"]);
    const [p] = players;
    await svc.hostAction(code, hostToken, "force-start");
    const sched = (await meta(code)).schedule;
    const assigned = (await rec(code, p)).quiz;

    for (let i = 0; i < sched.length; i++) {
      const item = sched[i];
      if (item.type === "decision") {
        const m = await toPhase(code, "open", players);
        expect(m.itemIndex).toBe(i);
        await svc.submit(code, p.playerId, p.token, i, correctChoice(getCase(item.caseId)));
      } else {
        const m = await toPhase(code, "question", players);
        expect(m.itemIndex).toBe(i);
        expect((await rec(code, p)).history.at(-1)!.i).toBe(i - 1);
        await svc.submit(code, p.playerId, p.token, i, getQuizQuestion(assigned[item.questionNo - 1].questionId).answerIndex);
      }
    }
    await toPhase(code, "final", players);
    const r = await rec(code, p);
    expect(r.correct).toBe(24);
    expect(r.inventory.map((t) => t.source)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    expect(r.history.filter((h) => h.kind === "quiz" && h.delta > 0)).toEqual([expect.objectContaining({ delta: FINAL_QUESTION_BONUS })]);
    expect(r.balance).toBe(ECONOMY.startingBalance + r.history.reduce((a, h) => a + h.delta, 0));
    expect(Number.isInteger(r.balance)).toBe(true);
  });
});

describe("quizzes", () => {
  it("gives every player five distinct random questions, persisted across refreshes", async () => {
    const { code, players } = await setup(Array.from({ length: 12 }, (_, i) => `P${i}`));
    const sets = new Set<string>();
    for (const p of players) {
      const a = (await rec(code, p)).quiz;
      expect(new Set(a.map((x) => x.questionId)).size).toBe(5);
      sets.add(a.map((x) => x.questionId).join());
      // "Refresh": a later read gives exactly the same questions and option order.
      await poll(code, p);
      expect((await rec(code, p)).quiz).toEqual(a);
    }
    expect(sets.size).toBeGreaterThan(1);
  });

  it("shows each phone only its own question, with shuffled options, and the answer only after it closes", async () => {
    const { code, hostToken, players } = await setup(["An", "Bảo"]);
    await svc.hostAction(code, hostToken, "force-start");
    const m = await toPhase(code, "question", players);
    const [a, b] = players;
    const pa = await poll(code, a);
    const va = playerView(pa.meta, pa.player, pa.submission, clock.t, 2);
    const mine = pa.player.quiz[0];
    expect(va.item?.question?.id).toBe(mine.questionId);
    expect(va.item?.question?.options.map((o) => o.id)).toEqual(mine.order);
    expect(va.item?.answer).toBeUndefined();
    const json = JSON.stringify(va);
    expect(json).not.toMatch(/answerIndex|suppliedAnswer/);
    const other = (await rec(code, b)).quiz[0].questionId;
    if (other !== mine.questionId) expect(json).not.toContain(getQuizQuestion(other).prompt);
    // Projector and host never receive individual questions.
    const sv = screenView(m, 2, 2, 0, null, clock.t);
    expect(sv.item?.question).toBeUndefined();
    const hv = hostView(m, [pa.player], new Set(), 0, clock.t, "memory");
    expect(hv.item?.question).toBeUndefined();
  });

  it("grades by option id after shuffling, once: correct earns a token, wrong or no answer costs 20%", async () => {
    const { code, hostToken, players } = await setup(["Chi", "Dũng", "Em"]);
    await svc.hostAction(code, hostToken, "force-start");
    const m = await toPhase(code, "question", players);
    const [right, wrong, silent] = players;
    const qr = getQuizQuestion((await rec(code, right)).quiz[0].questionId);
    const qw = getQuizQuestion((await rec(code, wrong)).quiz[0].questionId);
    const before = { wrong: (await rec(code, wrong)).balance, silent: (await rec(code, silent)).balance, right: (await rec(code, right)).balance };
    await svc.submit(code, right.playerId, right.token, m.itemIndex, qr.answerIndex);
    expect(await svc.submit(code, right.playerId, right.token, m.itemIndex, (qr.answerIndex + 1) % 4)).toMatchObject({ duplicate: true });
    await svc.submit(code, wrong.playerId, wrong.token, m.itemIndex, (qw.answerIndex + 1) % 4);
    await toPhase(code, "qreveal", [right, wrong]);
    const r = await rec(code, right);
    const w = await rec(code, wrong);
    const s = await rec(code, silent);
    expect(r.inventory).toEqual([expect.objectContaining({ kind: "boost", usedAtItem: null })]);
    expect(r.balance).toBe(before.right);
    expect(w.inventory).toHaveLength(0);
    expect(w.balance).toBe(before.wrong - Math.round(before.wrong * 0.2));
    expect(s.balance).toBe(before.silent - Math.round(before.silent * 0.2));
    // Settling again (a retick) cannot charge twice.
    await svc.tick(code);
    expect((await rec(code, wrong)).balance).toBe(before.wrong - Math.round(before.wrong * 0.2));
    const pr = await poll(code, right);
    const answer = playerView(pr.meta, pr.player, null, clock.t, 3).item?.answer;
    expect(answer?.id).toBe(qr.answerIndex);
    expect(answer?.text).not.toMatch(/^[A-D]\./); // no source letter that contradicts the shuffled order
  });

  it("applies the +10% boost to the next correct decision only, then the token is spent", async () => {
    const { code, hostToken, players } = await setup(["Boost"]);
    const [p] = players;
    await svc.hostAction(code, hostToken, "force-start");
    const sched = (await meta(code)).schedule;
    // Quiz 1 correct -> token.
    let m = await toPhase(code, "question", players);
    await svc.submit(code, p.playerId, p.token, m.itemIndex, getQuizQuestion((await rec(code, p)).quiz[0].questionId).answerIndex);
    // Next case: answer wrongly first if possible (token must survive), then correctly.
    m = await toPhase(code, "open", players);
    const c1 = getCase((sched[m.itemIndex] as { caseId: string }).caseId);
    const wrongChoice = correctChoice(c1) === "a" ? "d" : "a";
    await svc.submit(code, p.playerId, p.token, m.itemIndex, wrongChoice);
    await toPhase(code, "reveal", players);
    expect((await rec(code, p)).inventory[0].usedAtItem).toBeNull();
    m = await toPhase(code, "open", players);
    const c2 = getCase((sched[m.itemIndex] as { caseId: string }).caseId);
    clock.t = m.openedAt! + 16_000; // no speed bonus, to keep the arithmetic plain
    await svc.submit(code, p.playerId, p.token, m.itemIndex, correctChoice(c2));
    await toPhase(code, "reveal", players);
    const r = await rec(code, p);
    const h = r.history.at(-1)!;
    const earned = resolveDecision(c2, correctChoice(c2), 16_000).delta;
    expect(h.boost).toBe(Math.round(earned * 0.1));
    expect(h.raw).toBe(earned + h.boost!);
    expect(r.inventory[0].usedAtItem).toBe(m.itemIndex);
  });
});

describe("elimination quota", () => {
  it("eliminates on an exact-zero deduction and on an overshooting one, showing 0 VND", async () => {
    const { code, hostToken, players } = await setup(["Exact", "Over", "Fine"]);
    const [exact, over] = players;
    await adjust(code, hostToken, exact, "subtract", ECONOMY.startingBalance);
    await adjust(code, hostToken, over, "subtract", ECONOMY.startingBalance * 5);
    const m = await meta(code);
    expect(m.eliminations.map((e) => [e.order, e.name])).toEqual([
      [1, "Exact"],
      [2, "Over"],
    ]);
    expect((await rec(code, exact)).balance).toBe(0);
    expect((await rec(code, over)).balance).toBe(0);
    expect(m.eliminatedBoard.map((e) => [e.name, e.balance])).toEqual([
      ["Exact", 0],
      ["Over", 0],
    ]);
    expect(m.leaderboard.map((e) => e.name)).toEqual(["Fine"]);
  });

  it("resolves simultaneous failures in one authoritative order: slots 4 and 5, then the 1 VND floor; no sixth elimination", async () => {
    const names = ["E1", "E2", "E3", "A", "B", "C", "D", "Safe"];
    const { code, hostToken, players } = await setup(names);
    const by = (n: string) => players.find((p) => p.name === n)!;
    for (const n of ["E1", "E2", "E3"]) await adjust(code, hostToken, by(n), "subtract", ECONOMY.startingBalance);
    for (const n of ["A", "B", "C", "D"]) await setBalance(code, hostToken, by(n), 1_000_000);
    await svc.hostAction(code, hostToken, "force-start");
    const live = players.filter((p) => !p.name.startsWith("E"));
    const { m, choice } = await toLosingCase(code, hostToken, live);
    // Submitted in this order: A first ... D last.
    for (const n of ["A", "B", "C", "D"]) {
      clock.t = m.openedAt! + 1000 + ["A", "B", "C", "D"].indexOf(n) * 500;
      await svc.submit(code, by(n).playerId, by(n).token, m.itemIndex, choice);
    }
    await svc.hostAction(code, hostToken, "skip");
    const after = await meta(code);
    expect(after.eliminations.map((e) => e.name)).toEqual(["E1", "E2", "E3", "A", "B"]);
    expect((await rec(code, by("A"))).status).toBe("eliminated");
    expect((await rec(code, by("B"))).eliminationOrder).toBe(5);
    for (const n of ["C", "D"]) expect(await rec(code, by(n))).toMatchObject({ status: "active", balance: 1 });
    expect(after.announcements.map((a) => a.id)).toEqual(["elim-1", "elim-2", "elim-3", "elim-4", "elim-5", "floor"]);
    expect(after.lastReveal?.eliminated).toBe(2);

    // A's loss repeated (resubmission, retick) changes nothing.
    await expect(svc.submit(code, by("A").playerId, by("A").token, m.itemIndex, choice)).rejects.toThrow();
    await svc.tick(code);
    expect((await meta(code)).eliminations).toHaveLength(5);

    // A survivor keeps losing under the floor: stays active at 1 VND, never a sixth elimination.
    for (let k = 0; k < 3; k++) {
      const next = await toLosingCase(code, hostToken, live);
      await svc.submit(code, by("C").playerId, by("C").token, next.m.itemIndex, next.choice);
      await svc.hostAction(code, hostToken, "skip");
      expect(await rec(code, by("C"))).toMatchObject({ status: "active", balance: expect.any(Number) });
      expect((await rec(code, by("C"))).balance).toBeGreaterThanOrEqual(1);
    }
    expect((await meta(code)).eliminations).toHaveLength(5);
  });

  it("gives the last slot to exactly one of two concurrent host deductions", async () => {
    const { code, hostToken, players } = await setup(["E1", "E2", "E3", "E4", "X", "Y"]);
    for (const p of players.slice(0, 4)) await adjust(code, hostToken, p, "subtract", ECONOMY.startingBalance);
    const [x, y] = players.slice(4);
    await Promise.all([adjust(code, hostToken, x, "subtract", ECONOMY.startingBalance), adjust(code, hostToken, y, "subtract", ECONOMY.startingBalance)]);
    const outcomes = [(await rec(code, x)).status, (await rec(code, y)).status].sort();
    expect(outcomes).toEqual(["active", "eliminated"]);
    expect((await meta(code)).eliminations).toHaveLength(ELIMINATION.quota);
    const survivor = (await rec(code, x)).status === "active" ? x : y;
    expect((await rec(code, survivor)).balance).toBe(ELIMINATION.safetyFloor);
  });

  it("locks an eliminated bank out of play, survives refresh, and skips the milestone quiz reward", async () => {
    const seed = seedWithLosingCase5();
    const { code, hostToken, players } = await setup(["Bust", "Other"], seed);
    const [bust, other] = players;
    await setBalance(code, hostToken, bust, 1_000_000);
    await svc.hostAction(code, hostToken, "force-start");
    let m = await toPhase(code, "open", players);
    while (m.itemIndex < 4) {
      await svc.hostAction(code, hostToken, "skip");
      m = await toPhase(code, "open", players);
    }
    await svc.submit(code, bust.playerId, bust.token, 4, losingChoice(m, 4)!);
    await svc.submit(code, other.playerId, other.token, 4, "d");
    m = await toPhase(code, "question", players);
    expect(m.itemIndex).toBe(5);

    // Refresh: still eliminated; Game Over data present; no quiz, no case content.
    const view = await poll(code, bust);
    const pv = playerView(view.meta, view.player, null, clock.t, 1);
    expect(pv.me.status).toBe("eliminated");
    expect(pv.me.balance).toBe(0);
    expect(pv.me.elimination).toMatchObject({ order: 1, cause: expect.stringContaining("Case 5") });
    expect(pv.item?.question).toBeUndefined();
    expect(pv.leaderboard).not.toBeNull(); // spectators can watch the table

    await expect(svc.submit(code, bust.playerId, bust.token, 5, 0)).rejects.toThrow(/eliminated/);
    await toPhase(code, "qreveal", players);
    const r = await rec(code, bust);
    expect(r.history.filter((h) => h.kind === "quiz")).toHaveLength(0);
    expect(r.inventory).toHaveLength(0);
    expect(r.balance).toBe(0);
  });

  it("stamps timeouts of an early-closed case at the close, never after a later elimination", async () => {
    const { code, hostToken, players } = await setup(["Slow", "Fast"]);
    const [slow, fast] = players;
    await svc.hostAction(code, hostToken, "force-start");
    const m = await toPhase(code, "open", players);
    clock.advance(NETWORK.activeWindowMs + 1); // Slow stops polling, so the room does not wait for it
    await poll(code, fast);
    await svc.submit(code, fast.playerId, fast.token, m.itemIndex, "d"); // closes early
    clock.advance(500);
    await adjust(code, hostToken, slow, "subtract", ECONOMY.startingBalance * 2);
    const r = await rec(code, slow);
    const timeout = r.history.find((h) => h.kind === "decision")!;
    const elimination = (await meta(code)).eliminations[0];
    expect(timeout.c).toBeNull();
    expect(timeout.at).toBeLessThanOrEqual(elimination.at);
  });

  it("does not wait for eliminated players before closing early", async () => {
    const { code, hostToken, players } = await setup(["Out", "In"]);
    await adjust(code, hostToken, players[0], "subtract", ECONOMY.startingBalance);
    await svc.hostAction(code, hostToken, "force-start");
    const m = await toPhase(code, "open", players);
    await svc.submit(code, players[1].playerId, players[1].token, m.itemIndex, "d");
    expect((await meta(code)).phase).toBe("reveal");
  });
});

describe("host adjustments", () => {
  it("previews the consequence, applies once per id, and logs who, what, why, before and after", async () => {
    const { code, hostToken, players } = await setup(["Lan"]);
    const [p] = players;
    const preview = await svc.previewAdjustment(code, hostToken, { id: "preview-key-1", playerId: p.playerId, op: "add", amount: 50_000_000, reason: "Presentation bonus" });
    expect(preview).toMatchObject({ before: 300_000_000, after: 350_000_000, outcome: "applied" });
    expect((await rec(code, p)).balance).toBe(300_000_000); // preview changes nothing

    const input = { id: "same-key-123", playerId: p.playerId, op: "add", amount: 50_000_000, reason: "Presentation bonus" };
    const first = await svc.adjust(code, hostToken, input, "Host (key abc)");
    const again = await svc.adjust(code, hostToken, input, "Host (key abc)");
    expect(first.duplicate).toBe(false);
    expect(again).toMatchObject({ duplicate: true, record: first.record });
    expect((await rec(code, p)).balance).toBe(350_000_000);
    expect((await meta(code)).adjustments).toEqual([
      expect.objectContaining({ id: "same-key-123", name: "Lan", amount: 50_000_000, op: "add", reason: "Presentation bonus", actor: "Host (key abc)", before: 300_000_000, after: 350_000_000 }),
    ]);
    // The phone sees it (and the ranking updated in the same write).
    const v = await poll(code, p);
    expect(playerView(v.meta, v.player, null, clock.t, 1).me.adjustments.at(-1)).toMatchObject({ delta: 50_000_000, reason: "Presentation bonus" });
    expect(v.meta.leaderboard[0]).toMatchObject({ name: "Lan", balance: 350_000_000 });
  });

  it("warns before a deduction that eliminates, and refuses to revive an eliminated bank", async () => {
    const { code, hostToken, players } = await setup(["Minh"]);
    const [p] = players;
    const pv = await svc.previewAdjustment(code, hostToken, { id: "pv-elim-0001", playerId: p.playerId, op: "subtract", amount: 400_000_000, reason: "x" });
    expect(pv).toMatchObject({ outcome: "eliminated", order: 1, after: 0 });
    await adjust(code, hostToken, p, "subtract", 400_000_000);
    expect(await rec(code, p)).toMatchObject({ status: "eliminated", balance: 0 });
    await expect(adjust(code, hostToken, p, "add", 1_000_000)).rejects.toThrow(/cannot be revived/);
    const pv2 = await svc.previewAdjustment(code, hostToken, { id: "pv-elim-0002", playerId: p.playerId, op: "add", amount: 1, reason: "x" });
    expect(pv2.outcome).toBe("refused");
  });

  it("validates amounts and reasons", async () => {
    const { code, hostToken, players } = await setup(["Nga"]);
    const base = { id: "validate-key-1", playerId: players[0].playerId, op: "add", reason: "ok" };
    await expect(svc.adjust(code, hostToken, { ...base, amount: 1.5 }, "h")).rejects.toThrow(/whole VND/);
    await expect(svc.adjust(code, hostToken, { ...base, amount: -5 }, "h")).rejects.toThrow(/whole VND/);
    await expect(svc.adjust(code, hostToken, { ...base, amount: 5, reason: "  " }, "h")).rejects.toThrow(/reason/);
  });
});

describe("permissions", () => {
  it("player credentials cannot run host controls or adjustments", async () => {
    const { code, players } = await setup(["Oanh"]);
    const [p] = players;
    await expect(svc.hostAction(code, p.token, "pause")).rejects.toThrow(/Host key/);
    await expect(svc.hostAction(code, p.token, "force-start")).rejects.toThrow(/Host key/);
    await expect(svc.adjust(code, p.token, { id: "nope-key-1", playerId: p.playerId, op: "add", amount: 1, reason: "x" }, "x")).rejects.toThrow(/Host key/);
    await expect(svc.previewAdjustment(code, p.token, { id: "nope-key-2", playerId: p.playerId, op: "add", amount: 1, reason: "x" })).rejects.toThrow(/Host key/);
    await expect(svc.hostSnapshot(code, p.token)).rejects.toThrow(/Host key/);
  });

  it("host reconnecting with the same key controls the same game", async () => {
    const { code, hostToken } = await setup(["Phú"]);
    const a = await svc.hostSnapshot(code, hostToken);
    const b = await svc.hostSnapshot(code, hostToken);
    expect(a.meta.code).toBe(b.meta.code);
    expect(a.meta.createdAt).toBe(b.meta.createdAt);
  });
});

describe("pause and continue", () => {
  it("freezes a decision and continues from the saved time; refuses answers while paused", async () => {
    const { code, hostToken, players } = await setup(["Quân", "Sơn"]);
    const [p] = players;
    await svc.hostAction(code, hostToken, "force-start");
    const m = await toPhase(code, "open", players);
    clock.t = m.openedAt! + 3_000;
    await svc.hostAction(code, hostToken, "pause");
    const saved = (await meta(code)).pausedRemainingMs!;
    expect(saved).toBe(T.decisionMs + NETWORK.latencyGraceMs - 3_000);
    clock.advance(60_000);
    expect((await svc.tick(code)).phase).toBe("open");
    await expect(svc.submit(code, p.playerId, p.token, m.itemIndex, "a")).rejects.toThrow(/paused/);
    await svc.hostAction(code, hostToken, "continue");
    const resumed = await meta(code);
    expect(resumed.phaseEndsAt! - clock.t).toBe(saved); // not a fresh 20 s, not a timeout
    clock.advance(1_000);
    await svc.submit(code, p.playerId, p.token, m.itemIndex, "a");
    await svc.hostAction(code, hostToken, "skip");
    expect((await rec(code, p)).history[0].ms).toBe(4_000);
  });

  it("gives a nearly expired window a few seconds back on Continue instead of timing out", async () => {
    const { code, hostToken, players } = await setup(["Tâm"]);
    await svc.hostAction(code, hostToken, "force-start");
    const m = await toPhase(code, "open", players);
    clock.t = m.openedAt! + T.decisionMs + 100;
    await svc.hostAction(code, hostToken, "pause");
    clock.advance(30_000);
    await svc.hostAction(code, hostToken, "continue");
    const r = await meta(code);
    expect(r.phase).toBe("open");
    expect(r.phaseEndsAt! - clock.t).toBe(MIN_RESUME_MS);
    await svc.submit(code, players[0].playerId, players[0].token, m.itemIndex, "a");
  });

  it("freezes a quiz too", async () => {
    const { code, hostToken, players } = await setup(["Uyên"]);
    await svc.hostAction(code, hostToken, "force-start");
    await toPhase(code, "question", players);
    clock.advance(5_000);
    await svc.hostAction(code, hostToken, "pause");
    const saved = (await meta(code)).pausedRemainingMs!;
    expect(saved).toBe(T.questionMs - 5_000);
    clock.advance(120_000);
    await svc.hostAction(code, hostToken, "continue");
    expect((await meta(code)).phaseEndsAt! - clock.t).toBe(saved);
  });
});

describe("decisions", () => {
  async function openFirstCase(names: string[]) {
    const s = await setup(names);
    await svc.hostAction(s.code, s.hostToken, "force-start");
    const m = await toPhase(s.code, "open", s.players);
    return { ...s, m };
  }

  it("rejects duplicate submissions and keeps the first choice", async () => {
    const { code, players, m } = await openFirstCase(["Vy", "Xuân"]);
    const [p] = players;
    expect(await svc.submit(code, p.playerId, p.token, m.itemIndex, "a")).toMatchObject({ accepted: true });
    expect(await svc.submit(code, p.playerId, p.token, m.itemIndex, "d")).toMatchObject({ accepted: false, duplicate: true, choice: "a" });
  });

  it("accepts up to the network grace after 20 s with no bonus, and refuses after it", async () => {
    const { code, players, m } = await openFirstCase(["Giang", "Hà"]);
    const [p, q] = players;
    clock.t = m.openedAt! + T.decisionMs + NETWORK.latencyGraceMs;
    expect(await svc.submit(code, p.playerId, p.token, m.itemIndex, "a")).toMatchObject({ accepted: true });
    clock.t += 1;
    await expect(svc.submit(code, q.playerId, q.token, m.itemIndex, "a")).rejects.toThrow(/closed|Time is up/);
    await toPhase(code, "reveal", []);
    expect((await rec(code, p)).history[0]).toMatchObject({ speedBonus: 0, c: "a" });
    expect((await rec(code, q)).history[0].c).toBe(null);
  });

  it("gives no speed bonus between 15 and 20 seconds", async () => {
    const { code, players, m } = await openFirstCase(["Khoa", "Lan"]);
    const right = correctChoice(getCase((m.schedule[m.itemIndex] as { caseId: string }).caseId));
    const [fast, slow] = players;
    clock.t = m.openedAt! + 4_000;
    await svc.submit(code, fast.playerId, fast.token, m.itemIndex, right);
    clock.t = m.openedAt! + 15_500;
    await svc.submit(code, slow.playerId, slow.token, m.itemIndex, right);
    await toPhase(code, "reveal", []);
    const f = (await rec(code, fast)).history[0];
    const s = (await rec(code, slow)).history[0];
    expect(f.speedBonus).toBeGreaterThan(0);
    expect(s.speedBonus).toBe(0);
  });

  it("never sends the decision answer to players before the reveal", async () => {
    const { code, players, m } = await openFirstCase(["Yến"]);
    const [p] = players;
    const v = await poll(code, p, true);
    const view = playerView(v.meta, v.player, v.submission, clock.t, 1);
    expect(view.item?.case).toBeDefined();
    expect(view.item?.revealed).toBeUndefined();
    expect(JSON.stringify(view)).not.toMatch(/"signal"|"story"|"explanation"|"truth"/);
    await svc.submit(code, p.playerId, p.token, m.itemIndex, "a");
    const after = await poll(code, p);
    expect(playerView(after.meta, after.player, null, clock.t, 1).item?.revealed?.correct).toMatch(/a|d/);
  });
});

describe("final results", () => {
  it("End settles the open case, then hides ranks and podium until the host reveals them", async () => {
    const { code, hostToken, players } = await setup(["An", "Bình", "Chi"]);
    await svc.hostAction(code, hostToken, "force-start");
    const m = await toPhase(code, "open", players);
    await svc.submit(code, players[0].playerId, players[0].token, m.itemIndex, "a");
    await svc.hostAction(code, hostToken, "end");
    const f = await meta(code);
    expect(f).toMatchObject({ phase: "final", status: "finished", endedEarly: true, podiumRevealed: false });
    expect((await rec(code, players[0])).history).toHaveLength(1); // settled before final
    await expect(svc.submit(code, players[1].playerId, players[1].token, m.itemIndex, "a")).rejects.toThrow();

    const v = await poll(code, players[0]);
    const before = playerView(v.meta, v.player, null, clock.t, 3);
    expect(before.me.rank).toBeNull();
    expect(before.podium).toBeNull();
    expect(before.leaderboard).toBeNull();
    expect(screenView(f, 3, 3, 0, null, clock.t).podium).toBeNull();

    await svc.hostAction(code, hostToken, "reveal-podium");
    const v2 = await poll(code, players[0]);
    const after = playerView(v2.meta, v2.player, null, clock.t, 3);
    expect(after.podium!.length).toBeGreaterThanOrEqual(1);
    expect(after.me.rank).not.toBeNull();
    // Frozen: no adjustments after the reveal; refresh shows the same final state.
    await expect(adjust(code, hostToken, players[1], "add", 1)).rejects.toThrow(/frozen/);
    const v3 = await poll(code, players[0]);
    expect(playerView(v3.meta, v3.player, null, clock.t, 3).podium).toEqual(after.podium);
  });

  it("shares a tied place, leaves empty places empty, and never promotes eliminated banks", async () => {
    const { code, hostToken, players } = await setup(["Tie1", "Tie2", "Out"]);
    await adjust(code, hostToken, players[2], "subtract", ECONOMY.startingBalance);
    await svc.hostAction(code, hostToken, "end");
    await svc.hostAction(code, hostToken, "reveal-podium");
    const f = await meta(code);
    const podium = playerView(f, (await rec(code, players[0]))!, null, clock.t, 2).podium!;
    expect(podium.map((e) => [e.name, e.rank])).toEqual([
      ["Tie1", 1],
      ["Tie2", 1],
    ]);
    expect(podium.some((e) => e.name === "Out")).toBe(false);
    expect(f.eliminatedBoard.map((e) => e.name)).toEqual(["Out"]);
  });
});

describe("players", () => {
  it("restores the same identity and progress with the stored token", async () => {
    const { code, hostToken, players } = await setup(["Đức", "Another"]);
    const [p] = players;
    await svc.hostAction(code, hostToken, "force-start");
    const m = await toPhase(code, "open", players);
    await svc.submit(code, p.playerId, p.token, m.itemIndex, "a");
    const again = await poll(code, p);
    expect(again.player.name).toBe("Đức");
    expect(again.submission?.choice).toBe("a");
    await expect(svc.playerPoll(code, p.playerId, "wrong", { heartbeat: true, firstView: false })).rejects.toThrow(/Not a player/);
  });

  it(`refuses player ${CAPACITY.maxPlayers + 1}`, async () => {
    const { code } = await setup([]);
    for (let i = 0; i < CAPACITY.maxPlayers; i++) await svc.join(code, `P${i}`);
    await expect(svc.join(code, "One too many")).rejects.toThrow(/full/);
  });

  it("removes kicked players from play and ranking", async () => {
    const { code, hostToken, players } = await setup(["Keep", "Kick"]);
    await svc.hostAction(code, hostToken, "kick", players[1].playerId);
    await expect(poll(code, players[1])).rejects.toThrow(/removed/);
    await svc.hostAction(code, hostToken, "force-start");
    const m = await toPhase(code, "reveal", players.slice(0, 1));
    expect(m.rankedCount).toBe(1);
  });
});

describe("Brief 3: tutorial", () => {
  it("lets the host open, step, decide, reveal, reset and close it; players cannot", async () => {
    const { code, hostToken, players } = await setup(["Lan"]);
    const [p] = players;
    await svc.hostAction(code, hostToken, "tutorial-open");
    let m = await meta(code);
    expect(m.tutorial).toMatchObject({ open: true, step: "inspect", shown: true });
    expect(screenView(m, 1, 1, 0, null, clock.t).tutorial?.case.customer).toMatch(/example customer/);
    await svc.hostAction(code, hostToken, "tutorial-step", undefined, "decide");
    await svc.hostAction(code, hostToken, "tutorial-choose", undefined, "a");
    m = await meta(code);
    const tv = screenView(m, 1, 1, 0, null, clock.t).tutorial!;
    expect(tv.step).toBe("reveal");
    // Both choices follow the live scoring rules on the example balance.
    expect(tv.outcomes.a).toMatchObject({ change: -150_000_000, after: 150_000_000, roi: -0.3 });
    expect(tv.outcomes.d).toMatchObject({ change: 15_000_000, after: 315_000_000 });
    expect(tv.revealed?.correct).toBe("d");
    await svc.hostAction(code, hostToken, "tutorial-reset");
    expect((await meta(code)).tutorial).toMatchObject({ open: true, step: "inspect", choice: null });
    await svc.hostAction(code, hostToken, "tutorial-close");
    expect((await meta(code)).tutorial.open).toBe(false);
    expect((await meta(code)).phase).toBe("lobby"); // closing never starts the game

    for (const action of ["tutorial-open", "tutorial-choose", "tutorial-reset"]) {
      await expect(svc.hostAction(code, p.token, action, undefined, "a")).rejects.toThrow(/Host key/);
    }
    await svc.hostAction(code, hostToken, "tutorial-open");
    const pv = await poll(code, p);
    expect(JSON.stringify(playerView(pv.meta, pv.player, null, clock.t, 1, pv.ready))).not.toMatch(/tutorial|example customer/i);
  });

  it("changes nothing in the competition, and is lobby-only", async () => {
    const { code, hostToken, players } = await setup(["An", "Bảo"]);
    const before = await Promise.all(players.map((p) => rec(code, p)));
    const m0 = await meta(code);
    for (const [a, v] of [["tutorial-open"], ["tutorial-step", "decide"], ["tutorial-choose", "a"], ["tutorial-reset"], ["tutorial-step", "decide"], ["tutorial-choose", "d"], ["tutorial-close"]] as [string, string?][]) {
      await svc.hostAction(code, hostToken, a, undefined, v);
    }
    const after = await Promise.all(players.map((p) => rec(code, p)));
    expect(after).toEqual(before); // balances, quiz assignments, power-ups, status
    const m1 = await meta(code);
    expect([m1.schedule, m1.eliminations, m1.leaderboard, m1.itemIndex, m1.phase]).toEqual([m0.schedule, m0.eliminations, m0.leaderboard, m0.itemIndex, m0.phase]);
    expect(await store.readyIds(code)).toEqual([]);
    await svc.hostAction(code, hostToken, "force-start");
    await expect(svc.hostAction(code, hostToken, "tutorial-open")).rejects.toThrow(/lobby/);
  });

  it("shortens the intro once the host has run the tutorial", async () => {
    const a = await setup(["X"]);
    await svc.hostAction(a.code, a.hostToken, "force-start");
    const plain = await meta(a.code);
    const b = await setup(["Y"]);
    await svc.hostAction(b.code, b.hostToken, "tutorial-open");
    await svc.hostAction(b.code, b.hostToken, "force-start");
    const shown = await meta(b.code);
    expect(plain.phaseEndsAt! - plain.phaseStartedAt).toBe(T.introMs);
    expect(shown.phaseEndsAt! - shown.phaseStartedAt).toBe(T.introAfterTutorialMs);
    expect(shown.tutorial.open).toBe(false);
  });
});

describe("Brief 3: Ready check and start", () => {
  const ready = (code: string, p: P, r = true) => svc.setReady(code, p.playerId, p.token, r);

  it("joins not ready; Ready persists through refresh; repeats change nothing; can be undone in the lobby", async () => {
    const { code, hostToken, players } = await setup(["Chi"]);
    const [p] = players;
    let v = await poll(code, p);
    expect(playerView(v.meta, v.player, null, clock.t, 1, v.ready).me.ready).toBe(false);
    await ready(code, p);
    await ready(code, p);
    v = await poll(code, p); // refresh
    expect(playerView(v.meta, v.player, null, clock.t, 1, v.ready).me.ready).toBe(true);
    const h = await svc.hostSnapshot(code, hostToken);
    const hv = hostView(h.meta, h.players, h.activeIds, 0, clock.t, "memory", h.readyIds);
    expect(hv.players[0].ready).toBe(true);
    expect(hv.lobby).toMatchObject({ total: 1, ready: 1, notReady: 0 });
    await ready(code, p, false);
    expect(await store.readyIds(code)).toEqual([]);
  });

  it("keeps Ready and Connected separate when a ready player goes offline", async () => {
    const { code, hostToken, players } = await setup(["On", "Off"]);
    await ready(code, players[1]);
    clock.advance(61_000);
    await poll(code, players[0]);
    const h = await svc.hostSnapshot(code, hostToken);
    const hv = hostView(h.meta, h.players, h.activeIds, 0, clock.t, "memory", h.readyIds);
    const off = hv.players.find((r) => r.name === "Off")!;
    expect([off.ready, off.active]).toEqual([true, false]);
    expect(hv.lobby).toMatchObject({ total: 2, ready: 1, connected: 1, disconnected: 1 });
  });

  it("Start waits for everyone ready and connected, and never starts on its own", async () => {
    const { code, hostToken, players } = await setup(["A", "B"]);
    await ready(code, players[0]);
    await expect(svc.hostAction(code, hostToken, "start")).rejects.toThrow(/1 not ready/);
    await ready(code, players[1]);
    clock.advance(5_000);
    expect((await svc.tick(code)).phase).toBe("lobby"); // all ready: still waits for the host
    // A ready player who went offline still blocks a normal start (not silently dropped).
    clock.advance(61_000);
    await poll(code, players[0]);
    await expect(svc.hostAction(code, hostToken, "start")).rejects.toThrow(/1 disconnected/);
    await poll(code, players[1]);
    await svc.hostAction(code, hostToken, "start");
    expect((await meta(code)).phase).toBe("intro");
  });

  it("a join landing just before Start keeps the room in the lobby", async () => {
    const { code, hostToken, players } = await setup(["A"]);
    await ready(code, players[0]);
    await svc.join(code, "Newcomer");
    await expect(svc.hostAction(code, hostToken, "start")).rejects.toThrow(/not ready/);
    expect((await meta(code)).phase).toBe("lobby");
  });

  it("Force start brings unready players in without marking them ready; repeated starts do nothing", async () => {
    const { code, hostToken, players } = await setup(["Ready", "Unready"]);
    await ready(code, players[0]);
    await svc.hostAction(code, hostToken, "force-start");
    const m1 = await meta(code);
    await svc.hostAction(code, hostToken, "force-start");
    await svc.hostAction(code, hostToken, "start");
    expect((await meta(code)).seq).toBe(m1.seq);
    expect(await store.readyIds(code)).toEqual([players[0].playerId]);
    const m = await toPhase(code, "open", players);
    const v = await poll(code, players[1]);
    expect(playerView(v.meta, v.player, null, clock.t, 2, v.ready).item?.case).toBeDefined();
    await svc.submit(code, players[1].playerId, players[1].token, m.itemIndex, "d");
    for (const p of players) expect((await rec(code, p)).balance).toBe(ECONOMY.startingBalance);
  });

  it("closes admission once play starts, keeps reconnection, and freezes readiness", async () => {
    const { code, hostToken, players } = await setup(["In"]);
    await svc.hostAction(code, hostToken, "force-start");
    await expect(svc.join(code, "Late")).rejects.toThrow(/already started/);
    await expect(svc.join(code, "In again")).rejects.toThrow(/already started/);
    expect((await poll(code, players[0])).player.name).toBe("In"); // reconnect still works
    await expect(ready(code, players[0])).rejects.toThrow(/started/);
    await svc.hostAction(code, hostToken, "pause");
    await svc.hostAction(code, hostToken, "continue");
    expect((await meta(code)).phase).toBe("intro");
  });

  it("a new session starts with no readiness and a closed tutorial", async () => {
    const a = await setup(["Old"]);
    await svc.setReady(a.code, a.players[0].playerId, a.players[0].token, true);
    await svc.hostAction(a.code, a.hostToken, "tutorial-open");
    const b = await setup(["New"]);
    expect(await store.readyIds(b.code)).toEqual([]);
    expect((await meta(b.code)).tutorial).toEqual({ open: false, step: "inspect", choice: null, shown: false });
  });
});
