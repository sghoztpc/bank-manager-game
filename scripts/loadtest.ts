// Simulated classroom: N phones join over HTTP, poll like the real client, answer each case
// (sometimes twice, to test duplicate protection), and the run checks the final state.
//
//   GAME_TIME_SCALE=0.25 npm run start   (or dev), then:
//   npm run loadtest -- --url http://localhost:3000 --players 100
//
// Against a Vercel deployment, leave GAME_TIME_SCALE unset there and expect ~12 minutes per run.

import type { HostView, PlayerView, ScreenView } from "../src/lib/view-types";

const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const BASE = (args.url ?? "http://localhost:3000").replace(/\/$/, "");
const N = Number(args.players ?? 47);
const DROPOUTS = Math.floor(N * 0.05); // these phones go silent for a while mid-game, then come back

type Json = Record<string, unknown>;
const stats = { requests: 0, errors5xx: 0, otherErrors: new Map<string, number>(), latencies: [] as number[] };

async function call<T>(path: string, init: RequestInit & { token?: string; pid?: string } = {}): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.pid) headers["x-player-id"] = init.pid;
  const t0 = performance.now();
  const res = await fetch(BASE + path, { ...init, headers });
  stats.latencies.push(performance.now() - t0);
  stats.requests++;
  const body = (await res.json().catch(() => ({}))) as T;
  if (res.status >= 500) stats.errors5xx++;
  return { status: res.status, body };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const rand = (a: number, b: number) => a + Math.random() * (b - a);

interface Bot {
  name: string;
  pid: string;
  token: string;
  submitted: Map<number, unknown>;
  rejectedDuplicates: number;
  lateRejected: number;
  last: PlayerView | null;
  silentUntil: number;
  /** Quiz slot -> question id as shown on this phone; must never change. */
  seenQuestions: Map<number, string>;
  eliminatedRefusals: number;
  problems: string[];
}

async function runBot(code: string, bot: Bot, done: { v: boolean }) {
  let lastPhase = "";
  while (!done.v) {
    if (Date.now() < bot.silentUntil) {
      await sleep(500);
      continue;
    }
    const r = await call<PlayerView & { error?: string }>(`/api/sessions/${code}/state?role=player&hb=1&first=${lastPhase !== "open" ? 1 : 0}`, {
      token: bot.token,
      pid: bot.pid,
    });
    if (r.status !== 200) {
      const k = `poll ${r.status} ${r.body.error}`;
      stats.otherErrors.set(k, (stats.otherErrors.get(k) ?? 0) + 1);
      await sleep(1000);
      continue;
    }
    const v = r.body;
    bot.last = v;
    lastPhase = v.phase;
    if (v.phase === "final") return;
    const item = v.itemIndex;
    const q = v.item?.question;
    if (q && v.item?.questionNo) {
      const prev = bot.seenQuestions.get(v.item.questionNo);
      if (prev && prev !== q.id) bot.problems.push(`${bot.name}: quiz ${v.item.questionNo} changed from ${prev} to ${q.id}`);
      bot.seenQuestions.set(v.item.questionNo, q.id);
    }
    if (v.me.status === "eliminated") {
      // Spectator: any attempt to act must be refused.
      if ((v.phase === "open" || v.phase === "question") && !bot.submitted.has(item)) {
        bot.submitted.set(item, null);
        const s = await call<Json>(`/api/sessions/${code}/submit`, { method: "POST", token: bot.token, pid: bot.pid, body: JSON.stringify({ itemIndex: item, choice: "a" }) });
        if (s.status === 409) bot.eliminatedRefusals++;
        else bot.problems.push(`${bot.name}: eliminated bank's submission got ${s.status}`);
      }
      await sleep(2500);
      continue;
    }
    if ((v.phase === "open" || (v.phase === "question" && q)) && v.status === "running" && !bot.submitted.has(item) && v.me.submitted === null) {
      // Think for a while (some bots run out of time), then answer. Quiz answers are option ids.
      const think = v.phase === "open" ? rand(1000, 24000) * v.scale : rand(2000, 28000) * v.scale;
      await sleep(think);
      const choice = v.phase === "open" ? (Math.random() < 0.6 ? "a" : "d") : q!.options[Math.floor(Math.random() * 4)].id;
      const s = await call<Json>(`/api/sessions/${code}/submit`, {
        method: "POST",
        token: bot.token,
        pid: bot.pid,
        body: JSON.stringify({ itemIndex: item, choice }),
      });
      if (s.status === 200) {
        bot.submitted.set(item, choice);
        // Double tap: must be refused and keep the first answer.
        if (Math.random() < 0.3) {
          const again = await call<Json>(`/api/sessions/${code}/submit`, {
            method: "POST",
            token: bot.token,
            pid: bot.pid,
            body: JSON.stringify({ itemIndex: item, choice: typeof choice === "number" ? (choice + 1) % 4 : choice === "a" ? "d" : "a" }),
          });
          // Refused as a duplicate, or as closed if the first tap completed the room.
          if (again.status === 409) bot.rejectedDuplicates++;
          else throw new Error(`Duplicate submission was not refused: ${again.status} ${JSON.stringify(again.body)}`);
        }
      } else if (s.status === 409) {
        bot.lateRejected++;
        bot.submitted.set(item, null);
      } else {
        const k = `submit ${s.status} ${s.body.error}`;
        stats.otherErrors.set(k, (stats.otherErrors.get(k) ?? 0) + 1);
      }
      continue;
    }
    const wait = v.phaseEndsAt ? Math.min(2000, Math.max(100, v.phaseEndsAt - v.serverNow + 60)) : 2000;
    await sleep(wait);
  }
}

async function main() {
  const t0 = Date.now();
  const created = await call<{ code: string; hostToken: string }>("/api/sessions", { method: "POST" });
  if (created.status !== 201) throw new Error(`create failed ${created.status}`);
  const { code, hostToken } = created.body;
  console.log(`Room ${code}: joining ${N} players…`);

  const bots: Bot[] = await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      const r = await call<{ playerId: string; token: string; name: string }>(`/api/sessions/${code}/join`, {
        method: "POST",
        body: JSON.stringify({ name: `Bot ${i + 1}` }),
      });
      if (r.status !== 201) throw new Error(`join ${i} failed: ${r.status} ${JSON.stringify(r.body)}`);
      return {
        name: r.body.name,
        pid: r.body.playerId,
        token: r.body.token,
        submitted: new Map(),
        rejectedDuplicates: 0,
        lateRejected: 0,
        last: null,
        silentUntil: 0,
        seenQuestions: new Map(),
        eliminatedRefusals: 0,
        problems: [],
      };
    }),
  );
  const overflow = await call<Json>(`/api/sessions/${code}/join`, { method: "POST", body: JSON.stringify({ name: "Overflow" }) });
  console.log(`Joined ${bots.length}. One more join -> ${overflow.status} ${overflow.body.error ?? "(accepted)"}`);
  const extra = overflow.status === 201 ? 1 : 0;

  // Ready check: every bot presses Ready (twice: the repeat must change nothing).
  const startProblems: string[] = [];
  await Promise.all(
    bots.map(async (b) => {
      for (let k = 0; k < 2; k++) {
        const r = await call<Json>(`/api/sessions/${code}/ready`, { method: "POST", token: b.token, pid: b.pid, body: JSON.stringify({ ready: true }) });
        if (r.status !== 200) startProblems.push(`${b.name}: ready -> ${r.status}`);
      }
    }),
  );
  const hostCmd = (action: string) => call<Json>(`/api/sessions/${code}/host`, { method: "POST", token: hostToken, body: JSON.stringify({ action }) });
  if (extra) {
    // The extra player never pressed Ready: a normal start must refuse; Force start goes ahead.
    const normal = await hostCmd("start");
    if (normal.status !== 409) startProblems.push(`normal start with an unready player -> ${normal.status}`);
    const forced = await hostCmd("force-start");
    if (forced.status !== 200) startProblems.push(`force start -> ${forced.status}`);
  } else {
    const normal = await hostCmd("start");
    if (normal.status !== 200) startProblems.push(`normal start with everyone ready -> ${normal.status} ${normal.body.error}`);
  }
  const again = await hostCmd("start");
  const lateJoin = await call<Json>(`/api/sessions/${code}/join`, { method: "POST", body: JSON.stringify({ name: "After start" }) });
  if (lateJoin.status !== 409) startProblems.push(`join after start -> ${lateJoin.status}`);
  console.log(`Start: ${extra ? "normal start refused (1 unready), force start used" : "normal start (all ready)"}; repeat start -> ${again.status}; join after start -> ${lateJoin.status}`);
  const done = { v: false };
  const runs = bots.map((b) => runBot(code, b, done));

  // A projector polling once a second, and a few phones dropping out for ~20 s mid-game.
  const screen = (async () => {
    while (!done.v) {
      const s = await call<{ phase: string }>(`/api/sessions/${code}/state?role=screen`);
      if (s.body.phase === "final") return;
      await sleep(1000);
    }
  })();
  setTimeout(() => {
    for (const b of bots.slice(0, DROPOUTS)) b.silentUntil = Date.now() + 20_000 * Number(process.env.SCALE ?? 0.25);
  }, 30_000 * Number(process.env.SCALE ?? 0.25));

  // The host, meanwhile: balance adjustments (each sent twice: must apply once) and one pause/continue.
  const SCALE = Number(process.env.SCALE ?? 0.25);
  const adjustments: { id: string; pid: string; delta: number; applied: boolean }[] = [];
  let duplicateAdjustmentsRefused = 0;
  const hostTask = (async () => {
    await sleep(20_000 * SCALE);
    let k = 0;
    while (!done.v && k < 12) {
      const b = bots[Math.floor(Math.random() * bots.length)];
      const big = k % 3 === 0;
      const op = big || Math.random() < 0.5 ? "subtract" : "add";
      const amount = big ? 400_000_000 : 10_000_000 * (1 + Math.floor(Math.random() * 5));
      const id = `load-${code}-${k++}`;
      const body = JSON.stringify({ id, playerId: b.pid, op, amount, reason: `load test ${k}` });
      const [r1, r2] = await Promise.all([
        call<{ duplicate?: boolean; error?: string }>(`/api/sessions/${code}/adjust`, { method: "POST", token: hostToken, body }),
        call<{ duplicate?: boolean; error?: string }>(`/api/sessions/${code}/adjust`, { method: "POST", token: hostToken, body }),
      ]);
      const ok = [r1, r2].filter((r) => r.status === 200);
      if (ok.length === 2 && ok.filter((r) => r.body.duplicate).length === 1) duplicateAdjustmentsRefused++;
      else if (ok.length === 2) throw new Error(`adjustment ${id} not deduplicated: ${JSON.stringify([r1.body, r2.body])}`);
      adjustments.push({ id, pid: b.pid, delta: op === "add" ? amount : -amount, applied: ok.length > 0 });
      if (k === 6) {
        await call(`/api/sessions/${code}/host`, { method: "POST", token: hostToken, body: JSON.stringify({ action: "pause" }) });
        await sleep(3000 * SCALE);
        await call(`/api/sessions/${code}/host`, { method: "POST", token: hostToken, body: JSON.stringify({ action: "continue" }) });
      }
      await sleep(25_000 * SCALE);
    }
  })();

  await Promise.all(runs);
  done.v = true;
  await screen;
  await hostTask;
  const elapsed = (Date.now() - t0) / 1000;

  // ---- Checks ----
  const host = (await call<HostView>(`/api/sessions/${code}/state?role=host`, { token: hostToken })).body;
  const problems: string[] = [...startProblems];
  if (host.phase !== "final") problems.push(`host sees phase ${host.phase}`);
  if (host.players.length !== N + extra) problems.push(`host lists ${host.players.length} players`);
  if (N >= 100 && extra) problems.push("player 101 was admitted");
  const finals = await Promise.all(
    bots.map(async (b) => (await call<PlayerView>(`/api/sessions/${code}/state?role=player`, { token: b.token, pid: b.pid })).body),
  );
  const totals = { penalties: 0, boosts: 0 };
  const eliminatedCount = host.players.filter((p) => p.status === "eliminated").length;
  if (eliminatedCount > 5) problems.push(`${eliminatedCount} eliminations (quota is 5)`);
  if (host.quota.used !== eliminatedCount) problems.push(`quota says ${host.quota.used}, players show ${eliminatedCount}`);
  const orders = host.eliminations.map((e) => e.order);
  if (orders.join() !== orders.map((_, i) => i + 1).join()) problems.push(`elimination order ${orders.join()}`);
  for (const [i, v] of finals.entries()) {
    const b = bots[i];
    problems.push(...b.problems);
    const h = v.me.history ?? [];
    const played = h.filter((e) => e.kind !== "adjust");
    if (v.me.status === "active" && played.length !== 29) problems.push(`${b.name}: ${played.length} played items`);
    if (v.me.status === "eliminated") {
      if (v.me.balance !== 0) problems.push(`${b.name}: eliminated with balance ${v.me.balance}`);
      if (!h.some((e) => e.note === "eliminated")) problems.push(`${b.name}: eliminated without an eliminating entry`);
      if (played.some((e) => e.at > v.me.elimination!.at)) problems.push(`${b.name}: played after elimination`);
    } else {
      if (v.me.balance < 1) problems.push(`${b.name}: active with balance ${v.me.balance}`);
      if (!host.quota.floorActive && h.some((e) => e.note === "floored")) problems.push(`${b.name}: floored before the quota filled`);
    }
    const sum = v.economy.startingBalance + h.reduce((a, e) => a + e.delta, 0);
    if (sum !== v.me.balance) problems.push(`${b.name}: balance ${v.me.balance} != start + applied changes ${sum}`);
    if (!Number.isInteger(v.me.balance)) problems.push(`${b.name}: non-integer VND ${v.me.balance}`);
    for (const e of played) {
      const sent = b.submitted.get(e.i);
      if (sent !== undefined && sent !== null && e.c !== sent) problems.push(`${b.name}: item ${e.i} recorded ${e.c}, sent ${sent}`);
      if (e.speedBonus > 0 && (!e.ok || e.ms === null || e.ms > 15000)) problems.push(`${b.name}: bonus on item ${e.i} with ms=${e.ms} ok=${e.ok}`);
    }
    const q5 = played.find((e) => e.i === 28);
    if (q5 && q5.ok && q5.raw !== v.economy.finalQuestionBonus) problems.push(`${b.name}: final question paid ${q5.raw}`);
    const fromQuestions = played.filter((e) => [5, 11, 17, 23].includes(e.i) && e.ok).length;
    if (v.me.inventory.length !== fromQuestions) problems.push(`${b.name}: ${v.me.inventory.length} power-ups for ${fromQuestions} correct answers`);
    const spent = v.me.inventory.filter((t) => t.usedAtItem !== null).length;
    const boosted = played.filter((e) => (e.boost ?? 0) > 0);
    if (boosted.length !== spent) problems.push(`${b.name}: ${boosted.length} boosted decisions for ${spent} spent tokens`);
    if (boosted.some((e) => !e.ok)) problems.push(`${b.name}: boost on a wrong decision`);
    const missed = played.filter((e) => [5, 11, 17, 23].includes(e.i) && !e.ok);
    if (missed.some((e) => e.raw > 0)) problems.push(`${b.name}: a wrong quiz answer earned money`);
    totals.penalties += missed.filter((e) => e.raw < 0).length;
    totals.boosts += boosted.length;
    const ids = [...b.seenQuestions.values()];
    if (new Set(ids).size !== ids.length) problems.push(`${b.name}: repeated quiz question ${ids.join()}`);
  }
  const ranked = host.players.filter((p) => p.status === "active").sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  for (let i = 1; i < ranked.length; i++) {
    const a = ranked[i - 1];
    const b = ranked[i];
    if (a.balance < b.balance || (a.balance === b.balance && a.correct < b.correct)) problems.push(`ranking out of order at ${a.name}/${b.name}`);
    if (a.balance === b.balance && a.correct === b.correct && a.rank !== b.rank) problems.push(`tie not shared at ${a.name}/${b.name}`);
  }
  // Podium: hidden until revealed, then only active banks ranked 1-3.
  const hidden = (await call<ScreenView>(`/api/sessions/${code}/state?role=screen`)).body;
  if (hidden.podium !== null) problems.push("podium visible before the reveal");
  await call(`/api/sessions/${code}/host`, { method: "POST", token: hostToken, body: JSON.stringify({ action: "reveal-podium" }) });
  const shown = (await call<ScreenView>(`/api/sessions/${code}/state?role=screen`)).body;
  if (!shown.podium || shown.podium.some((e) => e.status !== "active" || (e.rank ?? 9) > 3)) problems.push(`bad podium ${JSON.stringify(shown.podium)}`);
  if ((shown.leaderboard?.length ?? 0) !== ranked.length) problems.push(`final ranking shows ${shown.leaderboard?.length} of ${ranked.length} active banks`);

  const lat = stats.latencies.sort((a, b) => a - b);
  const p = (q: number) => Math.round(lat[Math.floor(q * (lat.length - 1))]);
  console.log(`\nFinished in ${elapsed.toFixed(0)} s with ${N} players.`);
  console.log(`Requests: ${stats.requests} (${(stats.requests / elapsed).toFixed(1)}/s) · latency p50 ${p(0.5)} ms, p95 ${p(0.95)} ms, max ${p(1)} ms`);
  console.log(`5xx: ${stats.errors5xx} · other errors: ${JSON.stringify([...stats.otherErrors])}`);
  console.log(`Duplicate taps refused: ${bots.reduce((a, b) => a + b.rejectedDuplicates, 0)} · late submissions refused: ${bots.reduce((a, b) => a + b.lateRejected, 0)}`);
  console.log(`Eliminations: ${eliminatedCount}/5 · floor active: ${host.quota.floorActive} · floored outcomes: ${finals.reduce((a, v) => a + (v.me.history ?? []).filter((e) => e.note === "floored").length, 0)} · eliminated submissions refused: ${bots.reduce((a, b) => a + b.eliminatedRefusals, 0)}`);
  console.log(`Quiz penalties charged: ${totals.penalties} · power-up boosts applied: ${totals.boosts}`);
  console.log(`Host adjustments: ${adjustments.length} (each sent twice, ${duplicateAdjustmentsRefused} duplicates absorbed)`);
  console.log(`Podium: ${shown.podium?.map((e) => `${e.rank}. ${e.name} ${e.balance.toLocaleString("vi-VN")} VND`).join(", ")}`);
  if (problems.length || stats.errors5xx) {
    console.log(`\nFAILED (${problems.length} problems)\n` + problems.slice(0, 30).join("\n"));
    process.exit(1);
  }
  console.log("\nAll integrity checks passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
