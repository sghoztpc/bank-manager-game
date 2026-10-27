"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PlayerView } from "@/lib/view-types";
import { api, ApiError, cr, creds, signedCr, useFrame, usePoll, type PlayerCreds } from "./client";
import { CaseFile, choiceLabels, Debrief, Distribution, Leaderboard, QuestionOptions, roiText, Rules, SimpleCountdown, TimerBar } from "./ui";

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

function Game({ code, me, onLost }: { code: string; me: PlayerCreds; onLost: () => void }) {
  const lastHb = useRef(0);
  const lastPhase = useRef<string>("");
  const [pending, setPending] = useState<{ item: number; choice: "a" | "d" | number } | null>(null);
  const [submitErr, setSubmitErr] = useState("");

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
        return until(d.phaseEndsAt, d.me.submitted !== null ? 1500 : 2000);
      case "reveal":
      case "qreveal":
        return until(d.phaseEndsAt, 3000);
      case "final":
        return 15000;
    }
  });

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
      <header className="stats desk" aria-label="Your desk">
        <div className="stat">
          <span className="eyebrow">{data.me.name}</span>
          <b className={data.me.balance < data.economy.startingBalance ? "neg" : undefined}>{cr(data.me.balance)}</b>
        </div>
        <div className="stat">
          <span className="eyebrow">Rank</span>
          <b>{data.me.rank ? `${data.me.rank} / ${data.playerCount}` : "–"}</b>
        </div>
        <div className="stat">
          <span className="eyebrow">Case</span>
          <b>{decisionNo ? `${decisionNo} / ${data.totalDecisions}` : item?.type === "question" ? `Q${item.questionNo}` : "–"}</b>
        </div>
        <div className="stat">
          <span className="eyebrow">Power-ups</span>
          <b>{data.me.inventory.length}</b>
        </div>
      </header>

      {error && <p className="err">{error.message}</p>}

      {data.phase === "lobby" && (
        <section className="card">
          <h2>You&apos;re in, {data.me.name}.</h2>
          <p className="muted">Waiting for the host to start. Keep this page open.</p>
          <Rules e={data.economy} />
        </section>
      )}

      {data.phase === "intro" && (
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

      {data.phase === "ready" && item && (
        <section className="splash">
          <span className="eyebrow">{item.mode === "fraud" ? "Fraud & security alert" : "Loan file"}</span>
          <h2>Case {item.decisionNo}</h2>
          <div className="count">{data.phaseEndsAt ? Math.max(1, Math.ceil((data.phaseEndsAt - now) / 1000)) : ""}</div>
          {data.me.late && <p className="muted small">You joined late, so you start from the case you joined on.</p>}
        </section>
      )}

      {data.phase === "open" && item?.case && (
        <DecisionDesk
          data={data}
          now={now}
          mine={mine as "a" | "d" | null}
          onChoose={submit}
          error={submitErr}
        />
      )}

      {data.phase === "reveal" && item && <DecisionReveal data={data} />}

      {(data.phase === "question" || data.phase === "qreveal") && item?.question && (
        <section className="card">
          <div className="spread">
            <span className="eyebrow">
              Bonus question {item.questionNo} · {item.question.topic}
            </span>
            {data.phase === "question" && <SimpleCountdown now={now} endsAt={data.phaseEndsAt} />}
          </div>
          <h2 style={{ fontSize: 24 }}>{item.question.prompt}</h2>
          <p className="muted small">
            {item.reward === "money" ? `Correct answer: +${cr(data.economy.finalQuestionBonus)}. No power-up.` : "Correct answer: a power-up token. No penalty for a wrong answer."}
          </p>
          <QuestionOptions
            item={item}
            chosen={typeof mine === "number" ? mine : null}
            onPick={data.phase === "question" && mine === null && data.status === "running" ? (i) => submit(i) : undefined}
          />
          {submitErr && <p className="err">{submitErr}</p>}
          {data.phase === "question" && mine !== null && <p className="muted">Answer locked. Waiting for the others…</p>}
          {data.phase === "qreveal" && <QuestionResult data={data} />}
        </section>
      )}

      {data.phase === "qreveal" && data.leaderboard && (
        <section className="card">
          <span className="eyebrow">Leaderboard</span>
          <Leaderboard entries={data.leaderboard} meId={data.me.id} total={data.playerCount} />
        </section>
      )}

      {data.phase === "final" && <FinalScreen data={data} />}

      {data.status === "paused" && (
        <div className="overlay" role="dialog" aria-label="Paused">
          <div className="card">
            <h2>Paused</h2>
            <p className="muted">The host paused the game. Your timer is stopped.</p>
          </div>
        </div>
      )}
    </main>
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
      <CaseFile item={item} showSignals={false} />
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
              <span className={`big ${r.delta >= 0 ? "pos" : "neg"}`}>{signedCr(r.delta)}</span>
              {roiText(r.roi) && <span className="tag">{roiText(r.roi)}</span>}
              {r.speedBonus > 0 && <span className="tag accent">incl. speed bonus +{r.speedBonus}</span>}
            </div>
            <span className="muted small">Balance now {cr(data.me.balance)}</span>
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
        </section>
      )}
      <CaseFile item={item} showSignals />
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
      {r?.ok && item.reward === "money" && <span className="pos big">{signedCr(r.delta)}</span>}
      {earned && <span>You earned a power-up token. Its effect will be announced by your host.</span>}
      {item.answer && <span className="muted">{item.answer.explanation}</span>}
    </div>
  );
}

function FinalScreen({ data }: { data: PlayerView }) {
  const history = data.me.history ?? [];
  return (
    <>
      <section className="card" style={{ alignItems: "center", textAlign: "center" }}>
        <span className="eyebrow">Final result</span>
        <div className="big">{cr(data.me.balance)}</div>
        <h2>{data.me.rank ? `Rank ${data.me.rank} of ${data.playerCount}` : "Game over"}</h2>
        <p className="muted">
          {data.me.correct} correct decisions · {signedCr(data.me.balance - data.economy.startingBalance)} on the session
        </p>
      </section>
      {data.leaderboard && (
        <section className="card">
          <span className="eyebrow">Leaderboard</span>
          <Leaderboard entries={data.leaderboard} meId={data.me.id} total={data.playerCount} />
        </section>
      )}
      <section className="card">
        <span className="eyebrow">What to take away</span>
        <Debrief />
      </section>
      <section className="card">
        <span className="eyebrow">Your desk log</span>
        <div className="scroll">
          <table>
            <tbody>
              {history.map((h) => (
                <tr key={h.i}>
                  <td>{h.title}</td>
                  <td>{h.ok ? <span className="tag good">right</span> : h.c === null ? <span className="tag">no answer</span> : <span className="tag bad">wrong</span>}</td>
                  <td className={`n ${h.delta > 0 ? "pos" : h.delta < 0 ? "neg" : ""}`}>{h.delta === 0 ? "–" : signedCr(h.delta)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
