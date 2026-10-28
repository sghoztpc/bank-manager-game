"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerView } from "@/lib/view-types";
import { api, ApiError, creds, money, signedMoney, useFrame, usePoll, type PlayerCreds } from "./client";
import {
  CaseFile,
  choiceLabels,
  Confetti,
  Debrief,
  Distribution,
  Leaderboard,
  Podium,
  QuestionOptions,
  QuotaChip,
  roiText,
  Rules,
  SimpleCountdown,
  TimerBar,
} from "./ui";

export function PlayerApp({ code }: { code: string }) {
  const [me, setMe] = useState<PlayerCreds | null | undefined>(undefined);
  useEffect(() => setMe(creds.player(code)), [code]);
  if (me === undefined) return null;
  if (me === null) return <JoinForm code={code} onJoined={setMe} />;
  return (
    <Game
      code={code}
      me={me}
      onLost={() => {
        creds.setPlayer(code, null);
        setMe(null);
      }}
    />
  );
}

function JoinForm({ code, onJoined }: { code: string; onJoined: (c: PlayerCreds) => void }) {
  const [name, setName] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return setErr("Enter a nickname.");
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ playerId: string; token: string; name: string }>(`/api/sessions/${code}/join`, {
        method: "POST",
        body: JSON.stringify({ name }),
      });
      const c = { playerId: r.playerId, token: r.token, name: r.name };
      creds.setPlayer(code, c);
      onJoined(c);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not join.");
      setBusy(false);
    }
  }
  return (
    <main className="wrap narrow">
      <div>
        <div className="eyebrow">Room {code}</div>
        <h1 style={{ fontSize: 40 }}>
          Bank <span style={{ color: "var(--accent)" }}>Manager</span>
        </h1>
      </div>
      <form className="card" onSubmit={submit}>
        <label>
          Your nickname (shown on the leaderboard)
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={16} autoComplete="nickname" placeholder="e.g. Minh Anh" autoFocus />
        </label>
        <button className="go" type="submit" disabled={busy}>
          {busy ? "Joining…" : "Join"}
        </button>
        <div className="err" role="alert">
          {err}
        </div>
        <p className="muted small">No account needed. If you refresh or lose signal, this phone rejoins as you automatically.</p>
      </form>
    </main>
  );
}

const HEARTBEAT_MS = 4000;

/** Remembers which one-off effects or notices this device has already shown (survives refresh). */
function seenOnce(key: string): boolean {
  try {
    if (localStorage.getItem(key)) return true;
    localStorage.setItem(key, "1");
  } catch {
    // Without storage the notice may show again after a refresh; harmless.
  }
  return false;
}

function Game({ code, me, onLost }: { code: string; me: PlayerCreds; onLost: () => void }) {
  const lastHb = useRef(0);
  const lastPhase = useRef<string>("");
  const [pending, setPending] = useState<{ item: number; choice: "a" | "d" | number } | null>(null);
  const [submitErr, setSubmitErr] = useState("");
  const [toast, setToast] = useState<string | null>(null);
  const [flash, setFlash] = useState<"" | "flash-up" | "flash-down">("");
  const prevBalance = useRef<number | null>(null);

  const fetcher = useCallback(async () => {
    const hb = Date.now() - lastHb.current >= HEARTBEAT_MS;
    const first = lastPhase.current !== "open";
    const d = await api<PlayerView>(`/api/sessions/${code}/state?role=player&hb=${hb ? 1 : 0}&first=${first ? 1 : 0}`, {
      token: me.token,
      playerId: me.playerId,
    });
    if (hb) lastHb.current = Date.now();
    lastPhase.current = d.phase;
    return d;
  }, [code, me]);

  const { data, error, poll, serverNow } = usePoll<PlayerView>(fetcher, (d, now) => {
    const until = (t: number | null, cap: number) => (t === null ? cap : Math.min(cap, Math.max(0, t - now) + 60));
    if (d.status === "paused") return 1500;
    switch (d.phase) {
      case "lobby":
        return 2500;
      case "intro":
        return until(d.phaseEndsAt, 2500);
      case "ready":
        return until(d.phaseEndsAt, 5000);
      case "open":
      case "question":
        // Answered phones poll a little faster so they catch the reveal as soon as the room closes early.
        return until(d.phaseEndsAt, d.me.status === "eliminated" ? 2500 : d.me.submitted !== null ? 1500 : 2000);
      case "reveal":
      case "qreveal":
        return until(d.phaseEndsAt, 3000);
      case "final":
        return d.podiumRevealed ? 20000 : 2500;
    }
  });

  // Modest balance effect when the server reports a change (never on first load or reconnect).
  const balance = data?.me.balance;
  useEffect(() => {
    if (balance === undefined) return;
    if (prevBalance.current !== null && balance !== prevBalance.current) {
      setFlash(balance > prevBalance.current ? "flash-up" : "flash-down");
      const t = setTimeout(() => setFlash(""), 1300);
      prevBalance.current = balance;
      return () => clearTimeout(t);
    }
    prevBalance.current = balance;
  }, [balance]);

  // Host adjustments to this player: one notice each, not repeated after a refresh.
  const lastAdjust = data?.me.adjustments.at(-1);
  useEffect(() => {
    if (!lastAdjust?.ref || seenOnce(`bmg:adj:${code}:${lastAdjust.ref}`)) return;
    // Show what the host entered; the applied change can differ only when it hit zero.
    setToast(`Host adjustment ${signedMoney(lastAdjust.raw)}: ${lastAdjust.reason ?? ""}`);
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [lastAdjust?.ref, lastAdjust?.raw, lastAdjust?.reason, code]);

  const live = !!data && (data.phase === "open" || data.phase === "question" || data.phase === "ready" || data.phase === "intro");
  useFrame(live && data?.status === "running");

  if (error && (error.status === 401 || error.status === 404 || error.status === 403)) {
    return (
      <main className="wrap narrow">
        <div className="card">
          <h2>{error.status === 403 ? "Removed from the game" : "Not connected to this game"}</h2>
          <p className="muted">{error.message}</p>
          {error.status !== 403 && (
            <button className="go" onClick={onLost}>
              Join again
            </button>
          )}
        </div>
      </main>
    );
  }
  if (!data) {
    return (
      <main className="wrap narrow">
        <p className="muted">{error ? error.message : "Connecting…"}</p>
      </main>
    );
  }

  const now = serverNow();
  const item = data.item;
  const out = data.me.status === "eliminated";
  const mine = data.me.submitted ?? (pending && pending.item === data.itemIndex ? pending.choice : null);

  async function submit(choice: "a" | "d" | number) {
    if (!data) return;
    setPending({ item: data.itemIndex, choice });
    setSubmitErr("");
    try {
      await api(`/api/sessions/${code}/submit`, {
        method: "POST",
        token: me.token,
        playerId: me.playerId,
        body: JSON.stringify({ itemIndex: data.itemIndex, choice }),
      });
    } catch (e) {
      setPending(null);
      setSubmitErr(e instanceof ApiError ? e.message : "Could not send. Check your connection and try again.");
    }
    poll();
  }

  const decisionNo = item?.decisionNo;

  return (
    <main className="wrap narrow">
      <p className="eyebrow">Your bank · room {code}</p>
      <header className="stats desk" aria-label="Your bank">
        <div className="stat" style={{ gridColumn: "1 / -1" }}>
          <span className="eyebrow">{data.me.name}</span>
          <b className={`${out ? "neg" : data.me.balance < data.economy.startingBalance ? "neg" : ""} ${flash}`}>{money(data.me.balance)}</b>
        </div>
        <div className="stat">
          <span className="eyebrow">Rank</span>
          <b>
            {out ? `Out #${data.me.elimination?.order}` : data.me.rank ? `${data.me.rank} / ${data.playerCount}` : "–"}
            {data.me.rankChange !== 0 && !out && (
              <span className={data.me.rankChange > 0 ? "pos" : "neg"} style={{ fontSize: 14, marginLeft: 6 }}>
                {data.me.rankChange > 0 ? `▲${data.me.rankChange}` : `▼${-data.me.rankChange}`}
              </span>
            )}
          </b>
        </div>
        <div className="stat">
          <span className="eyebrow">{item?.type === "question" && data.phase !== "final" ? "Quiz" : "Case"}</span>
          <b>
            {data.phase === "final"
              ? "Done"
              : decisionNo
                ? `${decisionNo} / ${data.totalDecisions}`
                : item?.type === "question"
                  ? `${item.questionNo} / 5`
                  : "–"}
          </b>
        </div>
        <div className="stat">
          <span className="eyebrow">Power-ups</span>
          <b>{data.me.inventory.length}</b>
        </div>
        <div className="stat">
          <span className="eyebrow">Room</span>
          <b style={{ fontSize: 14 }}>
            <QuotaChip quota={data.quota} />
          </b>
        </div>
      </header>

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
      {error && <p className="err">{error.message}</p>}

      {out && <GameOver data={data} />}

      {!out && data.phase === "lobby" && (
        <section className="card">
          <h2>You&apos;re in, {data.me.name}.</h2>
          <p className="muted">Waiting for the host to start. Keep this page open.</p>
          <Rules e={data.economy} />
        </section>
      )}

      {!out && data.phase === "intro" && (
        <section className="card">
          <div className="spread">
            <h2>How it works</h2>
            <span className="eyebrow">
              First case in <SimpleCountdown now={now} endsAt={data.phaseEndsAt} />
            </span>
          </div>
          <Rules e={data.economy} />
        </section>
      )}

      {!out && data.phase === "ready" && item && (
        <section className="splash">
          <span className="eyebrow">{item.mode === "fraud" ? "Fraud & security alert" : "Loan file"}</span>
          <h2>Case {item.decisionNo}</h2>
          <div className="count">{data.phaseEndsAt ? Math.max(1, Math.ceil((data.phaseEndsAt - now) / 1000)) : ""}</div>
          {data.me.late && <p className="muted small">You joined late, so you start from the case you joined on.</p>}
        </section>
      )}

      {!out && data.phase === "open" && item?.case && (
        <DecisionDesk data={data} now={now} mine={mine as "a" | "d" | null} onChoose={submit} error={submitErr} />
      )}

      {!out && data.phase === "reveal" && item && <DecisionReveal data={data} />}

      {!out && (data.phase === "question" || data.phase === "qreveal") && item?.question && (
        <section className="card">
          <div className="spread">
            <span className="eyebrow">
              Your quiz {item.questionNo} · {item.question.topic}
            </span>
            {data.phase === "question" && <SimpleCountdown now={now} endsAt={data.phaseEndsAt} />}
          </div>
          <h2 style={{ fontSize: 22 }}>{item.question.prompt}</h2>
          <p className="muted small">
            {item.reward === "money"
              ? `Correct answer: +${money(data.economy.finalQuestionBonus)}. No power-up.`
              : "Correct answer: a power-up token. No penalty for a wrong answer."}{" "}
            Everyone has their own question.
          </p>
          <QuestionOptions
            item={item}
            chosen={typeof mine === "number" ? mine : null}
            onPick={data.phase === "question" && mine === null && data.status === "running" ? (id) => submit(id) : undefined}
          />
          {submitErr && <p className="err">{submitErr}</p>}
          {data.phase === "question" && mine !== null && <p className="muted">Answer locked. Waiting for the others…</p>}
          {data.phase === "qreveal" && <QuestionResult data={data} />}
        </section>
      )}

      {!out && data.phase === "question" && !item?.question && (
        <section className="card">
          <p className="muted">Quiz in progress. You joined after it started, so it does not count for you.</p>
        </section>
      )}

      {(data.phase === "qreveal" || (out && data.phase !== "final")) && data.leaderboard && (
        <section className="card">
          <span className="eyebrow">Leaderboard</span>
          <Leaderboard entries={data.leaderboard} eliminated={data.eliminatedBoard} meId={data.me.id} total={data.playerCount} />
        </section>
      )}

      {data.phase === "final" && <FinalScreen data={data} code={code} />}

      {data.status === "paused" && (
        <div className="overlay" role="dialog" aria-label="Paused">
          <div className="card">
            <h2>Paused</h2>
            <p className="muted">The host paused the game. Your timer is stopped and will continue from where it was.</p>
          </div>
        </div>
      )}
    </main>
  );
}

/** Shown from the moment a bank is eliminated, and again on every refresh. */
function GameOver({ data }: { data: PlayerView }) {
  const e = data.me.elimination;
  return (
    <section className="card gameover" role="alert">
      <span className="eyebrow">Bank closed</span>
      <h2>Game over</h2>
      <p>
        <b>{data.me.name}</b>, your bank was elimination {e?.order} of {data.quota.total}.
      </p>
      <div className="big neg">{money(0)}</div>
      {e && (
        <p className="muted">
          {e.cause}: {signedMoney(e.change)} took the balance from {money(e.before)} to zero.
        </p>
      )}
      <p className="muted small">You can keep watching the leaderboard and the final results. Your bank no longer takes decisions.</p>
    </section>
  );
}

function DecisionDesk({
  data,
  now,
  mine,
  onChoose,
  error,
}: {
  data: PlayerView;
  now: number;
  mine: "a" | "d" | null;
  onChoose: (c: "a" | "d") => void;
  error: string;
}) {
  const item = data.item!;
  const labels = choiceLabels(item.mode);
  const expired = data.deadlineAt !== null && now > data.deadlineAt;
  const locked = mine !== null || expired || data.status !== "running";
  return (
    <>
      <CaseFile item={item} showSignals={false} stake={item.mode === "loan" ? data.economy.loanStake : undefined} />
      <section className="card" style={{ position: "sticky", bottom: 8 }}>
        {data.deadlineAt !== null && (
          <TimerBar now={now} deadlineAt={data.deadlineAt} totalMs={data.economy.decisionSeconds * 1000 * data.scale} tiers={mine === null} />
        )}
        <div className="choices">
          <button className={`approve${mine === "a" ? " chosen" : ""}`} disabled={locked} onClick={() => onChoose("a")}>
            {labels.a}
          </button>
          <button className={`decline${mine === "d" ? " chosen" : ""}`} disabled={locked} onClick={() => onChoose("d")}>
            {labels.d}
          </button>
        </div>
        {mine !== null && <p className="muted">Decision locked: {mine === "a" ? labels.a : labels.d}. Waiting for the others…</p>}
        {mine === null && expired && <p className="muted">Time is up: this counts as {labels.d.toLowerCase()}.</p>}
        {error && <p className="err">{error}</p>}
      </section>
    </>
  );
}

function DecisionReveal({ data }: { data: PlayerView }) {
  const item = data.item!;
  const r = data.me.result;
  const rev = item.revealed;
  const labels = choiceLabels(item.mode);
  const tone = !r ? "meh" : r.ok ? "good" : r.delta >= 0 ? "meh" : "bad";
  return (
    <>
      <section className={`verdict ${tone}`}>
        {r ? (
          <>
            <span className="eyebrow">
              {r.c === null ? "No decision in time" : `You chose ${r.c === "a" ? labels.a : labels.d}`}
              {r.ok ? " · right call" : ""}
            </span>
            <strong>{r.label}</strong>
            <div className="row">
              <span className={`big ${r.raw >= 0 ? "pos" : "neg"}`}>{signedMoney(r.raw)}</span>
              {roiText(r.roi) && <span className="tag">{roiText(r.roi)}</span>}
              {r.speedBonus > 0 && <span className="tag accent">incl. speed bonus +{money(r.speedBonus)}</span>}
            </div>
            {r.note === "floored" && (
              <span className="tag accent">Safety floor: your balance stops at {money(data.economy.safetyFloor)}, so you stay in the game</span>
            )}
            <span className="muted small">Balance now {money(data.me.balance)}</span>
          </>
        ) : (
          <strong>You were not playing this case.</strong>
        )}
      </section>
      {rev && (
        <section className="card">
          <div className="row">
            <span className={`tag ${rev.correct === "a" ? "good" : "bad"}`}>{rev.title}</span>
            <span className="tag">{rev.category}</span>
          </div>
          <p>{rev.story}</p>
          <p>
            <b>Why:</b> {rev.explanation}
          </p>
          {item.mode === "loan" && r?.c !== "a" && (
            <p className="muted small">Declining earns the government-bill return on the uncommitted stake, not a reward for refusing the customer.</p>
          )}
        </section>
      )}
      {data.stats && (
        <section className="card">
          <span className="eyebrow">How the room decided</span>
          <Distribution stats={data.stats} item={item} />
          {(data.stats.eliminated ?? 0) > 0 && <p className="neg small">{data.stats.eliminated} bank(s) went bust on this case.</p>}
        </section>
      )}
      <CaseFile item={item} showSignals stake={item.mode === "loan" ? data.economy.loanStake : undefined} />
    </>
  );
}

function QuestionResult({ data }: { data: PlayerView }) {
  const item = data.item!;
  const r = data.me.result;
  const earned = r?.ok && item.reward === "powerup";
  return (
    <div className={`verdict ${r?.ok ? "good" : "meh"}`}>
      <strong>{r ? (r.ok ? "Correct" : r.c === null ? "No answer" : "Not this time") : "You were not playing this question"}</strong>
      {r?.ok && item.reward === "money" && <span className="pos big">{signedMoney(r.delta)}</span>}
      {earned && <span>You earned a power-up token. Its effect will be announced by your host.</span>}
      {item.answer && <span className="muted">Answer: {item.answer.text}</span>}
    </div>
  );
}

function FinalScreen({ data, code }: { data: PlayerView; code: string }) {
  const history = data.me.history ?? [];
  const onPodium = data.podiumRevealed && data.me.rank !== null && data.me.rank <= 3;
  if (!data.podiumRevealed) {
    return (
      <section className="card" style={{ alignItems: "center", textAlign: "center" }}>
        <span className="eyebrow">Game over</span>
        <h2>Results are final</h2>
        <p className="muted">Your balance: {money(data.me.balance)}. Watch the projector: the host is about to reveal the podium.</p>
      </section>
    );
  }
  return (
    <>
      {onPodium && <Confetti onceKey={`bmg:confetti:${code}:${data.me.id}`} />}
      <section className="card" style={{ alignItems: "center", textAlign: "center" }}>
        <span className="eyebrow">Final result</span>
        <div className="big">{money(data.me.balance)}</div>
        <h2>
          {data.me.status === "eliminated"
            ? `Eliminated #${data.me.elimination?.order}`
            : data.me.rank
              ? `Rank ${data.me.rank} of ${data.playerCount}`
              : "Game over"}
        </h2>
        {onPodium && <p className="pos">Congratulations, you finished in the top three!</p>}
        <p className="muted">{data.me.correct} correct decisions</p>
      </section>
      {data.podium && (
        <section className="card">
          <span className="eyebrow">Top three</span>
          <Podium podium={data.podium} />
        </section>
      )}
      {data.leaderboard && (
        <section className="card">
          <span className="eyebrow">Final ranking</span>
          <Leaderboard entries={data.leaderboard} eliminated={data.eliminatedBoard} meId={data.me.id} total={data.playerCount} />
        </section>
      )}
      <section className="card">
        <span className="eyebrow">What to take away</span>
        <Debrief />
      </section>
      <section className="card">
        <span className="eyebrow">Your bank&apos;s log</span>
        <div className="scroll">
          <table>
            <tbody>
              {history.map((h, i) => (
                <tr key={i}>
                  <td>{h.title}</td>
                  <td>
                    {h.kind === "adjust" ? (
                      <span className="tag accent">host</span>
                    ) : h.ok ? (
                      <span className="tag good">right</span>
                    ) : h.c === null ? (
                      <span className="tag">no answer</span>
                    ) : (
                      <span className="tag bad">wrong</span>
                    )}
                    {h.note && <span className="tag bad" style={{ marginLeft: 4 }}>{h.note}</span>}
                  </td>
                  <td className={`n ${h.delta > 0 ? "pos" : h.delta < 0 ? "neg" : ""}`}>{h.delta === 0 ? "–" : signedMoney(h.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
