# Bank Manager

A browser-based classroom game in the spirit of *Papers, Please*. Students act as bank managers on
their phones: they assess 18 loan files, screen 6 fraud and security alerts, answer 5 bonus
questions, and compete to finish with the most (fictional) money. Built for 40 to 47 players at
once, up to 100.

- **Player** (`/play/CODE`): case documents, decisions, timer, balance, outcomes, power-up tokens.
- **Host** (`/host/CODE`): start, pause, resume, close or skip, remove players, see answers,
  export CSV.
- **Projector** (`/screen/CODE`): QR code and room code, progress, reveals, leaderboard, podium,
  debrief.

Every design decision (money model, fraud and final-question weights, speed bonus, timeouts,
ranking, architecture, free tiers, time budget) is in [docs/DESIGN.md](docs/DESIGN.md).

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
2. Join from your phone by scanning the QR code.
3. Optionally fill the room with simulated classmates:
   `npm run bots -- --url <site address> --room <CODE> --players 40`
4. Press **Start game** in the host console.

When running on your own computer, open the host and projector pages through the computer's
network address (for example `http://192.168.1.20:3000`), not `localhost`. Otherwise the QR code
points phones at `localhost`, which they cannot reach. The projector shows a warning when this
happens.

## Before using it with a class

- Replace or check the bonus questions in `src/lib/content/questions.ts` against your
  presentation.
- Run one full rehearsal at real speed (see the time budget in DESIGN.md §13).
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

The load test checks that the 101st player is refused, double taps are rejected, every balance
equals the start plus its history, speed bonuses never appear on wrong or slow answers, the final
question pays money only, power-ups match correct answers to questions 1 to 4, and the ranking is
in order.

## Verification status

| Target (brief §11) | How it was checked | Result |
| --- | --- | --- |
| QR and room-code joining on phones | Playwright, iPhone 13 viewport, three phones | Passed (a real-device check is still needed) |
| 47 players, 100-player capacity | Load test, Redis store, scaled clock | 47 and 100 passed: 0 errors, 101st refused |
| Server-controlled scoring and deadlines | Service tests at the exact boundary (20 s + 400 ms) | Passed |
| Duplicate-submission protection | Tests + about 700 double taps in load tests | Passed |
| Identity after refresh or disconnection | Tests, Playwright reload, load-test dropouts | Passed |
| Consistent state, balances, rankings | Load-test integrity checks | Passed |
| Sequencing and collisions after 20 and 24 | Service test that walks all 29 items | Passed |
| No speed bonus from 15 to 20 s | Unit and service tests | Passed |
| Final question money only | Unit, service and load tests | Passed |
| Full rehearsal within the intended time | Real-time simulated run with 47 players on Redis | 10.5 min of game, 0 errors, 35.7k Redis commands. Worst case 13.4 min plus joining and debrief. A class rehearsal is still needed (DESIGN.md §13) |
