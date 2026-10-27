"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import type { ScreenView } from "@/lib/view-types";
import { api, cr, useFrame, usePoll } from "./client";
import { CaseFile, choiceLabels, Debrief, Distribution, Leaderboard, QuestionOptions, Rules, SimpleCountdown, TimerBar } from "./ui";

function useJoinUrl(code: string) {
  const [url, setUrl] = useState("");
  const [svg, setSvg] = useState("");
  useEffect(() => {
    const u = `${window.location.origin}/play/${code}`;
    setUrl(u);
    QRCode.toString(u, { type: "svg", margin: 0, errorCorrectionLevel: "M" }).then(setSvg, () => setSvg(""));
  }, [code]);
  return { url, svg };
}

export function ScreenApp({ code }: { code: string }) {
  const { url, svg } = useJoinUrl(code);
  const fetcher = useCallback(() => api<ScreenView>(`/api/sessions/${code}/state?role=screen`), [code]);
  const { data, error, serverNow } = usePoll<ScreenView>(fetcher, (d, now) => {
    if (d.phase === "lobby") return 1500;
    if (d.phase === "final") return 10000;
    const toEnd = d.phaseEndsAt === null ? 1000 : Math.max(0, d.phaseEndsAt - now) + 60;
    return Math.min(1000, toEnd);
  });
  useFrame(!!data && data.status === "running" && data.phase !== "lobby" && data.phase !== "final");

  if (!data) {
    return (
      <main className="screen">
        <div className="wrap wide">
          <p className="muted">{error ? error.message : "Connecting…"}</p>
        </div>
      </main>
    );
  }

  const now = serverNow();
  const item = data.item;
  const host = url.replace(/^https?:\/\//, "").replace(/\/play\/.*/, "");

  return (
    <main className="screen">
      <div className="wrap wide">
        {data.phase !== "lobby" && (
          <div className="spread">
            <div className="eyebrow">
              Bank Manager · join at {host} · code <span className="mono" style={{ color: "var(--accent)" }}>{code}</span>
            </div>
            <div className="eyebrow">
              {item?.type === "decision" && `Case ${item.decisionNo} / ${data.totalDecisions}`}
              {item?.type === "question" && `Bonus question ${item.questionNo} / 5`}
              {" · "}
              {data.playerCount} players
            </div>
          </div>
        )}

        {data.phase === "lobby" && (
          <div className="grid2" style={{ alignItems: "center" }}>
            <div className="qr" aria-label={`QR code for ${url}`} dangerouslySetInnerHTML={{ __html: svg }} />
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <h1>
                Bank <span style={{ color: "var(--accent)" }}>Manager</span>
              </h1>
              <p className="muted">Scan to join, or go to</p>
              <p className="mono" style={{ fontSize: 28 }}>
                {host}
              </p>
              <p className="muted">and enter the room code</p>
              <div className="joincode">{code}</div>
              <p className="eyebrow">{data.playerCount} joined</p>
              {/^(localhost|127\.|\[::1\])/.test(host) && (
                <p className="err">
                  Phones cannot open &quot;localhost&quot;. Open this page using your computer&apos;s network address (for example
                  http://192.168.1.20:3000) so the QR code works.
                </p>
              )}
            </div>
          </div>
        )}
        {data.phase === "lobby" && data.names && data.names.length > 0 && (
          <div className="names">
            {data.names.map((n, i) => (
              <span key={i}>{n}</span>
            ))}
          </div>
        )}

        {data.phase === "intro" && (
          <section className="card">
            <div className="spread">
              <h2>How it works</h2>
              <span className="big">
                <SimpleCountdown now={now} endsAt={data.phaseEndsAt} />
              </span>
            </div>
            <Rules e={data.economy} />
          </section>
        )}

        {data.phase === "ready" && item && (
          <section className="splash">
            <span className="eyebrow">{item.mode === "fraud" ? "Fraud & security alert" : "Loan file"}</span>
            <h1>Case {item.decisionNo}</h1>
            <div className="count">{data.phaseEndsAt ? Math.max(1, Math.ceil((data.phaseEndsAt - now) / 1000)) : ""}</div>
          </section>
        )}

        {data.phase === "open" && item && (
          <>
            {data.deadlineAt !== null && <TimerBar now={now} deadlineAt={data.deadlineAt} totalMs={20000 * data.scale} tiers />}
            <p className="eyebrow">
              {data.submitted} of {data.activeCount} answered
            </p>
            <CaseFile item={item} showSignals={false} />
          </>
        )}

        {data.phase === "reveal" && item && (
          <div className="grid2" style={{ alignItems: "start" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              {item.revealed && (
                <section className={`verdict ${item.revealed.correct === "a" ? "good" : "bad"}`}>
                  <span className="eyebrow">{item.revealed.category}</span>
                  <strong style={{ fontSize: 40 }}>
                    Right call: {choiceLabels(item.mode)[item.revealed.correct]} · {item.revealed.title}
                  </strong>
                  <p>{item.revealed.story}</p>
                  <p>{item.revealed.explanation}</p>
                </section>
              )}
              {data.stats && (
                <section className="card">
                  <span className="eyebrow">How the room decided</span>
                  <Distribution stats={data.stats} item={item} />
                </section>
              )}
            </div>
            <CaseFile item={item} showSignals />
          </div>
        )}

        {(data.phase === "question" || data.phase === "qreveal") && item?.question && (
          <div className={data.phase === "qreveal" ? "grid2" : undefined} style={{ alignItems: "start" }}>
            <section className="card">
              <div className="spread">
                <span className="eyebrow">
                  Bonus question {item.questionNo} · {item.question.topic} · {item.reward === "money" ? `+${cr(data.economy.finalQuestionBonus)}` : "power-up"}
                </span>
                {data.phase === "question" && (
                  <span className="big">
                    <SimpleCountdown now={now} endsAt={data.phaseEndsAt} />
                  </span>
                )}
              </div>
              <h2>{item.question.prompt}</h2>
              {data.phase === "question" ? (
                <>
                  <QuestionOptions item={item} chosen={null} />
                  <p className="eyebrow">
                    {data.submitted} of {data.activeCount} answered
                  </p>
                </>
              ) : (
                data.stats && <Distribution stats={data.stats} item={item} />
              )}
              {data.phase === "qreveal" && item.answer && <p className="muted">{item.answer.explanation}</p>}
            </section>
            {data.phase === "qreveal" && data.leaderboard && (
              <section className="card">
                <span className="eyebrow">Leaderboard</span>
                <Leaderboard entries={data.leaderboard} total={data.playerCount} />
              </section>
            )}
          </div>
        )}

        {data.phase === "final" && <Final data={data} />}

        {data.status === "paused" && (
          <div className="overlay">
            <div className="card">
              <h2>Paused</h2>
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function Final({ data }: { data: ScreenView }) {
  const top = data.leaderboard ?? [];
  const [first, second, third] = top;
  const slot = (e: (typeof top)[number] | undefined, cls: string, place: string) =>
    e ? (
      <div className={cls}>
        <span className="place">{place}</span>
        <h2>{e.name}</h2>
        <span className="mono">{cr(e.balance)}</span>
        <span className="muted small">{e.correct} correct</span>
      </div>
    ) : (
      <div className={cls} />
    );
  return (
    <>
      <h1>Final results</h1>
      <div className="podium">
        {slot(second, "p2", "2")}
        {slot(first, "p1", "1")}
        {slot(third, "p3", "3")}
      </div>
      <div className="grid2" style={{ alignItems: "start" }}>
        <section className="card">
          <span className="eyebrow">Leaderboard</span>
          <Leaderboard entries={top} total={data.playerCount} />
        </section>
        <section className="card">
          <span className="eyebrow">Debrief</span>
          <Debrief />
        </section>
      </div>
    </>
  );
}
