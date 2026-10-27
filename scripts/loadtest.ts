// Simulated classroom: N phones join over HTTP, poll like the real client, answer each case
// (sometimes twice, to test duplicate protection), and the run checks the final state.
//
//   GAME_TIME_SCALE=0.25 npm run start   (or dev), then:
//   npm run loadtest -- --url http://localhost:3000 --players 100
//
// Against a Vercel deployment, leave GAME_TIME_SCALE unset there and expect ~12 minutes per run.

import type { HostView, PlayerView } from "../src/lib/view-types";

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
    if ((v.phase === "open" || v.phase === "question") && v.status === "running" && !bot.submitted.has(item) && v.me.submitted === null) {
      // Think for a while (some bots run out of time), then answer.
      const think = v.phase === "open" ? rand(1000, 24000) * v.scale : rand(1000, 17000) * v.scale;
      await sleep(think);
      const choice = v.phase === "open" ? (Math.random() < 0.6 ? "a" : "d") : Math.floor(Math.random() * 4);
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
      return { name: r.body.name, pid: r.body.playerId, token: r.body.token, submitted: new Map(), rejectedDuplicates: 0, lateRejected: 0, last: null, silentUntil: 0 };
    }),
  );
  const overflow = await call<Json>(`/api/sessions/${code}/join`, { method: "POST", body: JSON.stringify({ name: "Overflow" }) });
  console.log(`Joined ${bots.length}. One more join -> ${overflow.status} ${overflow.body.error ?? "(accepted)"}`);
  const extra = overflow.status === 201 ? 1 : 0;

  await call(`/api/sessions/${code}/host`, { method: "POST", token: hostToken, body: JSON.stringify({ action: "start" }) });
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

  await Promise.all(runs);
  done.v = true;
  await screen;
  const elapsed = (Date.now() - t0) / 1000;

  // ---- Checks ----
  const host = (await call<HostView>(`/api/sessions/${code}/state?role=host`, { token: hostToken })).body;
  const problems: string[] = [];
  if (host.phase !== "final") problems.push(`host sees phase ${host.phase}`);
  if (host.players.length !== N + extra) problems.push(`host lists ${host.players.length} players`);
  if (N >= 100 && extra) problems.push("player 101 was admitted");
  const finals = await Promise.all(
    bots.map(async (b) => (await call<PlayerView>(`/api/sessions/${code}/state?role=player`, { token: b.token, pid: b.pid })).body),
  );
  for (const [i, v] of finals.entries()) {
    const b = bots[i];
    const h = v.me.history ?? [];
    if (h.length !== 29) problems.push(`${b.name}: ${h.length} history entries`);
    const sum = v.economy.startingBalance + h.reduce((a, e) => a + e.delta, 0);
    if (sum !== v.me.balance) problems.push(`${b.name}: balance ${v.me.balance} != start + deltas ${sum}`);
    for (const e of h) {
      const sent = b.submitted.get(e.i);
      if (sent !== undefined && sent !== null && e.c !== sent) problems.push(`${b.name}: item ${e.i} recorded ${e.c}, sent ${sent}`);
      if (e.speedBonus > 0 && (!e.ok || e.ms === null || e.ms > 15000)) problems.push(`${b.name}: bonus on item ${e.i} with ms=${e.ms} ok=${e.ok}`);
    }
    const q5 = h.find((e) => e.i === 28);
    if (q5 && q5.ok && q5.delta !== v.economy.finalQuestionBonus) problems.push(`${b.name}: final question paid ${q5.delta}`);
    const fromQuestions = h.filter((e) => [5, 11, 17, 23].includes(e.i) && e.ok).length;
    if (v.me.inventory.length !== fromQuestions) problems.push(`${b.name}: ${v.me.inventory.length} power-ups for ${fromQuestions} correct answers`);
  }
  const ranked = host.players.slice().sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0));
  for (let i = 1; i < ranked.length; i++) {
    const a = ranked[i - 1];
    const b = ranked[i];
    if (a.balance < b.balance || (a.balance === b.balance && a.correct < b.correct)) problems.push(`ranking out of order at ${a.name}/${b.name}`);
  }

  const lat = stats.latencies.sort((a, b) => a - b);
  const p = (q: number) => Math.round(lat[Math.floor(q * (lat.length - 1))]);
  console.log(`\nFinished in ${elapsed.toFixed(0)} s with ${N} players.`);
  console.log(`Requests: ${stats.requests} (${(stats.requests / elapsed).toFixed(1)}/s) · latency p50 ${p(0.5)} ms, p95 ${p(0.95)} ms, max ${p(1)} ms`);
  console.log(`5xx: ${stats.errors5xx} · other errors: ${JSON.stringify([...stats.otherErrors])}`);
  console.log(`Duplicate taps refused: ${bots.reduce((a, b) => a + b.rejectedDuplicates, 0)} · late submissions refused: ${bots.reduce((a, b) => a + b.lateRejected, 0)}`);
  console.log(`Top 3: ${ranked.slice(0, 3).map((r) => `${r.name} ${r.balance}`).join(", ")}`);
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
