// Fills an existing room with simulated classmates, so one person can beta test the game with a
// realistic crowd and leaderboard. The bots join, then play whatever the host runs.
//
//   npm run bots -- --url https://your-app.vercel.app --room ABCDE --players 40
//
// Bots do not know the answers: they approve about 60% of the time, pick quiz answers at random,
// take 3-18 s per decision, and occasionally miss the deadline. That is reckless lending, so
// expect several bots to go bankrupt: watch the elimination announcements and the 1 VND floor.

import type { PlayerView } from "../src/lib/view-types";

const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const BASE = (args.url ?? "http://localhost:3000").replace(/\/$/, "");
const ROOM = (args.room ?? "").toUpperCase();
const N = Math.min(Number(args.players ?? 40), 99);

const NAMES = ["An", "Bảo", "Chi", "Dũng", "Giang", "Hà", "Hải", "Hương", "Khánh", "Linh", "Long", "Mai", "Minh", "Nam", "Ngọc", "Nhung", "Phúc", "Quân", "Quỳnh", "Sơn", "Tâm", "Thảo", "Thắng", "Trang", "Trung", "Tú", "Uyên", "Việt", "Vy", "Yến"];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function call<T>(path: string, init: RequestInit & { token?: string; pid?: string } = {}) {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.pid) headers["x-player-id"] = init.pid;
  const res = await fetch(BASE + path, { ...init, headers });
  return { status: res.status, body: (await res.json().catch(() => ({}))) as T & { error?: string } };
}

async function bot(i: number) {
  const name = `${NAMES[i % NAMES.length]} (bot)`;
  const j = await call<{ playerId: string; token: string }>(`/api/sessions/${ROOM}/join`, { method: "POST", body: JSON.stringify({ name }) });
  if (j.status !== 201) {
    console.log(`${name}: could not join (${j.body.error})`);
    return;
  }
  const auth = { token: j.body.token, pid: j.body.playerId };
  const answered = new Set<number>();
  let lastPhase = "";
  for (;;) {
    const r = await call<PlayerView>(`/api/sessions/${ROOM}/state?role=player&hb=1&first=${lastPhase !== "open" ? 1 : 0}`, auth);
    if (r.status !== 200) {
      await sleep(2000);
      continue;
    }
    const v = r.body;
    lastPhase = v.phase;
    if (v.phase === "final") return v.me;
    const q = v.item?.question;
    const canAct = v.me.status === "active" && (v.phase === "open" || (v.phase === "question" && q));
    if (canAct && v.status === "running" && !answered.has(v.itemIndex) && v.me.submitted === null) {
      answered.add(v.itemIndex);
      // Keep polling while "thinking", like a real phone, so the bot still holds the case open.
      const until = Date.now() + (3000 + Math.random() * 15000 + (Math.random() < 0.08 ? 8000 : 0)) * v.scale;
      while (Date.now() < until) {
        await sleep(Math.min(2000, until - Date.now()));
        await call(`/api/sessions/${ROOM}/state?role=player&hb=1&first=0`, auth);
      }
      // Quiz answers are option ids from this bot's own shuffled question.
      const choice = v.phase === "open" ? (Math.random() < 0.6 ? "a" : "d") : q!.options[Math.floor(Math.random() * 4)].id;
      await call(`/api/sessions/${ROOM}/submit`, { method: "POST", ...auth, body: JSON.stringify({ itemIndex: v.itemIndex, choice }) });
      continue;
    }
    await sleep(v.phaseEndsAt ? Math.min(2500, Math.max(100, v.phaseEndsAt - v.serverNow + 60)) : 2500);
  }
}

async function main() {
  if (!/^[A-Z0-9]{5}$/.test(ROOM)) {
    console.error("Usage: npm run bots -- --url <site> --room <CODE> --players 40");
    process.exit(1);
  }
  console.log(`Adding ${N} bots to room ${ROOM} at ${BASE}. Start the game from the host console; press Ctrl+C to stop.`);
  const results = await Promise.all(Array.from({ length: N }, (_, i) => sleep(i * 100).then(() => bot(i))));
  const done = results.filter(Boolean).length;
  console.log(`Game over. ${done} bots finished.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
