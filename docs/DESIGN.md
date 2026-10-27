# Bank Manager: design decisions

This file answers the follow-up analysis required by section 10 of the implementation brief. All
numbers live in `src/lib/config.ts`. `npm run simulate` re-checks the strategy table after any change.

The brief fixed these, and they are not open: 18 loan cases, 6 fraud cases at decision positions
4, 8, 12, 16, 20 and 24, 5 bonus questions after decisions 5, 10, 15, 20 and 24, a money-only final
question, a 20-second maximum per decision, and no speed bonus after 15 seconds.

## 1. Pacing: host-paced waves that advance automatically

Everyone sees the same case at the same moment. The server clock moves the session through these phases:

| Phase | Length | Notes |
| --- | --- | --- |
| Intro | 20 s | Rules on phones and projector |
| Get ready | 2 s | Case number shown, content withheld |
| Decision | up to 20 s | Ends early once every connected player has answered |
| Reveal | 6 s | Outcome, explanation, room distribution |
| Bonus question | 15 s | Also ends early when everyone has answered |
| Answer + leaderboard | 7 s | The shared leaderboard break |
| Final | until closed | Podium, leaderboard, debrief |

Why host-paced:

- Fair ranking: identical cases, identical outcome conditions, identical clock.
- One shared reveal per case, so the presenter can debrief live.
- Predictable length, which a 15-minute slot needs.

Individual pacing would feel more like desk work, but it would break the shared debrief and the
collision rules, and it would need difficulty normalisation before players could be ranked fairly.

The host can pause, resume, close a case early, or skip a reveal. Nothing runs in the background:
every request first brings the session clock up to date (`GameService.tick`), so the game works on
serverless functions with no cron.

## 2. Money model

All money is **credits (Cr)**: fictional classroom points. The interface and the rules say they are
not banking forecasts. Customer files use realistic-looking ₫ amounts for flavour, but every loan
file commits the same desk stake.

| Item | Value | Derivation |
| --- | --- | --- |
| Starting balance | 10,000 Cr | Same for everyone |
| Stake per loan file | 2,000 Cr | Same for every case, so no single file dominates |
| Approve, loan repaid | +18% to +22% of stake (about +400) | Reference: 20%, a compressed multi-year return |
| Approve, loan defaults | −25% to −35% of stake (about −600) | Reference: 30%, the loss after collateral recovery |
| Decline | +3% of stake (+60) | Stake goes into short-term government bills instead |
| Fraud desk, right call | +120 | 30% × the reference successful loan gain (400) |
| Fraud let through | −180 | 30% × the reference failed loan loss (600) |
| Genuine customer blocked | −60 | Half the fraud reward: complaint handling and goodwill |
| Final question, correct | +200 | 2% × the common starting balance |

Outcomes are **deterministic per case** and revealed right after the case closes. Each case is
written with one correct call and a story that explains it. Deterministic outcomes keep the
competition fair (no luck between equally good decisions) and make every reveal teachable. A
probabilistic model would teach "good decisions can lose money", but with only 18 loans the noise
would decide the ranking.

### Sessions are comparable by construction

Every session draws exactly 11 repaid and 7 defaulted loans, plus 3 fraudulent and 3 genuine fraud
cases. Only *which* cases appear, and their order, vary. The draw comes from a seeded PRNG, so it
can be reproduced from the session seed.

### Strategy check (`npm run simulate`, 2,000 draws, 24 decisions, bonus questions excluded)

| Strategy | Loans | Fraud desk | Total |
| --- | ---: | ---: | ---: |
| Approve / allow everything | +124 | −162 | −38 |
| Decline / block everything | +1,101 | +198 | +1,299 |
| Never answer (all timeouts) | +1,080 | +180 | +1,260 |
| Coin flip | +633 | +13 | +647 |
| 60% accurate | +1,452 | +173 | +1,625 |
| 70% accurate | +2,298 | +313 | +2,611 |
| 80% accurate | +3,114 | +452 | +3,566 |
| 90% accurate | +3,966 | +603 | +4,569 |
| Perfect, slow (16 s) | +4,711 | +720 | +5,431 |
| Perfect, fast (4 s) | +4,946 | +756 | +5,702 |

- Approving everything loses money.
- Declining everything is the "cautious bank": it keeps capital but earns about a quarter of what
  good judgement earns. Players beat it from about 57% accuracy. That matches the brief: declining
  is a smaller return, not a penalty, and refusing all risk still falls behind.
- Lending decides the ranking. The fraud desk is about 13% of a perfect game's earnings.
- No strategy can drive the balance below zero. The worst possible session (all 7 bad loans at
  their largest losses, every fraud call wrong) ends near 5,000 Cr. Depleted balances therefore
  cannot happen. If the numbers change, the code still keeps negative balances in play rather than
  eliminating anyone, and the unit test `no strategy can deplete the starting balance` guards the
  margin.

## 3. The 30% fraud weighting, precisely

- **Positive reward** = 30% of the *reference successful loan gain* (stake × 20% = 400 Cr) = **120 Cr**.
  A right call earns it either way: blocking fraud, or clearing a genuine payment. Correctly
  clearing genuine customers is part of good screening. If it earned nothing, "block everything"
  would earn half of a perfect fraud score.
- **Losses are scaled separately**. Missed fraud = 30% of the *reference failed loan loss*
  (600 Cr) = **−180 Cr**. A false block = half the reward = **−60 Cr**. The asymmetry mirrors
  reality: a missed fraud costs the bank more than an annoyed customer does.
- Block-everything earns +180 over six fraud cases, against +720 for perfect play.

## 4. The 2% final-question reward

The reference is the **common starting balance (10,000 Cr)**, so a correct answer pays **200 Cr**,
the same for every player. It is not 2% of the player's own balance, and it is not two percentage
points of ROI. It awards no power-up.

## 5. Speed bonus

- It is a **relative multiplier on the positive earnings of a correct, submitted decision**
  (+5% / +4% / +3%). It is not percentage points added to ROI: those would add about 100 Cr per
  case and swamp the decision itself.
- Tiers are measured in milliseconds and the boundaries are inclusive: ≤5,000 → 5%;
  ≤10,000 → 4%; ≤15,000 → 3%; above 15,000 → 0. A submission in the last 5 seconds earns
  nothing, as the brief requires.
- It applies to fraud cases on the same terms (+6 Cr at most). One rule is easier to explain.
- It does not reward guessing. The best bonus on a loan is about +20 Cr, while a wrong approval
  costs about −600 Cr. Fast and perfect beats slow and perfect by under 300 Cr over the session,
  less than one loan. Wrong and timed-out decisions never earn a bonus.
- **When the clock starts.** The server stamps the case's opening time. Each phone reports the
  first moment it actually receives the case, and the player's response time is measured from
  then, so a slow connection does not cost bonus time. This head start is capped at 2 s, so
  nobody can stall to read a neighbour's screen. Pauses are excluded.
- **Deadline.** Submissions are judged by the server's receive time. The window is 20 s after
  opening, plus a 400 ms network grace for answers already in flight. An answer that lands in the
  grace counts with no bonus. Anything later is refused, and the phone locks its buttons at 20.0 s
  on its own clock.

## 6. Timeouts

No decision by the deadline is an automatic decline (loan) or block (fraud case), with that case's
normal outcome. The outcome is applied, but a timeout never counts as a correct decision, which is
the main tie-breaker, and never earns a speed bonus. Doing nothing (+1,260) is not a safe escape:
it earns less than declining (+1,299) and far less than reasonable play.

## 7. Ranking and tie-breaks

1. Money, highest first.
2. Correct decisions (questions excluded), more first.
3. Total response time on those correct decisions, less first.
4. Players equal on all three share a rank.

## 8. Bonus questions and power-ups

- Questions live in `src/lib/content/questions.ts`. **They are placeholders and must be checked
  against the group's presentation.** Slots 3 and 4 cover liquidity risk and interactions between
  risks, as the brief asks.
- Questions 1 to 4: a correct answer grants an inventory token of kind `unassigned`, with no
  effect yet. Question 5 pays 200 Cr and grants no token. A wrong answer has no penalty.
- The power-up catalogue is deliberately not designed here. `src/lib/engine/powerups.ts` documents
  the extension points: a registry, the grant rule, and where to apply effects. All balance
  changes happen in one function (`resolveItem`), which is where effects belong.
- The base game is completely playable without any power-up.

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
| `src/lib/engine/` | Pure logic: schedule, scoring, phase clock, ranking, power-up hook |
| `src/lib/game/` | Service, the resolution step, and per-role view builders |
| `src/lib/store/` | `Store` interface, with Redis (production) and in-memory (local, tests) |
| `src/app/api/sessions/...` | Route handlers: create, join, state, submit, host, export |
| `src/components/` | Player, host and projector apps |

## 12. Vercel, shared persistence and free tiers

- Set the project's **Root Directory** to `bank-manager-game`.
- Add Upstash Redis from the Vercel Marketplace. It injects `KV_REST_API_URL` and
  `KV_REST_API_TOKEN`. Choose a database region close to the function region. Without these
  variables the app refuses to create games on Vercel, because each function instance would
  otherwise have its own memory.
- **Redis usage.** A 47-player, real-time simulated session used **35,729 Redis commands**. That
  count includes the commands inside Lua scripts, so it is an upper bound. Upstash's free tier
  allows 500,000 commands a month (checked October 2026; it replaced the old 10,000-a-day cap), so
  it covers about 14 sessions a month. Pay-as-you-go is about $0.20 per 100,000 commands, under
  $0.10 a session.
- **Vercel Hobby** is for non-commercial, personal use. A class activity run by students fits, but
  a school or company account may need Pro. Sources disagree on the exact Hobby invocation
  allowance, so check the current Hobby limits page. A session is in the low tens of thousands of
  short function invocations.

## 13. Time budget

Worst case, with every case running its full 20 s:

24 × (2 + 20 + 6) + 5 × (15 + 7) + 20 = **802 s ≈ 13.4 min** of game, plus about 1.5 min joining
and about 1.5 min final results and debrief, which is ≈ 16 minutes.

Cases close early as soon as every connected player has answered. The real-time simulated
47-player run took 630 s (10.5 min) of game. That run is optimistic, because simulated players
that are still "thinking" stop polling and stop holding cases open. So plan on 13 to 16 minutes in
total. The host can also press **Next** to cut a reveal short. A full rehearsal
with a real class is still required: the brief's 15-minute target is not met in the worst case.
To save time without touching settled rules, start the game while late joiners are still arriving
(they are allowed in) and shorten the debrief.
