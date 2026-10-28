import { createHash, randomBytes, randomInt } from "node:crypto";
import { ADJUSTMENT_MAX, CAPACITY, ECONOMY, ELIMINATION, LOBBY_CONNECTED_WINDOW_MS, NETWORK, timeScale, timing, type Timing } from "../config";
import { applyBalanceChange, floorActive, previewBalanceChange } from "../engine/elimination";
import { decisionClosesAt, nextPhase, pause, resume } from "../engine/phases";
import { assignQuiz } from "../engine/quiz";
import { displayOrder, toLeaderEntry } from "../engine/ranking";
import { buildSchedule } from "../engine/schedule";
import { getStore } from "../store";
import type { Store } from "../store/types";
import type { AdjustmentRecord, Announcement, EliminationRecord, PlayerRecord, SessionMeta, Submission } from "../types";
import { resolveItem, standings } from "./resolve";

export class GameError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CODE_LENGTH = 5;
const LOCK_TTL_MS = 10_000;
/** Catch-up limit per request when nobody polled for a while. */
const MAX_STEPS_PER_TICK = 40;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");
const newToken = () => randomBytes(24).toString("base64url");

function newCode(): string {
  let code = "";
  for (let i = 0; i < CODE_LENGTH; i++) code += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return code;
}

export function normaliseCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, CODE_LENGTH);
}

export function cleanNickname(raw: unknown): string {
  if (typeof raw !== "string") return "";
  return raw
    .normalize("NFC")
    .replace(/[\p{C}<>]/gu, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 16);
}

/** Phases in which a case or quiz is on players' screens: no projector interruptions then. */
const LIVE_PHASES = new Set(["ready", "open", "question"]);

function announcementsFor(added: EliminationRecord[], countBefore: number, countAfter: number): Announcement[] {
  const out: Announcement[] = added.map((e) => ({
    id: `elim-${e.order}`,
    kind: "elimination",
    text: `${e.name} is out: elimination ${e.order} of ${ELIMINATION.quota} (${e.cause})`,
    showFrom: null,
  }));
  if (countBefore < ELIMINATION.quota && countAfter >= ELIMINATION.quota) {
    out.push({
      id: "floor",
      kind: "floor",
      text: `All ${ELIMINATION.quota} eliminations are used. Every remaining bank now has a ${ELIMINATION.safetyFloor} VND safety floor.`,
      showFrom: null,
    });
  }
  return out;
}

/** Host tutorial controls. Pure: the demonstration only ever changes its own small state. */
function nextTutorial(t: SessionMeta["tutorial"], action: string, value: unknown): SessionMeta["tutorial"] {
  switch (action) {
    case "tutorial-open":
      return { ...t, open: true, shown: true };
    case "tutorial-close":
      return { ...t, open: false };
    case "tutorial-reset":
      return { ...t, open: true, step: "inspect", choice: null };
    case "tutorial-step":
      if (value !== "inspect" && value !== "decide") throw new GameError(400, "Unknown tutorial step.");
      return { ...t, open: true, step: value, choice: null };
    case "tutorial-choose":
      if (value !== "a" && value !== "d") throw new GameError(400, "Choose approve or decline.");
      return { ...t, open: true, step: "reveal", choice: value };
  }
  return t;
}

/** Announcements wait until the projector is not showing a case or quiz. */
function releaseAnnouncements(meta: SessionMeta, now: number): SessionMeta {
  if (LIVE_PHASES.has(meta.phase) || meta.announcements.every((a) => a.showFrom !== null)) return meta;
  return { ...meta, announcements: meta.announcements.map((a) => (a.showFrom === null ? { ...a, showFrom: now } : a)) };
}

/** Untrusted request body: { id, playerId, op, amount, reason }. */
export type AdjustmentInput = Record<string, unknown>;

function parseAdjustment(input: AdjustmentInput) {
  const id = typeof input.id === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(input.id) ? input.id : null;
  if (!id) throw new GameError(400, "Missing adjustment id.");
  if (typeof input.playerId !== "string") throw new GameError(400, "Choose a player.");
  if (input.op !== "add" && input.op !== "subtract") throw new GameError(400, "Choose add or subtract.");
  const amount = typeof input.amount === "number" ? input.amount : Number(input.amount);
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > ADJUSTMENT_MAX) {
    throw new GameError(400, `Enter a whole VND amount from 1 to ${ADJUSTMENT_MAX.toLocaleString("vi-VN")}.`);
  }
  const reason = typeof input.reason === "string" ? input.reason.replace(/[\p{C}<>]/gu, "").trim().slice(0, 120) : "";
  if (!reason) throw new GameError(400, "Record a reason for the adjustment.");
  return { id, playerId: input.playerId, op: input.op as "add" | "subtract", amount, reason };
}

export class GameService {
  constructor(
    private store: Store = getStore(),
    private now: () => number = Date.now,
  ) {}

  private timingFor(meta: SessionMeta): Timing {
    return timing(meta.scale);
  }

  // ---------- Session lifecycle ----------

  async createSession(seed?: number): Promise<{ code: string; hostToken: string }> {
    const hostToken = newToken();
    const scale = timeScale();
    for (let attempt = 0; attempt < 20; attempt++) {
      const code = newCode();
      const s = seed ?? randomInt(2 ** 31);
      const meta: SessionMeta = {
        code,
        seq: 0,
        createdAt: this.now(),
        hostTokenHash: hashToken(hostToken),
        seed: s,
        scale,
        schedule: buildSchedule(s),
        status: "lobby",
        phase: "lobby",
        itemIndex: 0,
        phaseStartedAt: this.now(),
        phaseEndsAt: null,
        openedAt: null,
        pausedRemainingMs: null,
        pausedAt: null,
        lastReveal: null,
        leaderboard: [],
        eliminatedBoard: [],
        rankedCount: 0,
        eliminations: [],
        adjustments: [],
        announcements: [],
        settings: { announceEliminations: true, announceDismissedAt: null, boardOnScreen: false },
        tutorial: { open: false, step: "inspect", choice: null, shown: false },
        podiumRevealed: false,
        endedEarly: false,
      };
      if (await this.store.createMeta(meta)) return { code, hostToken };
    }
    throw new GameError(503, "Could not allocate a room code. Try again.");
  }

  async join(code: string, rawName: unknown): Promise<{ playerId: string; token: string; name: string }> {
    const meta = await this.tick(code);
    // Brief 3: admission closes when play starts, so nobody (an eliminated player included) can
    // come back as a fresh bank. Existing players reconnect with their saved identity instead.
    if (meta.phase !== "lobby") throw new GameError(409, "This game has already started, so new players can't join. If you joined earlier, reopen the link on the same phone.");
    const base = cleanNickname(rawName);
    if (base.length < 1) throw new GameError(400, "Enter a nickname.");

    let name = base;
    let claimed = false;
    for (let n = 2; n < 200 && !claimed; n++) {
      claimed = await this.store.claimName(code, name.toLocaleLowerCase("vi"));
      if (!claimed) name = `${base.slice(0, 13)} ${n}`;
    }
    if (!claimed) throw new GameError(409, "That nickname is taken. Try another.");

    const token = newToken();
    const id = randomBytes(9).toString("base64url");
    // Everyone joins in the lobby now; the field stays for records from older sessions.
    const joinedAtItem = -1;
    const player: PlayerRecord = {
      id,
      name,
      tokenHash: hashToken(token),
      joinedAt: this.now(),
      joinedAtItem,
      kicked: false,
      status: "active",
      eliminationOrder: null,
      balance: ECONOMY.startingBalance,
      correct: 0,
      correctMs: 0,
      lastResolved: joinedAtItem < 0 ? -1 : joinedAtItem - 1,
      rank: null,
      prevRank: null,
      history: [],
      inventory: [],
      quiz: assignQuiz(meta.seed, id),
    };
    if (!(await this.store.addPlayer(player, code, CAPACITY.maxPlayers))) {
      await this.store.releaseName(code, name.toLocaleLowerCase("vi"));
      throw new GameError(409, `This room is full (${CAPACITY.maxPlayers} players).`);
    }
    await this.store.touch(code, player.id, this.now());
    return { playerId: player.id, token, name };
  }

  // ---------- Clock ----------

  /** Brings the session clock up to date. Every request calls this first; no background job is needed. */
  async tick(code: string, known?: SessionMeta | null): Promise<SessionMeta> {
    let meta = known ?? (await this.store.getMeta(code));
    if (!meta) throw new GameError(404, "No game with that code.");
    for (let step = 0; step < MAX_STEPS_PER_TICK; step++) {
      if (!this.isDue(meta, this.now())) break;
      meta = await this.advance(meta, (m) => this.isDue(m, this.now()));
    }
    return meta;
  }

  private isDue(meta: SessionMeta, now: number): boolean {
    // Strictly after: a submission landing exactly on the deadline is still accepted.
    return meta.status === "running" && meta.phaseEndsAt !== null && now > meta.phaseEndsAt;
  }

  /**
   * Moves the session to its next phase, resolving the item being left. Exactly one caller wins
   * the lock for a given seq; the others re-read and see the winner's result.
   */
  private async advance(
    seen: SessionMeta,
    shouldAdvance: (fresh: SessionMeta) => boolean,
    mutate?: (fresh: SessionMeta) => SessionMeta | Promise<SessionMeta>,
  ): Promise<SessionMeta> {
    const lockKey = `${seen.code}:${seen.seq}`;
    if (!(await this.store.lock(lockKey, LOCK_TTL_MS))) {
      await new Promise((r) => setTimeout(r, 120));
      return (await this.store.getMeta(seen.code)) ?? seen;
    }
    try {
      const fresh = await this.store.getMeta(seen.code);
      if (!fresh || fresh.seq !== seen.seq || !shouldAdvance(fresh)) return fresh ?? seen;
      const now = this.now();
      let next: SessionMeta;
      if (mutate) {
        next = { ...(await mutate(fresh)), seq: fresh.seq + 1 };
      } else {
        next = { ...fresh, ...nextPhase(fresh, now, this.timingFor(fresh)), seq: fresh.seq + 1 };
        if (fresh.phase === "open" || fresh.phase === "question") next = await this.resolve(fresh, next);
      }
      next = releaseAnnouncements(next, now);
      await this.store.putMeta(next);
      return next;
    } finally {
      await this.store.unlock(lockKey);
    }
  }

  private async resolve(fresh: SessionMeta, next: SessionMeta): Promise<SessionMeta> {
    const { code } = fresh;
    const i = fresh.itemIndex;
    await this.store.closeItem(code, i);
    const [players, subs, views] = await Promise.all([
      this.store.getPlayers(code),
      this.store.getSubmissions(code, i),
      fresh.phase === "open" ? this.store.getViews(code, i) : Promise.resolve({}),
    ]);
    // Timeouts happen when the window closes: its deadline, or now if it closed early (never a
    // future time). Every accepted submission was received no later than this.
    const closesAt = fresh.phase === "open" && fresh.openedAt !== null ? decisionClosesAt(fresh.openedAt, this.timingFor(fresh)) : (fresh.phaseEndsAt ?? this.now());
    const deadlineAt = Math.min(closesAt, this.now());
    const eliminations = [...fresh.eliminations];
    const res = resolveItem(fresh, i, players, subs, views, deadlineAt, eliminations);
    await this.store.putPlayers(code, res.players);
    return {
      ...next,
      lastReveal: res.stats,
      leaderboard: res.leaderboard,
      eliminatedBoard: res.eliminatedBoard,
      rankedCount: res.rankedCount,
      eliminations,
      announcements: [...next.announcements, ...announcementsFor(res.newEliminations, fresh.eliminations.length, eliminations.length)],
    };
  }

  /** Settles the item in progress (if any) and freezes the session as final. */
  private async finish(f: SessionMeta): Promise<SessionMeta> {
    const now = this.now();
    const settled = f.phase === "open" || f.phase === "question" ? await this.resolve(f, f) : f;
    return {
      ...settled,
      status: "finished",
      phase: "final",
      phaseStartedAt: now,
      phaseEndsAt: null,
      openedAt: null,
      pausedAt: null,
      pausedRemainingMs: null,
      endedEarly: f.phase !== "qreveal" || f.itemIndex < f.schedule.length - 1,
    };
  }

  // ---------- Players ----------

  async authPlayer(code: string, playerId: string, token: string): Promise<[SessionMeta, PlayerRecord]> {
    const [meta, player] = await this.store.getMetaAndPlayer(code, playerId);
    if (!meta) throw new GameError(404, "No game with that code.");
    if (!player || player.tokenHash !== hashToken(token)) throw new GameError(401, "Not a player in this game.");
    if (player.kicked) throw new GameError(403, "The host removed you from this game.");
    return [meta, player];
  }

  async authHost(code: string, token: string): Promise<SessionMeta> {
    const meta = await this.store.getMeta(code);
    if (!meta) throw new GameError(404, "No game with that code.");
    if (meta.hostTokenHash !== hashToken(token)) throw new GameError(401, "Host key does not match.");
    return meta;
  }

  /** Player poll: heartbeat, first-view stamp, then the up-to-date session. */
  async playerPoll(code: string, playerId: string, token: string, opts: { heartbeat: boolean; firstView: boolean }) {
    const [known, player] = await this.authPlayer(code, playerId, token);
    const meta = await this.tick(code, known);
    const now = this.now();
    const tasks: Promise<unknown>[] = [];
    if (opts.heartbeat) tasks.push(this.store.touch(code, playerId, now));
    if (opts.firstView && meta.phase === "open" && meta.status === "running" && meta.openedAt !== null) {
      tasks.push(this.store.markViewed(code, meta.itemIndex, playerId, Math.max(0, now - meta.openedAt)));
    }
    const needsSub = meta.phase === "open" || meta.phase === "question";
    const [sub, ready] = await Promise.all([
      needsSub ? this.store.getSubmission(code, meta.itemIndex, playerId) : null,
      meta.phase === "lobby" ? this.store.readyIds(code) : null,
      ...tasks,
    ]);
    // The player record is only rewritten on resolution; re-read it if one just happened.
    const fresh = meta.seq !== known.seq ? ((await this.store.getPlayer(code, playerId)) ?? player) : player;
    return { meta, player: fresh, submission: sub as Submission | null, ready: ready ? (ready as string[]).includes(playerId) : null };
  }

  async submit(code: string, playerId: string, token: string, itemIndex: number, choice: unknown) {
    const receivedAt = this.now();
    const [known, player] = await this.authPlayer(code, playerId, token);
    const meta = await this.tick(code, known);
    if (meta.itemIndex !== itemIndex || (meta.phase !== "open" && meta.phase !== "question")) {
      throw new GameError(409, "This case is closed.");
    }
    if (meta.status === "paused") throw new GameError(409, "The game is paused.");
    if (player.status === "eliminated") throw new GameError(409, "Your bank has been eliminated, so it cannot take decisions.");
    if (player.joinedAtItem > itemIndex) throw new GameError(409, "You joined after this case started.");

    const item = meta.schedule[itemIndex];
    let elapsedMs: number;
    if (item.type === "decision") {
      if (choice !== "a" && choice !== "d") throw new GameError(400, "Choose approve or decline.");
      if (meta.openedAt === null || receivedAt < meta.openedAt) throw new GameError(409, "This case is not open yet.");
      if (receivedAt > decisionClosesAt(meta.openedAt, this.timingFor(meta))) throw new GameError(409, "Time is up for this case.");
      elapsedMs = receivedAt - meta.openedAt;
    } else {
      // The choice is the option's id (its source index), not its position on this player's screen.
      const q = typeof choice === "number" && Number.isInteger(choice) ? choice : -1;
      if (q < 0 || q > 3) throw new GameError(400, "Choose one of the answers.");
      if (meta.phaseEndsAt !== null && receivedAt > meta.phaseEndsAt + NETWORK.latencyGraceMs) {
        throw new GameError(409, "Time is up for this question.");
      }
      elapsedMs = receivedAt - meta.phaseStartedAt;
    }

    const result = await this.store.submit(code, itemIndex, playerId, { choice: choice as Submission["choice"], receivedAt, elapsedMs });
    if (result === "closed") throw new GameError(409, "This case is closed.");
    if (result === "duplicate") {
      const existing = await this.store.getSubmission(code, itemIndex, playerId);
      return { accepted: false, duplicate: true, choice: existing?.choice ?? null };
    }
    await this.closeEarlyIfAllAnswered(meta);
    return { accepted: true, duplicate: false, choice };
  }

  /** Ends the window as soon as every connected, eligible player has answered. */
  private async closeEarlyIfAllAnswered(meta: SessionMeta) {
    const i = meta.itemIndex;
    const [subs, active] = await Promise.all([
      this.store.getSubmissions(meta.code, i),
      this.store.activeSince(meta.code, this.now() - NETWORK.activeWindowMs),
    ]);
    const out = new Set(meta.eliminations.map((e) => e.playerId));
    const waitingOn = active.filter((id) => !out.has(id));
    if (waitingOn.length > 0 && waitingOn.every((id) => id in subs)) {
      await this.advance(meta, (f) => f.status === "running" && f.itemIndex === i && (f.phase === "open" || f.phase === "question"));
    }
  }

  // ---------- Host ----------

  async hostAction(code: string, token: string, action: string, playerId?: string, value?: unknown): Promise<SessionMeta> {
    let meta = await this.tick(code, await this.authHost(code, token));
    const now = () => this.now();
    for (let attempt = 0; attempt < 5; attempt++) {
      const before = meta.seq;
      switch (action) {
        case "start":
        case "force-start": {
          // Checked against current state under the session lock: a join or Ready change that
          // lands first keeps the room in the lobby. Only one start can ever commit.
          if (meta.phase !== "lobby") return meta;
          const force = action === "force-start";
          meta = await this.advance(
            meta,
            (f) => f.phase === "lobby",
            async (f) => {
              const s = await this.lobbyStatus(code);
              if (s.connected === 0) throw new GameError(409, "No player is connected yet.");
              if (!force && (s.notReady > 0 || s.disconnected > 0)) {
                throw new GameError(409, `Not everyone is ready: ${s.notReady} not ready, ${s.disconnected} disconnected. Wait, or use Force start.`);
              }
              const t = this.timingFor(f);
              const started = { ...f, ...nextPhase(f, now(), t) };
              return {
                ...started,
                phaseEndsAt: now() + (f.tutorial.shown ? t.introAfterTutorialMs : t.introMs),
                tutorial: { ...f.tutorial, open: false, choice: null, step: "inspect" },
              };
            },
          );
          break;
        }
        case "tutorial-open":
        case "tutorial-close":
        case "tutorial-step":
        case "tutorial-choose":
        case "tutorial-reset":
          if (meta.phase !== "lobby") throw new GameError(409, "The tutorial is available in the lobby, before the game starts.");
          meta = await this.advance(meta, (f) => f.phase === "lobby", (f) => ({ ...f, tutorial: nextTutorial(f.tutorial, action, value) }));
          break;
        case "skip":
          // Ends the current phase now (closing an open case resolves it with whatever arrived).
          if (meta.status !== "running" || meta.phase === "lobby" || meta.phase === "final") return meta;
          meta = await this.advance(meta, (f) => f.status === "running" && f.seq === before);
          break;
        case "pause":
          if (meta.status !== "running") return meta;
          meta = await this.advance(meta, (f) => f.status === "running", (f) => pause(f, now()));
          break;
        case "resume":
        case "continue":
          if (meta.status !== "paused") return meta;
          meta = await this.advance(meta, (f) => f.status === "paused", (f) => resume(f, now(), this.timingFor(f)));
          break;
        case "end":
          // Explicit end: settle whatever is open, then freeze the results as final.
          if (meta.phase === "final") return meta;
          meta = await this.advance(meta, (f) => f.phase !== "final", (f) => this.finish(f));
          break;
        case "reveal-podium":
          if (meta.phase !== "final") throw new GameError(409, "The podium can be revealed once the game has ended.");
          if (meta.podiumRevealed) return meta;
          meta = await this.advance(meta, (f) => f.phase === "final" && !f.podiumRevealed, (f) => ({ ...f, podiumRevealed: true }));
          break;
        case "board":
          meta = await this.advance(meta, () => true, (f) => ({ ...f, settings: { ...f.settings, boardOnScreen: value === true } }));
          break;
        case "announcements":
          meta = await this.advance(meta, () => true, (f) => ({ ...f, settings: { ...f.settings, announceEliminations: value === true } }));
          break;
        case "dismiss":
          meta = await this.advance(meta, () => true, (f) => ({ ...f, settings: { ...f.settings, announceDismissedAt: now() } }));
          break;
        case "kick": {
          if (!playerId) throw new GameError(400, "Missing player.");
          // Under the session lock, so a resolution in progress cannot write the player back.
          let done = false;
          meta = await this.advance(meta, () => true, async (f) => {
            await this.kick(code, playerId);
            done = true;
            return f;
          });
          if (done) return meta;
          break;
        }
        default:
          throw new GameError(400, `Unknown action ${action}.`);
      }
      if (meta.seq !== before) return meta;
      meta = await this.tick(code);
    }
    return meta;
  }

  /** What an adjustment would do, shown to the host before they confirm it. Changes nothing. */
  async previewAdjustment(code: string, token: string, input: AdjustmentInput) {
    const meta = await this.tick(code, await this.authHost(code, token));
    const a = parseAdjustment(input);
    const p = await this.store.getPlayer(code, a.playerId);
    if (!p || p.kicked) throw new GameError(404, "That player is not in this game.");
    const refusal = this.adjustmentRefusal(meta, p, a.op);
    const change = a.op === "add" ? a.amount : -a.amount;
    const pv = previewBalanceChange(p.balance, change, meta.eliminations);
    return { name: p.name, before: p.balance, change, after: refusal ? p.balance : pv.after, outcome: refusal ? "refused" : pv.outcome, order: pv.order, refusal };
  }

  private adjustmentRefusal(meta: SessionMeta, p: PlayerRecord, op: "add" | "subtract"): string | null {
    if (meta.podiumRevealed) return "The podium has been revealed; final results are frozen.";
    if (p.status === "eliminated") return op === "add" ? "Eliminated banks cannot be revived." : "This bank is already eliminated.";
    return null;
  }

  /**
   * Applies a host adjustment exactly once (keyed by its id), under the session lock, through the
   * same balance rule as gameplay, and re-ranks everyone in the same write.
   */
  async adjust(code: string, token: string, input: AdjustmentInput, actor: string): Promise<{ record: AdjustmentRecord; duplicate: boolean }> {
    let meta = await this.tick(code, await this.authHost(code, token));
    const a = parseAdjustment(input);
    for (let attempt = 0; attempt < 8; attempt++) {
      const existing = meta.adjustments.find((r) => r.id === a.id);
      if (existing) return { record: existing, duplicate: true };
      let record: AdjustmentRecord | null = null;
      const before = meta.seq;
      meta = await this.advance(
        meta,
        (f) => !f.adjustments.some((r) => r.id === a.id),
        async (f) => {
          const players = await this.store.getPlayers(code);
          const p = players.find((x) => x.id === a.playerId);
          if (!p || p.kicked) throw new GameError(404, "That player is not in this game.");
          const refusal = this.adjustmentRefusal(f, p, a.op);
          if (refusal) throw new GameError(409, refusal);
          const at = this.now();
          const change = a.op === "add" ? a.amount : -a.amount;
          const eliminations = [...f.eliminations];
          const label = a.op === "add" ? "Host addition" : "Host deduction";
          const b = applyBalanceChange(p, change, { cause: `${label}: ${a.reason}`, itemIndex: null, at }, eliminations);
          p.history.push({
            kind: "adjust",
            i: -1,
            c: null,
            delta: b.applied,
            raw: change,
            speedBonus: 0,
            ok: true,
            ms: null,
            note: b.outcome === "applied" ? undefined : b.outcome,
            reason: a.reason,
            ref: a.id,
            at,
          });
          const st = standings(players);
          await this.store.putPlayers(code, players);
          record = { id: a.id, playerId: p.id, name: p.name, amount: a.amount, op: a.op, reason: a.reason, actor, before: b.before, after: b.after, outcome: b.outcome, at };
          return {
            ...f,
            ...st,
            eliminations,
            adjustments: [...f.adjustments, record],
            announcements: [...f.announcements, ...announcementsFor(b.record ? [b.record] : [], f.eliminations.length, eliminations.length)],
          };
        },
      );
      if (record) return { record, duplicate: false };
      if (meta.seq === before) meta = await this.tick(code);
    }
    throw new GameError(503, "The game is busy. Try the adjustment again.");
  }

  /** Lobby roster for the Ready check: everyone joined, who is ready, who checked in recently. */
  async lobbyStatus(code: string) {
    const [players, ready, connected] = await Promise.all([
      this.store.getPlayers(code),
      this.store.readyIds(code),
      this.store.activeSince(code, this.now() - LOBBY_CONNECTED_WINDOW_MS),
    ]);
    const roster = players.filter((p) => !p.kicked);
    const readySet = new Set(ready);
    const connectedSet = new Set(connected);
    return {
      total: roster.length,
      ready: roster.filter((p) => readySet.has(p.id)).length,
      notReady: roster.filter((p) => !readySet.has(p.id)).length,
      connected: roster.filter((p) => connectedSet.has(p.id)).length,
      disconnected: roster.filter((p) => !connectedSet.has(p.id)).length,
      readySet,
      connectedSet,
    };
  }

  /** Player: Ready / Not ready, lobby only. Repeating the same choice changes nothing. */
  async setReady(code: string, playerId: string, token: string, ready: boolean) {
    const [known] = await this.authPlayer(code, playerId, token);
    const meta = await this.tick(code, known);
    if (meta.phase !== "lobby") throw new GameError(409, "The game has started; readiness can no longer change.");
    await Promise.all([this.store.setReady(code, playerId, ready), this.store.touch(code, playerId, this.now())]);
    return { ready };
  }

  private async kick(code: string, playerId: string) {
    const p = await this.store.getPlayer(code, playerId);
    if (!p) return;
    p.kicked = true;
    await this.store.putPlayers(code, [p]);
    await Promise.all([
      this.store.removePlayer(code, playerId),
      this.store.forget(code, playerId),
      this.store.releaseName(code, p.name.toLocaleLowerCase("vi")),
      this.store.setReady(code, playerId, false),
    ]);
  }

  async hostSnapshot(code: string, token: string) {
    const meta = await this.tick(code, await this.authHost(code, token));
    const live = meta.phase === "open" || meta.phase === "question";
    const lobby = meta.phase === "lobby";
    const [players, active, submitted, ready] = await Promise.all([
      this.store.getPlayers(code),
      // In the lobby "connected" uses the longer lobby window (phones lock while the host explains).
      this.store.activeSince(code, this.now() - (lobby ? LOBBY_CONNECTED_WINDOW_MS : NETWORK.activeWindowMs)),
      live ? this.store.countSubmissions(code, meta.itemIndex) : Promise.resolve(0),
      lobby ? this.store.readyIds(code) : Promise.resolve([] as string[]),
    ]);
    return {
      meta,
      players,
      activeIds: new Set(active),
      readyIds: lobby ? new Set(ready) : null,
      submitted,
      storeKind: this.store.kind,
      floor: floorActive(meta.eliminations),
    };
  }

  async screenSnapshot(code: string) {
    const meta = await this.tick(code);
    const live = meta.phase === "open" || meta.phase === "question";
    const lobby = meta.phase === "lobby" || meta.phase === "intro";
    // After the podium reveal the projector shows the full final ranking, not just the top 10.
    const fullFinal = meta.phase === "final" && meta.podiumRevealed;
    const [playerCount, active, submitted, players, ready] = await Promise.all([
      this.store.countPlayers(code),
      this.store.activeSince(code, this.now() - NETWORK.activeWindowMs),
      live ? this.store.countSubmissions(code, meta.itemIndex) : Promise.resolve(0),
      lobby || fullFinal ? this.store.getPlayers(code) : Promise.resolve(null),
      meta.phase === "lobby" ? this.store.readyIds(code) : Promise.resolve(null),
    ]);
    const names = lobby && players ? players.filter((p) => !p.kicked).sort((a, b) => a.joinedAt - b.joinedAt).map((p) => p.name) : null;
    const finalBoard =
      fullFinal && players
        ? players
            .filter((p) => !p.kicked && p.status === "active")
            .sort((a, b) => (a.rank ?? 1e9) - (b.rank ?? 1e9) || displayOrder(a, b))
            .map(toLeaderEntry)
        : null;
    const readyCount = ready && players ? players.filter((p) => !p.kicked && ready.includes(p.id)).length : null;
    return { meta, playerCount, activeCount: active.length, submitted, names, finalBoard, readyCount };
  }

  async allPlayers(code: string, token: string): Promise<[SessionMeta, PlayerRecord[]]> {
    const meta = await this.authHost(code, token);
    return [meta, await this.store.getPlayers(code)];
  }
}

let service: GameService | undefined;
export function getService(): GameService {
  return (service ??= new GameService());
}
