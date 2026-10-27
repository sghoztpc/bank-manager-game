import { beforeEach, describe, expect, it } from "vitest";
import { CAPACITY, ECONOMY, FINAL_QUESTION_BONUS, NETWORK, timing } from "@/lib/config";
import { getCase, getQuestion } from "@/lib/engine/schedule";
import { correctChoice } from "@/lib/engine/scoring";
import { GameService } from "@/lib/game/service";
import { playerView } from "@/lib/game/views";
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

async function setup(names: string[]) {
  const { code, hostToken } = await svc.createSession(42);
  const players = [];
  for (const n of names) players.push({ ...(await svc.join(code, n)), raw: n });
  return { code, hostToken, players };
}

const meta = async (code: string) => (await store.getMeta(code)) as SessionMeta;

/** Polls every player (keeps them active), then advances the clock to the end of the phase. */
async function pollAll(code: string, players: { playerId: string; token: string }[], first = false) {
  for (const p of players) await svc.playerPoll(code, p.playerId, p.token, { heartbeat: true, firstView: first });
}

async function toPhase(code: string, phase: string, players: { playerId: string; token: string }[] = []) {
  for (let i = 0; i < 200; i++) {
    const m = await svc.tick(code);
    if (m.phase === phase) return m;
    clock.advance(Math.max(1, (m.phaseEndsAt ?? clock.t) - clock.t));
    await pollAll(code, players);
  }
  throw new Error(`never reached ${phase}`);
}

describe("session flow", () => {
  it("runs every interaction in order, resolving decisions before the bonus question that follows", async () => {
    const { code, hostToken, players } = await setup(["An", "Bình"]);
    await svc.hostAction(code, hostToken, "start");
    expect((await meta(code)).phase).toBe("intro");

    const seen: string[] = [];
    let last = "";
    for (let i = 0; i < 400; i++) {
      const m = await svc.tick(code);
      const key = `${m.itemIndex}:${m.phase}`;
      if (key !== last) {
        seen.push(key);
        last = key;
      }
      if (m.phase === "final") break;
      clock.advance(Math.max(1, (m.phaseEndsAt ?? clock.t) - clock.t));
    }
    const m = await meta(code);
    expect(m.status).toBe("finished");
    // 24 decisions x (ready, open, reveal) + 5 questions x (question, qreveal) + intro + final
    expect(seen).toHaveLength(1 + 24 * 3 + 5 * 2 + 1);

    // Nobody answered: every decision timed out (decline / block), questions earned nothing.
    for (const p of players) {
      const rec = (await store.getPlayer(code, p.playerId))!;
      expect(rec.history).toHaveLength(29);
      expect(rec.history.filter((h) => h.c === null)).toHaveLength(29);
      expect(rec.correct).toBe(0);
      expect(rec.inventory).toHaveLength(0);
    }
  });

  it("resolves decision 20 before question 4 and decision 24 before question 5, which pays money only", async () => {
    const { code, hostToken, players } = await setup(["Chi"]);
    const [p] = players;
    await svc.hostAction(code, hostToken, "start");
    const sched = (await meta(code)).schedule;

    for (let i = 0; i < sched.length; i++) {
      const item = sched[i];
      if (item.type === "decision") {
        const m = await toPhase(code, "open", players);
        expect(m.itemIndex).toBe(i);
        await svc.submit(code, p.playerId, p.token, i, correctChoice(getCase(item.caseId)));
      } else {
        const m = await toPhase(code, "question", players);
        expect(m.itemIndex).toBe(i);
        // The decision right before must already be in the player's history.
        const rec = (await store.getPlayer(code, p.playerId))!;
        expect(rec.history.at(-1)!.i).toBe(i - 1);
        await svc.submit(code, p.playerId, p.token, i, getQuestion(item.questionId).answerIndex);
      }
    }
    await toPhase(code, "final", players);
    const rec = (await store.getPlayer(code, p.playerId))!;
    expect(rec.correct).toBe(24 + 0); // questions do not count as decisions
    expect(rec.inventory.map((t) => t.source)).toEqual(["Q1", "Q2", "Q3", "Q4"]);
    const q5 = rec.history.find((h) => h.i === sched.length - 1)!;
    expect(q5).toMatchObject({ ok: true, delta: FINAL_QUESTION_BONUS });
    expect(rec.balance).toBe(ECONOMY.startingBalance + rec.history.reduce((a, h) => a + h.delta, 0));
  });
});

describe("decisions", () => {
  async function openFirstCase(names = ["Dũng"]) {
    const s = await setup(names);
    await svc.hostAction(s.code, s.hostToken, "start");
    const m = await toPhase(s.code, "open", s.players);
    return { ...s, m };
  }

  it("rejects duplicate submissions and keeps the first choice", async () => {
    const { code, players, m } = await openFirstCase(["Dũng", "Em"]);
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
    const rec = (await store.getPlayer(code, p.playerId))!;
    expect(rec.history[0].speedBonus).toBe(0);
    expect(rec.history[0].c).toBe("a");
    const late = (await store.getPlayer(code, q.playerId))!;
    expect(late.history[0].c).toBe(null);
  });

  it("gives no speed bonus between 15 and 20 seconds, and the tier bonus before", async () => {
    const { code, players, m } = await openFirstCase(["Khoa", "Lan"]);
    const c = getCase((m.schedule[m.itemIndex] as { caseId: string }).caseId);
    const right = correctChoice(c);
    const [fast, slow] = players;
    clock.t = m.openedAt! + 4_000;
    await svc.submit(code, fast.playerId, fast.token, m.itemIndex, right);
    clock.t = m.openedAt! + 15_500;
    await svc.submit(code, slow.playerId, slow.token, m.itemIndex, right);
    await toPhase(code, "reveal", []);
    const f = (await store.getPlayer(code, fast.playerId))!.history[0];
    const s = (await store.getPlayer(code, slow.playerId))!.history[0];
    expect(f.speedBonus).toBeGreaterThan(0);
    expect(s.speedBonus).toBe(0);
    expect(f.delta - f.speedBonus).toBe(s.delta);
  });

  it("starts a player's clock when the case reaches their phone (capped at 2 s)", async () => {
    const { code, players, m } = await openFirstCase(["Minh", "Nga"]);
    const c = getCase((m.schedule[m.itemIndex] as { caseId: string }).caseId);
    const [p, q] = players;
    clock.t = m.openedAt! + 1_500;
    await svc.playerPoll(code, p.playerId, p.token, { heartbeat: true, firstView: true });
    clock.t = m.openedAt! + 6_200; // 4.7 s after p saw it, 6.2 s after it opened
    await svc.submit(code, p.playerId, p.token, m.itemIndex, correctChoice(c));
    await svc.submit(code, q.playerId, q.token, m.itemIndex, correctChoice(c));
    await toPhase(code, "reveal", []);
    expect((await store.getPlayer(code, p.playerId))!.history[0].ms).toBe(4_700);
    expect((await store.getPlayer(code, q.playerId))!.history[0].ms).toBe(6_200);
  });

  it("closes early once every active player has answered", async () => {
    const { code, players, m } = await openFirstCase(["Oanh", "Phú"]);
    await svc.submit(code, players[0].playerId, players[0].token, m.itemIndex, "a");
    expect((await meta(code)).phase).toBe("open");
    await svc.submit(code, players[1].playerId, players[1].token, m.itemIndex, "d");
    expect((await meta(code)).phase).toBe("reveal");
  });

  it("does not wait for disconnected players", async () => {
    const { code, players, m } = await openFirstCase(["Quân", "Sơn"]);
    clock.advance(NETWORK.activeWindowMs + 1);
    await svc.playerPoll(code, players[0].playerId, players[0].token, { heartbeat: true, firstView: false });
    await svc.submit(code, players[0].playerId, players[0].token, m.itemIndex, "a");
    expect((await meta(code)).phase).toBe("reveal");
    // The absent player still gets the timeout outcome.
    expect((await store.getPlayer(code, players[1].playerId))!.history[0].c).toBe(null);
  });

  it("does not count paused time and refuses answers while paused", async () => {
    const { code, hostToken, players, m } = await openFirstCase(["Tâm", "Uyên"]);
    const [p] = players;
    clock.t = m.openedAt! + 3_000;
    await svc.hostAction(code, hostToken, "pause");
    clock.advance(60_000);
    expect((await svc.tick(code)).phase).toBe("open");
    await expect(svc.submit(code, p.playerId, p.token, m.itemIndex, "a")).rejects.toThrow(/paused/);
    await svc.hostAction(code, hostToken, "resume");
    clock.advance(1_000);
    await svc.submit(code, p.playerId, p.token, m.itemIndex, "a");
    await svc.hostAction(code, hostToken, "skip");
    expect((await store.getPlayer(code, p.playerId))!.history[0].ms).toBe(4_000);
  });

  it("never sends the answer to players before the reveal", async () => {
    const { code, players, m } = await openFirstCase(["Vy"]);
    const [p] = players;
    const poll = await svc.playerPoll(code, p.playerId, p.token, { heartbeat: true, firstView: true });
    const view = playerView(poll.meta, poll.player, poll.submission, clock.t, 1);
    expect(view.item?.case).toBeDefined();
    expect(view.item?.revealed).toBeUndefined();
    expect(JSON.stringify(view)).not.toMatch(/"signal"|"story"|"explanation"|"truth"/);
    await svc.submit(code, p.playerId, p.token, m.itemIndex, "a");
    const after = await svc.playerPoll(code, p.playerId, p.token, { heartbeat: true, firstView: false });
    const v2 = playerView(after.meta, after.player, after.submission, clock.t, 1);
    expect(v2.phase).toBe("reveal");
    expect(v2.item?.revealed?.correct).toMatch(/a|d/);
    expect(v2.me.result).not.toBeNull();
  });

  it("hides the case content during the get-ready countdown", async () => {
    const s = await setup(["Xuân"]);
    await svc.hostAction(s.code, s.hostToken, "start");
    const m = await toPhase(s.code, "ready", s.players);
    const poll = await svc.playerPoll(s.code, s.players[0].playerId, s.players[0].token, { heartbeat: true, firstView: false });
    expect(playerView(poll.meta, poll.player, null, clock.t, 1).item?.case).toBeUndefined();
    expect(m.phaseEndsAt! - m.phaseStartedAt).toBe(T.readyMs);
  });
});

describe("players", () => {
  it("restores the same identity and progress with the stored token", async () => {
    const { code, hostToken, players } = await setup(["Yến"]);
    const [p] = players;
    await svc.hostAction(code, hostToken, "start");
    const m = await toPhase(code, "open", players);
    await svc.submit(code, p.playerId, p.token, m.itemIndex, "a");
    // "Refresh": a brand-new request with the saved id and token.
    const again = await svc.playerPoll(code, p.playerId, p.token, { heartbeat: true, firstView: false });
    expect(again.player.name).toBe("Yến");
    await expect(svc.playerPoll(code, p.playerId, "wrong", { heartbeat: true, firstView: false })).rejects.toThrow(/Not a player/);
  });

  it("deduplicates nicknames case-insensitively", async () => {
    const { code } = await setup([]);
    expect((await svc.join(code, "Lan")).name).toBe("Lan");
    expect((await svc.join(code, "lan")).name).toBe("lan 2");
    expect((await svc.join(code, "  <b>Lan</b> ")).name).toBe("bLan/b");
  });

  it(`refuses player ${CAPACITY.maxPlayers + 1}`, async () => {
    const { code } = await setup([]);
    for (let i = 0; i < CAPACITY.maxPlayers; i++) await svc.join(code, `P${i}`);
    await expect(svc.join(code, "One too many")).rejects.toThrow(/full/);
  });

  it("scores late joiners only from the case they joined on", async () => {
    const { code, hostToken, players } = await setup(["Early"]);
    await svc.hostAction(code, hostToken, "start");
    await toPhase(code, "reveal", players);
    const late = await svc.join(code, "Late");
    const rec = (await store.getPlayer(code, late.playerId))!;
    expect(rec.joinedAtItem).toBe(1);
    await toPhase(code, "ready", [...players, late]);
    await toPhase(code, "reveal", [...players, late]);
    const after = (await store.getPlayer(code, late.playerId))!;
    expect(after.history.map((h) => h.i)).toEqual([1]);
  });

  it("removes kicked players from play and ranking", async () => {
    const { code, hostToken, players } = await setup(["Keep", "Kick"]);
    await svc.hostAction(code, hostToken, "kick", players[1].playerId);
    await expect(svc.playerPoll(code, players[1].playerId, players[1].token, { heartbeat: true, firstView: false })).rejects.toThrow(
      /removed/,
    );
    await svc.hostAction(code, hostToken, "start");
    const m = await toPhase(code, "reveal", players.slice(0, 1));
    expect(m.rankedCount).toBe(1);
  });
});
