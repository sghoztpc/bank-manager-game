"use client";

import { useCallback, useEffect, useState } from "react";
import type { HostView } from "@/lib/view-types";
import { api, cr, creds, useFrame, usePoll } from "./client";
import { CaseFile, choiceLabels, Distribution, Leaderboard, QuestionOptions, SimpleCountdown } from "./ui";

const PHASE_LABEL: Record<string, string> = {
  lobby: "Lobby: players joining",
  intro: "Instructions",
  ready: "Get ready",
  open: "Decision window",
  reveal: "Reveal",
  question: "Bonus question",
  qreveal: "Answer + leaderboard",
  final: "Finished",
};

export function HostApp({ code }: { code: string }) {
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    // A host link (#key=...) moves the controls to another device.
    const fromHash = new URLSearchParams(window.location.hash.slice(1)).get("key");
    if (fromHash) {
      creds.setHost(code, fromHash);
      history.replaceState(null, "", window.location.pathname);
    }
    setToken(fromHash ?? creds.host(code));
  }, [code]);
  if (token === undefined) return null;
  if (!token) {
    return (
      <main className="wrap narrow">
        <div className="card">
          <h2>Host controls for room {code}</h2>
          <p className="muted">
            This device does not hold the host key. Open the host link from the device that created the game, or{" "}
            <a href={`/screen/${code}`}>open the projector view</a> instead.
          </p>
        </div>
      </main>
    );
  }
  return <Console code={code} token={token} />;
}

function Console({ code, token }: { code: string; token: string }) {
  const [showAnswer, setShowAnswer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState("");
  const [copied, setCopied] = useState(false);

  const fetcher = useCallback(() => api<HostView>(`/api/sessions/${code}/state?role=host`, { token }), [code, token]);
  const { data, error, poll, serverNow } = usePoll<HostView>(fetcher, (d, now) => {
    if (d.phase === "lobby") return 2000;
    if (d.phase === "final") return 10000;
    const toEnd = d.phaseEndsAt === null ? 1000 : Math.max(0, d.phaseEndsAt - now) + 60;
    return Math.min(1000, toEnd);
  });
  useFrame(!!data && data.status === "running" && data.phase !== "lobby" && data.phase !== "final");

  useEffect(() => setShowAnswer(false), [data?.itemIndex]);

  async function act(action: string, playerId?: string) {
    setBusy(true);
    setActionErr("");
    try {
      await api(`/api/sessions/${code}/host`, { method: "POST", token, body: JSON.stringify({ action, playerId }) });
    } catch (e) {
      setActionErr(e instanceof Error ? e.message : "Action failed.");
    }
    setBusy(false);
    poll();
  }

  if (error && !data) {
    return (
      <main className="wrap narrow">
        <div className="card">
          <h2>Cannot load room {code}</h2>
          <p className="muted">{error.message}</p>
        </div>
      </main>
    );
  }
  if (!data) return <main className="wrap">Connecting…</main>;

  const now = serverNow();
  const item = data.item;
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const hostLink = `${origin}/host/${code}#key=${encodeURIComponent(token)}`;

  return (
    <main className="wrap wide">
      <div className="spread">
        <div>
          <div className="eyebrow">Host console · {data.storeKind === "memory" ? "local test store" : "shared store"}</div>
          <h1 style={{ fontSize: 34 }}>
            Room <span className="mono" style={{ color: "var(--accent)" }}>{code}</span>
          </h1>
        </div>
        <div className="row">
          <a className="btn small" href={`/screen/${code}`} target="_blank" rel="noreferrer">
            Open projector view
          </a>
          <button
            className="small ghost"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(hostLink);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                window.prompt("Host link (keep it private):", hostLink);
              }
            }}
          >
            {copied ? "Copied" : "Copy host link"}
          </button>
          <a className="btn small ghost" href={`/api/sessions/${code}/export?key=${encodeURIComponent(token)}`}>
            Export CSV
          </a>
        </div>
      </div>

      <section className="stats">
        <div className="stat">
          <span className="eyebrow">Phase</span>
          <b>{data.status === "paused" ? "Paused" : PHASE_LABEL[data.phase]}</b>
        </div>
        <div className="stat">
          <span className="eyebrow">Interaction</span>
          <b>
            {data.phase === "lobby" || data.phase === "intro" ? "–" : `${data.itemIndex + 1} / ${data.totalItems}`}
          </b>
        </div>
        <div className="stat">
          <span className="eyebrow">Time</span>
          <b>{data.status === "paused" ? `${Math.ceil((data.pausedRemainingMs ?? 0) / 1000)}s left` : <SimpleCountdown now={now} endsAt={data.phaseEndsAt} />}</b>
        </div>
        <div className="stat">
          <span className="eyebrow">Players (connected)</span>
          <b>
            {data.playerCount} ({data.activeCount})
          </b>
        </div>
        <div className="stat">
          <span className="eyebrow">Answered</span>
          <b>{data.phase === "open" || data.phase === "question" ? `${data.submitted} / ${data.activeCount}` : "–"}</b>
        </div>
      </section>

      <section className="row">
        {data.phase === "lobby" && (
          <button className="go" disabled={busy} onClick={() => act("start")}>
            Start game
          </button>
        )}
        {data.status === "running" && data.phase !== "lobby" && (
          <button disabled={busy} onClick={() => act("pause")}>
            Pause
          </button>
        )}
        {data.status === "paused" && (
          <button className="go" disabled={busy} onClick={() => act("resume")}>
            Resume
          </button>
        )}
        {data.status === "running" && data.phase !== "lobby" && (
          <button
            disabled={busy}
            onClick={() => {
              if (data.phase === "open" || data.phase === "question") {
                if (!window.confirm("Close this case now? Players who have not answered get the timeout outcome.")) return;
              }
              act("skip");
            }}
          >
            {data.phase === "open" || data.phase === "question" ? "Close now" : "Next"}
          </button>
        )}
        {actionErr && <span className="err">{actionErr}</span>}
        {error && <span className="err">{error.message}</span>}
      </section>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {item && (
            <section className="card">
              <div className="spread">
                <span className="eyebrow">
                  {item.type === "decision" ? `Case ${item.decisionNo} · ${item.mode === "fraud" ? "fraud desk" : "loan"}` : `Bonus question ${item.questionNo} · ${item.reward === "money" ? "money" : "power-up"}`}
                </span>
                <button className="small ghost" onClick={() => setShowAnswer((s) => !s)}>
                  {showAnswer ? "Hide answer" : "Show answer"}
                </button>
              </div>
              {showAnswer && item.revealed && (
                <div className="verdict good">
                  <strong>
                    {choiceLabels(item.mode)[item.revealed.correct]} · {item.revealed.title}
                  </strong>
                  <span>{item.revealed.explanation}</span>
                </div>
              )}
              {item.question && (
                <>
                  <h2 style={{ fontSize: 22 }}>{item.question.prompt}</h2>
                  <QuestionOptions item={showAnswer ? item : { ...item, answer: undefined }} chosen={null} />
                  {showAnswer && item.answer && <p className="muted small">{item.answer.explanation}</p>}
                </>
              )}
            </section>
          )}
          {item?.case && <CaseFile item={item} showSignals={showAnswer} />}
          {data.stats && item && (
            <section className="card">
              <span className="eyebrow">How the room decided</span>
              <Distribution stats={data.stats} item={item} />
            </section>
          )}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {data.leaderboard && data.leaderboard.length > 0 && (
            <section className="card">
              <span className="eyebrow">Leaderboard</span>
              <Leaderboard entries={data.leaderboard} total={data.playerCount} />
            </section>
          )}
          <section className="card">
            <span className="eyebrow">Players</span>
            {data.players.length === 0 && <p className="muted">Nobody has joined yet.</p>}
            <div className="scroll">
              <table>
                <tbody>
                  {data.players.map((p) => (
                    <tr key={p.id}>
                      <td className="mono">{p.rank ?? ""}</td>
                      <td>
                        <span title={p.active ? "connected" : "not seen in the last 10 s"} style={{ color: p.active ? "var(--good)" : "var(--muted)" }}>
                          ●
                        </span>{" "}
                        {p.name}
                        {p.late && <span className="tag" style={{ marginLeft: 6 }}>late</span>}
                      </td>
                      <td className="n">{cr(p.balance)}</td>
                      <td className="n">{p.correct}</td>
                      <td className="n">{p.powerUps > 0 ? `${p.powerUps} PU` : ""}</td>
                      <td className="n">
                        <button
                          className="small danger"
                          onClick={() => window.confirm(`Remove ${p.name} from the game?`) && act("kick", p.id)}
                          aria-label={`Remove ${p.name}`}
                        >
                          ✕
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
