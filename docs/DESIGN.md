# Bank Manager: design decisions

This file records the decisions behind the game: Part A answers section 10 of Implementation
Brief 1; Part B covers Implementation Brief 2, which supersedes Brief 1's "keep everyone playing"
preference and its points/credits display. All numbers live in `src/lib/config.ts`;
`npm run simulate` re-checks the strategy table after any change.

Settled by the briefs (not open): 18 loan cases and 6 fraud cases at decisions 4, 8, 12, 16, 20 and
24; quizzes after decisions 5, 10, 15, 20 and 24 (power-ups for the first four, money only for the
last); a 20-second maximum per decision; speed bonus 5/4/3% and none after 15 s; timeout means
decline/block; the first five banks to reach zero are eliminated, then a 1 VND floor; VND
throughout; five random quiz questions per player.

# Part A: the core game

## 1. Pacing: host-paced waves that advance automatically

Everyone sees the same case at the same moment. The server clock moves the session through these phases:

| Phase | Length | Notes |
| --- | --- | --- |
| Intro | 20 s | Rules on phones and projector |
| Get ready | 2 s | Case number shown, content withheld |
| Decision | up to 20 s | Ends early once every connected player has answered |
| Reveal | 6 s | Outcome, explanation, room distribution |
| Quiz | 25 s | Each player's own question; ends early when everyone has answered |
| Quiz answer + leaderboard | 7 s | The shared leaderboard break |
| Final | until closed | Results frozen; the host reveals the podium |

Why host-paced:

- Fair ranking: identical cases, identical outcome conditions, identical clock.
- One shared reveal per case, so the presenter can debrief live.
- Predictable length, which a 15-minute slot needs.

Individual pacing would feel more like desk work, but it would break the shared debrief and the
collision rules, and it would need difficulty normalisation before players could be ranked fairly.

The host can pause, continue, close a case early, skip a reveal, or end the session. Nothing runs in the background:
every request first brings the session clock up to date (`GameService.tick`), so the game works on
serverless functions with no cron.

## 2. Money model (VND)

All money is **VND**, described to players as a fictional classroom bank balance. Every amount is a
whole number of VND, rounded to the nearest VND with halves away from zero (`vnd()` in
`config.ts`). ROI is shown as a percentage, separately from VND.

| Item | Value | Derivation |
| --- | --- | --- |
| Starting balance (bank capital) | 300.000.000 VND | Same for everyone |
| Exposure per loan file | 500.000.000 VND | Same for every case, so no single file dominates |
| Approve, loan repaid | +18% to +22% of the exposure (about +100.000.000) | Reference: 20%, a compressed multi-year return |
| Approve, loan defaults | −25% to −35% (about −150.000.000) | Reference: 30%, the loss after collateral recovery |
| Decline | +3% (+15.000.000) | The money goes into government bills instead |
| Fraud desk, right call | +30.000.000 | 30% × the reference successful loan gain |
| Fraud let through | −45.000.000 | 30% × the reference failed loan loss |
| Genuine customer blocked | −15.000.000 | Half the fraud reward |
| Final quiz, correct | +6.000.000 | 2% × the common starting balance |

Brief 1 used 10,000 credits against a 2,000 stake. **Under that scale nobody could ever reach
zero**: the worst possible game ended near half the starting balance, which would make Brief 2's
elimination rule unreachable. So Brief 2 needed a rebalance, not a relabel: the money is now in VND,
and the starting capital is **0.6 × one loan's exposure**. Every percentage, and so every ratio
between outcomes, is unchanged. The framing is real banking: a bank lends far more than its own
capital, so a few bad loans can wipe out its equity.

Outcomes are **deterministic per case** and revealed right after the case closes, so the
competition is fair and every reveal is teachable. Every session draws exactly 11 repaid and 7
defaulted loans, plus 3 fraudulent and 3 genuine fraud cases, from a seeded PRNG.

### Strategy check (`npm run simulate`, 2,000 draws, 24 decisions, quizzes excluded)

| Strategy | Total (million VND) | Reaches 0 VND |
| --- | ---: | ---: |
| Approve / allow everything | −10m | 45.7% |
| Decline / block everything | +325m | 0% |
| Never answer (timeouts) | +315m | 0% |
| Coin flip | +162m | 22.3% |
| 60% accurate | +407m | 9.4% |
| 70% accurate | +653m | 3.5% |
| 80% accurate | +891m | 0.9% |
| 90% accurate | +1.141m | 0.1% |
| Perfect, fast | +1.426m | 0% |

- Approving everything loses money and goes bankrupt in almost half of all draws. Declining
  everything is safe but earns about a quarter of what good judgement earns; players beat it from
  about 57% accuracy.
- The fraud desk is about 13% of a perfect game's earnings, so lending decides the ranking.
- **A mixed class of 47** (2 approve-all, 5 guessers, then 12/15/10/3 at 60/70/80/90% accuracy):
  on average 3.8 banks reach zero per session (median 3, 10th–90th percentile 0–9), and the quota
  of five fills in about 36% of sessions. The quota is a maximum, not a target, as Brief 2 requires.

## 3. The 30% fraud weighting

- **Reward** = 30% of the reference successful loan gain (100.000.000) = **30.000.000 VND**, for
  either right call: blocking fraud or clearing a genuine payment.
- **Losses are scaled separately**: missed fraud = 30% of the reference failed loan loss
  (150.000.000) = **−45.000.000**; false block = half the reward = **−15.000.000**.

## 4. The 2% final-quiz reward

The reference is the **common starting balance (300.000.000 VND)**, so a correct final answer pays
**6.000.000 VND**, the same for every player. It is not 2% of a player's own balance or two ROI
points, and it grants no power-up.

## 5. Speed bonus

A **relative multiplier on the positive earnings of a correct, submitted decision**
(+5% / +4% / +3%, inclusive boundaries at 5.000, 10.000 and 15.000 ms; nothing after 15 s). It
applies to fraud cases too. The best loan bonus is about +5.000.000 VND, while a wrong approval
costs about −150.000.000 VND, so it never rewards guessing. Each phone's clock starts when the case
reaches it (head start capped at 2 s); pauses are excluded; the server judges by receive time, with
a 400 ms network grace that never earns a bonus.

## 6. Timeouts

No decision by the deadline is a decline (loan) or block (fraud), with that outcome; it never
counts as a correct decision and never earns a bonus.

## 7. Ranking and ties

Confirmed by Brief 2: active players by **current VND balance**, highest first.
Adopted from Brief 2's recommendation: then **correct decisions**; players equal on both **share a
competitive rank** (1, 1, 3). Tied rows are listed in join order, which does not break the tie.
Brief 1's third tie-breaker (time on correct answers) is dropped. Eliminated players are not ranked;
they are listed below in a separate "Eliminated" section by elimination order at 0 VND.

## 8. Power-ups

Set by the group after Brief 2 (it replaces Brief 2's "wrong answers have no penalty"):

- **Correct answer to quiz 1–4**: a **boost** token. It adds **+10%** to what the player's next
  correct case decision earns (speed bonus included), rounded to whole VND. It is used
  automatically, one token per correct decision, oldest first; a wrong decision or a timeout does
  not use it. Tokens left at the end are simply unused.
- **Wrong answer, or no answer, to quiz 1–4**: the bank loses **20% of its current balance**
  (whole VND). Counting "no answer" as wrong stops players from dodging the penalty by letting the
  timer run out. Because 80% always remains, a quiz can never bankrupt a bank; at the 1 VND floor
  the 20% rounds to 0.
- **Quiz 5** is unchanged: +6.000.000 VND if correct, nothing otherwise, no token.
- Eliminated banks receive no quizzes, so they earn no tokens and pay no penalty; any tokens they
  already hold can never be used.

This makes the quiz weigh heavily: a player who misses all four keeps 0.8⁴ ≈ 41% of their balance
from those quizzes alone, so presentation knowledge now matters about as much as lending
judgement. Bots that guess quiz answers at random lose a lot to it: in the 47-player load
test, second and third place fell from about 900.000.000 to about 650.000.000 VND.

## 9. Case pool and randomisation

- 28 loan files (16 repaid, 12 defaulted) and 10 fraud-desk cases (5 fraudulent, 5 genuine), all
  fictional.
- Ratios (DSR, DSCR, LTV) are precomputed in the file, so nobody calculates under the clock.
- Each genuine fraud-desk case contains at least one alarming signal (a test enforces this). Two
  fraud cases look technically clean (own device, passed authentication), so no single signal
  settles a case.
- Case explanations name the discipline: credit risk, payment fraud screening, scam / social
  engineering, or cybersecurity incident. The fraud title and category are hidden until the reveal
  because they would give the answer away.
- Customer documents quote amounts in the same VND format as balances ("450.000.000 VND").
- Randomisation selects and orders **whole cases**. It never edits numbers, which keeps every case
  internally consistent. Varying amounts would need every explanation templated and re-checked.

## 10. Joining, identity and reconnection

- The host creates a room and gets a 5-character code (no 0/O/1/I) and a QR code linking to
  `/play/CODE`.
- Players enter a nickname: 16 characters at most, deduplicated case-insensitively ("Lan",
  "lan 2"). They receive a random token. Only its SHA-256 hash is stored.
- The token and player id are kept in `localStorage`, so refreshing or reconnecting restores the
  same player. The client also re-polls when the tab becomes visible or the network returns.
- Capacity is 100 players. The host and projector connect separately and do not count.
- Late joiners are allowed. They start with the standard balance, play from the current case, and
  carry a "late" tag on the leaderboard.
- The host can remove a player, for example for an inappropriate nickname.
- The host key can be moved to another device with the "Copy host link" button (`#key=` in the URL).

## 11. Architecture

```
Phones / projector / host  --poll (HTTPS JSON)-->  Next.js route handlers on Vercel
                                                    |  GameService (tick, join, submit, host actions)
                                                    |  pure engine: schedule, scoring, phases, ranking
                                                    v
                                                  Upstash Redis (shared, authoritative state)
```

- **Authoritative state is on the server.** The client sends only "I chose X for item i". The
  server checks the phase, the deadline and the eligibility, and computes every outcome.
  Answers, signals and outcomes are stripped from player and projector payloads until the item is
  resolved (`src/lib/game/views.ts`, covered by tests).
- **Polling, not WebSockets.** Vercel functions cannot hold sockets open. Polling every 1.5 to 2.5 s
  is plenty for a 20-second decision rhythm. Phones also schedule a poll for the exact moment a
  case opens, using a server clock offset.
- **Concurrency.** Every state transition takes a short Redis lock keyed by the session's sequence
  number. Exactly one request resolves an item, and the others re-read. Submissions go through one
  Lua script that refuses duplicates (`HSETNX`) and anything arriving after the item was marked
  closed. Resolution marks the item closed *before* reading the submissions, so an accepted
  answer can never be lost. Joining checks capacity in a Lua script as well. Resolution skips
  players already resolved for an item, so a retried transition cannot double-count.
- **Keys** expire 6 hours after their last write. Nothing needs cleaning up.
- **Code organisation**:

| Path | Contents |
| --- | --- |
| `src/lib/config.ts` | Every balancing and timing number |
| `src/lib/content/` | Cases and questions |
| `src/lib/engine/` | Pure logic: schedule, scoring, phase clock, ranking, elimination rule, quiz assignment, power-up boost |
| `src/lib/game/` | Service, the resolution step, and per-role view builders |
| `src/lib/store/` | `Store` interface, with Redis (production) and in-memory (local, tests) |
| `src/app/api/sessions/...` | Route handlers: create, join, state, submit, host, adjust, export |
| `src/components/` | Player, host and projector apps |

## 12. Vercel, shared persistence and free tiers

- Set the project's **Root Directory** to `bank-manager-game`.
- Add Upstash Redis from the Vercel Marketplace. It injects `KV_REST_API_URL` and
  `KV_REST_API_TOKEN`. Choose a database region close to the function region. Without these
  variables the app refuses to create games on Vercel, because each function instance would
  otherwise have its own memory.
- **Redis usage.** See the README's verification section for the measured command count of a
  47-player real-time session. Upstash's free tier allows 500,000 commands a month (checked
  October 2026; it replaced the old 10,000-a-day cap). Pay-as-you-go is about $0.20 per 100,000
  commands.
- **Vercel Hobby** is for non-commercial, personal use. A class activity run by students fits, but
  a school or company account may need Pro. Sources disagree on the exact Hobby invocation
  allowance, so check the current Hobby limits page. A session is in the low tens of thousands of
  short function invocations.

# Part B: Implementation Brief 2

## B1. Gap analysis (state of the app before Brief 2)

| Brief 2 area | Before | Change |
| --- | --- | --- |
| §1 Elimination | Nobody could reach zero; no elimination | Rebalanced money (A2); one balance rule used everywhere; persisted log; Game Over; announcements |
| §2 VND | Credits ("Cr") | Stored values rescaled to VND; Vietnamese formatting; case documents converted |
| §3 Host / player roles | Start, pause, resume, skip, kick | Continue (saved time, minimum 3 s); End session; balance adjustments with preview, idempotency and audit log; elimination log; projector toggles |
| §4 Leaderboard and podium | Top 10; speed as third tie-break; no podium control | Shared ranks; eliminated section; rank-change arrows; host-revealed podium with ties; confetti; full final ranking |
| §5 Quiz | One fixed set of 5 questions for the whole room | 30-question pool; 3 held back; balanced random five per player; shuffled options with stable ids; persisted |

## B2. Elimination (§1)

**Confirmed rule** (`src/lib/engine/elimination.ts`, the only place that applies balance changes):

1. The caller has checked the event is valid and not already applied (per-player `lastResolved`
   for gameplay; adjustment ids for host changes).
2. Compute the resulting balance.
3. Above zero: apply it.
4. Zero or below, fewer than five eliminated: balance set to **0 VND**, the bank is eliminated, and
   it takes the next slot.
5. Zero or below, five already eliminated: the bank stays active at **1 VND**.

"Touch zero" means a computed balance of zero or below, so a large loss cannot jump past it.

**Authoritative order.** Every balance change happens under the session lock, so changes are
applied one at a time. Within one case settlement, events are ordered by **when the server received
each decision**; timeouts count at the deadline, and remaining ties go to join order. If several
banks fail on the same case, the earliest events take the remaining slots and later ones get the
floor. Host adjustments are ordered by when they commit.

**Persistence and idempotency.** The elimination log (order, bank, cause, change, balance before,
time) lives in the session record in Redis, so a host refresh or a server restart keeps the quota.
A resubmitted answer is refused (item closed, or bank eliminated); a retried settlement skips banks
already settled; a repeated adjustment id returns the original record. None of these can take a
second slot or announce twice. Pausing changes nothing. A new session (new room code) starts
with an empty quota.

**Player experience.** The eliminated phone shows **Game Over**: nickname, elimination number,
0 VND, and the outcome that caused it (for example "Case 7 · Loan defaulted: −150.000.000 VND took
the balance from 120.000.000 VND to zero"). This persists through refresh. The server refuses that
bank's case and quiz answers; it receives no more cases or quizzes, so a bank eliminated on case 5,
10, 15, 20 or 24 never receives that milestone's quiz reward. The player can keep watching the
leaderboard and the final results.

**Host and projector.** The host console shows **Eliminations n / 5**, the elimination log, and
the adjustment log. The projector shows the quota chip and a brief banner (not full screen) for
each elimination, plus a notice when the fifth elimination brings in the **1 VND safety floor**.
Banners never appear while a case or quiz is open: anything committed during one waits for the
reveal. Each banner shows for 8 seconds and does not replay after a reload. The host can switch
announcements off or dismiss the current one.

**Recommended defaults adopted.** A host deduction follows the same rule and can take an unused
slot; the preview shows this before it is applied ("becomes elimination 3 of 5", or "stops at the
1 VND safety floor"). A positive adjustment cannot revive an eliminated bank; it is refused.

## B3. VND (§2)

Stored values were rescaled, not just relabelled (A2). All balances, rewards, penalties, quiz
rewards, adjustments, leaderboard values and the CSV export are whole VND. They are formatted as
`1.000.000 VND` and `+50.000 VND` by one formatter that does not depend on the device's locale
data. Customer documents use the same format ("6.000.000.000 VND"). "Credit risk" is unchanged
because it names a risk, not a currency.

## B4. Host and player roles (§3)

- **Separate surfaces.** `/play/CODE` is a player's own bank. `/host/CODE` is the session console:
  roster, status, start, pause, continue, close or next, end session, adjustments, elimination and
  adjustment logs, projector toggles, podium reveal, export. `/screen/CODE` is the public projector
  view.
- **Permissions are enforced on the server.** Host routes require the host key (only its SHA-256
  hash is stored); player tokens and room codes are rejected there (tests cover pause, start,
  adjust, preview and the host snapshot). Player responses contain only that player's own quiz
  question, and its answer only after the quiz closes. The projector and host never receive
  individual questions.
- **Adjustments.** Choose a player, add or subtract a positive whole VND amount (up to
  10.000.000.000), and record a reason (required). **Preview** shows before → after and any
  elimination or floor consequence; **Apply** commits once per form key, so double clicks and
  retries cannot repeat it. The log records the id, player, amount, operation, reason, actor (the
  host key's fingerprint), before, after, outcome and time. The player's balance, the host view and
  the rankings update in the same write, and the phone shows a one-time notice. Adjustments are
  refused once the podium is revealed.
- **Pause / continue.** Pause freezes the phase timer for everyone and phones show "Paused".
  Continue restores the *saved* remaining time. Brief 2 rules out both fresh timers and instant
  timeouts, so a decision or quiz window that was paused with under **3 seconds** left gets 3
  seconds back.
- **Submission racing a pause.** The authoritative order is the server's: a submission is accepted
  if the server processed it while the session was running. If the pause committed first, it is
  refused with "The game is paused" and the player answers after Continue. Response time is
  measured at receipt and pauses are excluded, so a race never changes the speed tier.
- **End session.** This explicit action (with confirmation) settles any open case or quiz with the
  answers already received, then freezes the results. Normal completion after quiz 5 reaches the
  same final state. Phones and the projector show "Results are final" until the host presses
  **Reveal podium**.
- **Host reconnect.** The host key in `localStorage` (or the copied host link) reconnects to the
  same room. Nothing on the host side creates a second game, and **Host a new game** always opens
  a new room code, distinct from pause and continue.

## B5. Leaderboard, effects and final top three (§4)

- Rankings are computed on the server after every case settlement, quiz reward and host
  adjustment, and stored with the session, so reconnecting restores the same rank and balance.
- Phones highlight their own row ("you"); leaderboard rows show ▲/▼ rank changes; the phone shows
  its own rank change and a short colour flash when its balance changes. Nothing replays after a
  reconnect, effects never block input or hide deadlines, and reduced motion turns them off.
- **Podium**: every active bank ranked 1–3, so a tied third place shows all tied banks. Empty
  places stay empty ("No bank in this place"), and eliminated banks are never promoted. Confetti
  plays once per device (on the projector and on podium phones) when the host reveals it. The full
  final ranking (every active bank, then the eliminated section) stays available after the podium
  and after refresh.

## B6. Randomised quiz (§5)

- **Pool**: all 30 source questions are transcribed word for word with the supplied keys (a script
  check against the brief's appendix found 0 mismatches; keys are 23 B and 7 A).
- **Held back pending review** (`playable: false`, with the proposed correction stored with each
  question; the source wording and keys are untouched):
  - **Q02** asks for the *spread* between the lending and borrowing rates, but the key is *net
    interest margin* (net interest income ÷ earning assets). Proposed fix: offer "interest rate
    spread" as the answer, or reword the stem to describe NIM.
  - **Q09**: moving a deposit from Bank A to Bank B leaves the aggregate money supply unchanged.
    The keyed option says it contracts, and option D ("nothing changes in the banking system")
    ignores the liquidity shift. Proposed fix: "Total money supply is unchanged; liquidity and
    reserves shift from Bank A to Bank B".
  - **Q14**: SVB's securities were mainly US Treasuries and agency mortgage-backed securities, not
    "guaranteed corporate bonds", and the direct cause was a deposit run after losses were
    realised. Proposed fix: reword it and check it against the presentation's case evidence.
  27 questions remain playable.
- **Assignment** (`src/lib/engine/quiz.ts`): five distinct questions per player, one per slot,
  drawn independently for each player from a PRNG seeded by the session and player id, and stored
  on the player record at join, so refreshing never rerolls them. Late joiners get theirs at join.
- **Balanced sampling**: slot 1 warm-up, slot 2 tricky, slot 3 core, slot 4 hardcore, slot 5 core.
  Every player gets the same category mix, and the money-paying slot 5 is always a core-topic
  question. This evens out difficulty but does not guarantee it.
- **Option shuffle**: each player sees the four options in their own stored order. Each option
  keeps its id (its source letter), the phone submits that id, and grading compares ids, so
  shuffling cannot change the answer, and "always pick B" no longer works (tested: the correct
  answer lands in each position about 25% of the time).
- **Grading**: once, at the quiz's settlement. Quizzes 1–4: correct earns a +10% boost token,
  wrong or no answer costs 20% of the balance (A8). Quiz 5: 6.000.000 VND if correct.
- **Display**: the revealed answer is highlighted on the player's own shuffled options. The
  source's letter ("B. …") is dropped from the answer text, because it would contradict the
  shuffled order.
- **Timing**: **25 seconds**, separate from the 20-second decision timer, because each option is
  about 100 characters. The window closes early once everyone connected has answered.

## B7. Time budget

Worst case, with every window running to its limit:

24 × (2 + 20 + 6) + 5 × (25 + 7) + 20 = **852 s ≈ 14.2 min** of game, plus about 1.5 min
joining and about 1.5 min for the podium and debrief, about 17 minutes in total.

Windows close early when everyone connected has answered; the README records the real-time
rehearsal result. Brief 2's longer quiz adds about 50 s to the worst case. To stay near 15 minutes:
start while latecomers are still joining (they are allowed in), use **Next** to shorten reveals,
and keep the debrief brief. A rehearsal with a real class is still needed.
