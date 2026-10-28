# Bank Manager

A browser-based classroom game in the spirit of *Papers, Please*. Students act as bank managers on
their phones: they assess 18 loan files, screen 6 fraud and security alerts, answer 5 quiz
questions of their own, and compete to finish with the biggest (fictional) VND balance. The first
five banks to go bankrupt are eliminated; after that, every surviving bank has a 1 VND safety floor.
Built for 40 to 47 players at once, up to 100.

- **Player** (`/play/CODE`): their own bank. VND balance, case documents, decisions, timer, quiz,
  rank, power-up tokens, pause status, and a Game Over screen if eliminated.
- **Host** (`/host/CODE`): the session. Start, pause, continue, close or next, end session,
  balance adjustments (preview, then apply once), elimination and adjustment logs, projector
  toggles, podium reveal, removing players, CSV export.
- **Projector** (`/screen/CODE`): QR code and room code, progress, reveals, elimination banners,
  leaderboard, podium, debrief.

Every design decision is in [docs/DESIGN.md](docs/DESIGN.md): Part A for Brief 1 (money model,
weights, speed bonus, timeouts, architecture, free tiers) and Part B for Brief 2 (elimination,
VND, roles, podium, randomised quiz).

## Run it locally

```bash
npm install
npm run dev          # http://localhost:3000, in-memory store, no setup needed
```

Open the site, press **Host a new game**, then open the projector view and join from phones on
the same network (use the computer's LAN address instead of `localhost`).

To rehearse quickly, `GAME_TIME_SCALE=0.25 npm run dev` runs every phase four times faster.

## Deploy to Vercel

1. Import the repository in Vercel and set **Root Directory** to `bank-manager-game`. The framework
   (Next.js) is detected automatically.
2. In the project, open **Storage** and add **Upstash for Redis** from the Marketplace. Connect it
   to the project; it adds `KV_REST_API_URL` and `KV_REST_API_TOKEN`. Pick the region nearest your
   functions.
3. Redeploy. The host console header reads "shared store" when Redis is in use.

Without Redis the deployed app refuses to create games. Separate function instances do not share
memory, so state would split.

## Beta testing on your own

1. Open the host console and press **Host a new game**. Open the projector view on a second
   screen (or a second browser window).
2. Join from your phone by scanning the QR code, then press **Ready**.
3. Optionally fill the room with simulated classmates (they press Ready automatically):
   `npm run bots -- --url <site address> --room <CODE> --players 40`
4. Optionally press **Tutorial: demonstrate a case** in the host console. The projector shows the
   worked example; step through Inspect, Decide and Reveal, then **Back to lobby**.
5. Press **Start game** once everyone is ready and connected, or **Force start** to go ahead
   anyway. New players can join only before the start.

When running on your own computer, open the host and projector pages through the computer's
network address (for example `http://192.168.1.20:3000`), not `localhost`. Otherwise the QR code
points phones at `localhost`, which they cannot reach. The projector shows a warning when this
happens.

## Before using it with a class

- Review the quiz pool in `src/lib/content/questions.ts` against your presentation. Q02, Q09 and Q14
  are held out of play with proposed corrections (DESIGN.md B6); once fixed, set `playable: true`.
- Run one full rehearsal at real speed (see the time budget in DESIGN.md B7).
- Optionally edit or add cases in `src/lib/content/`. `npm test` checks the pool still supports
  the session draw.

## Checks

```bash
npm run typecheck
npm test             # engine + service tests (in-memory store)
npm run simulate     # strategy table for the economy
```

Run the same tests against real Redis through a local Upstash-compatible shim:

```bash
redis-server --port 6390 --save "" &
npx tsx scripts/upstash-shim.ts --port 8079 --redis 6390 &
TEST_KV_URL=http://localhost:8079 npm test
```

Load test with simulated phones (works against a local server or a deployment):

```bash
npm run build
GAME_TIME_SCALE=0.25 KV_REST_API_URL=http://localhost:8079 KV_REST_API_TOKEN=local npm start &
npm run loadtest -- --url http://localhost:3000 --players 100
```

The load test plays bots that lend recklessly, so banks go bankrupt. Meanwhile the host makes
adjustments (each sent twice) and pauses and continues once. The test checks:

- the 101st player is refused, and double taps are rejected;
- every balance equals the start plus its applied changes, in whole VND;
- at most five eliminations, numbered 1 to n; eliminated banks sit at 0 VND and can't act;
  survivors never go below 1 VND, and the floor applies only after the fifth elimination;
- quiz questions never change for a player and never repeat;
- speed bonuses never appear on wrong or slow answers; the final quiz pays money only;
  power-ups match correct answers to quizzes 1 to 4; boosts are applied only to correct decisions,
  once per spent token; wrong quiz answers never earn money;
- ranks are in order and ties are shared;
- the podium stays hidden until revealed, then shows only active banks;
- the full final ranking is shown.

## Verification status

### Brief 2 acceptance checks (§6)

| Check | How | Result |
| --- | --- | --- |
| QR/room-code joining; distinct host/player permissions | Playwright (3 phones + host + projector); service tests reject player tokens on every host action | Passed |
| Positive, exact-zero and overshooting outcomes | Unit + service tests | Passed |
| Five different players eliminated once each; simultaneous 5th/6th failures; no sixth | Service tests (four banks failing on one case; two concurrent host deductions racing for the last slot) on memory and Redis; load tests | Passed |
| Survivor losing repeatedly under the 1 VND floor | Unit + service tests; 15–26 floored outcomes per load test | Passed |
| Game Over, host log, announcement, quota after refresh | Service tests; Playwright reload of the eliminated phone | Passed |
| Host additions and deductions, including one that eliminates, and a repeated submission | Service tests; load test sends each adjustment twice | Passed |
| Pause and continue during decisions and quizzes | Service tests (saved time restored, 3 s minimum, answers refused while paused); load test; Playwright | Passed |
| Five random questions per player, persistent order, grading after shuffle | Unit tests (300 players), service tests, load-test consistency check | Passed |
| Triggers after 5/10/15/20/24; no duplicate rewards; no power-up from quiz 5 | Service test walking all 29 items; load tests | Passed |
| VND and ranking consistent after every money change | Load-test invariants; unit tests for whole VND | Passed |
| Ties, fewer than three finishers, finalisation, podium, persistent final ranking | Service tests; Playwright podium (2 finishers, empty third place) | Passed |
| 47-player run and 100-player capacity with simultaneous outcomes | Load tests on Redis (4× speed) | 47 and 100 passed, 0 errors, 101st refused |
| Full rehearsal near 15 minutes | Real-time 47-player simulated run on Redis | 650 s (10.8 min) of game, 0 errors, 34,975 Redis commands (about 14 sessions a month on Upstash's free tier). Optimistic, because simulated players stop holding cases open while "thinking"; the worst case is 14.2 min of game plus joining and debrief. It found one bookkeeping bug (timeout timestamps), now fixed with a regression test. A class rehearsal is still needed (DESIGN.md B7). |

### Brief 3 acceptance checks (§5)

| Check | How | Result |
| --- | --- | --- |
| Host opens, decides, reveals, resets and closes the example; players can't | Service tests (player tokens rejected on every tutorial action, no tutorial data on phones); Playwright | Passed |
| Plain-language terms, time units, balance and ROI on the live layout | Playwright screenshots of every step | Passed |
| Both choices explained without touching live balances, scores, eliminations or quizzes | Service test comparing player records and session before and after | Passed |
| Lobby and readiness kept during the tutorial | Playwright: a phone pressed Ready during the demo and the host saw it | Passed |
| Join unready, press Ready, survive a refresh | Service test; Playwright reload | Passed |
| Ready and Connected distinct | Service test (a ready player offline for 61 s) | Passed |
| Normal start waits; all-ready doesn't auto-start | Service test; load test at 100 players | Passed |
| Force start with mixed readiness moves unready phones in | Service test; load test at 47 players | Passed |
| Start racing a join; repeated starts | Service tests; load test repeats the start | Passed |
| Tutorial and Ready frozen once running; pause/continue unaffected | Service tests | Passed |
| New session resets readiness and the tutorial | Service test | Passed |
| 47 players, 100-player ceiling | Load tests on Redis (4× speed): 0 errors | Passed |

The quiz transcription was checked mechanically against the brief's appendix: 30 of 30
questions match, with 0 mismatches.

### Brief 1 checks (still covered)

Server-controlled deadlines (exact 20 s + 400 ms boundary), duplicate protection, reconnection,
sequencing and the 15–20 s no-bonus window remain covered by the test suites and load tests above.
