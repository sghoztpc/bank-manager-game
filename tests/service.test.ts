import { beforeEach, describe, expect, it } from "vitest";
import { CAPACITY, ECONOMY, ELIMINATION, FINAL_QUESTION_BONUS, MIN_RESUME_MS, NETWORK, timing } from "@/lib/config";
import { getQuizQuestion } from "@/lib/engine/quiz";
import { buildSchedule, getCase } from "@/lib/engine/schedule";
import { correctChoice } from "@/lib/engine/scoring";
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
    await svc.hostAction(code, hostToken, "start");
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
    await svc.hostAction(code, hostToken, "start");
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

  it("grades by option id after shuffling, once, and never penalises a wrong answer", async () => {
    const { code, hostToken, players } = await setup(["Chi", "Dũng"]);
    await svc.hostAction(code, hostToken, "start");
    const m = await toPhase(code, "question", players);
    const [right, wrong] = players;
    const qr = getQuizQuestion((await rec(code, right)).quiz[0].questionId);
    const qw = getQuizQuestion((await rec(code, wrong)).quiz[0].questionId);
    const before = (await rec(code, wrong)).balance;
    await svc.submit(code, right.playerId, right.token, m.itemIndex, qr.answerIndex);
    expect(await svc.submit(code, right.playerId, right.token, m.itemIndex, (qr.answerIndex + 1) % 4)).toMatchObject({ duplicate: true });
    await svc.submit(code, wrong.playerId, wrong.token, m.itemIndex, (qw.answerIndex + 1) % 4);
    await toPhase(code, "qreveal", players);
    const r = await rec(code, right);
    const w = await rec(code, wrong);
    expect(r.inventory).toHaveLength(1);
    expect(w.inventory).toHaveLength(0);
    expect(w.balance).toBe(before);
    const pr = await poll(code, right);
    expect(playerView(pr.meta, pr.player, null, clock.t, 2).item?.answer?.id).toBe(qr.answerIndex);
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
    await svc.hostAction(code, hostToken, "start");
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
    await svc.hostAction(code, hostToken, "start");
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

  it("does not wait for eliminated players before closing early", async () => {
    const { code, hostToken, players } = await setup(["Out", "In"]);
    await adjust(code, hostToken, players[0], "subtract", ECONOMY.startingBalance);
    await svc.hostAction(code, hostToken, "start");
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
    await expect(svc.hostAction(code, p.token, "start")).rejects.toThrow(/Host key/);
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
    await svc.hostAction(code, hostToken, "start");
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
    await svc.hostAction(code, hostToken, "start");
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
    await svc.hostAction(code, hostToken, "start");
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
    await svc.hostAction(s.code, s.hostToken, "start");
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
    await svc.hostAction(code, hostToken, "start");
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
    await svc.hostAction(code, hostToken, "start");
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
    await svc.hostAction(code, hostToken, "start");
    const m = await toPhase(code, "reveal", players.slice(0, 1));
    expect(m.rankedCount).toBe(1);
  });
});
