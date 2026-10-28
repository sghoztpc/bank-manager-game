"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useState } from "react";
import type { ScreenView } from "@/lib/view-types";
import type { Announcement } from "@/lib/types";
import { api, money, useFrame, usePoll } from "./client";
import { CaseFile, choiceLabels, Confetti, Debrief, Distribution, Leaderboard, Podium, QuotaChip, Rules, SimpleCountdown, TimerBar, Tutorial } from "./ui";

/** Each announcement shows for this long once the projector is allowed to show it. */
const ANNOUNCE_MS = 8000;

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
    if (d.phase === "final") return d.podiumRevealed ? 10000 : 1500;
    const toEnd = d.phaseEndsAt === null ? 1000 : Math.max(0, d.phaseEndsAt - now) + 60;
    return Math.min(1000, toEnd);
  });
  useFrame(!!data && data.phase !== "lobby" && !(data.phase === "final" && data.podiumRevealed));

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
  const activeBanks = data.playerCount - data.quota.used;
  const sideBoard = data.settings.boardOnScreen && data.leaderboard && data.phase !== "qreveal" && data.phase !== "final" && data.phase !== "lobby";

  return (
    <main className="screen">
      <div className="wrap wide">
        {data.phase !== "lobby" && (
          <div className="spread">
            <div className="eyebrow">
              Bank Manager · join at {host} · code <span className="mono" style={{ color: "var(--accent)" }}>{code}</span>
            </div>
            <div className="row">
              <QuotaChip quota={data.quota} />
              <span className="eyebrow">
                {data.phase !== "final" && item?.type === "decision" && `Case ${item.decisionNo} / ${data.totalDecisions} · `}
                {data.phase !== "final" && item?.type === "question" && `Quiz ${item.questionNo} / 5 · `}
                {activeBanks} active banks
              </span>
            </div>
          </div>
        )}

        {data.phase === "lobby" && data.tutorial && (
          <>
            <div className="spread">
              <div className="eyebrow">
                Join at {host} · code <span className="mono" style={{ color: "var(--accent)" }}>{code}</span>
              </div>
              <div className="eyebrow">
                {data.readyCount ?? 0} / {data.playerCount} ready
              </div>
            </div>
            <Tutorial t={data.tutorial} />
          </>
        )}

        {data.phase === "lobby" && !data.tutorial && (
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
              <p className="eyebrow">
                {data.playerCount} joined · {data.readyCount ?? 0} ready
              </p>
              {/^(localhost|127\.|\[::1\])/.test(host) && (
                <p className="err">
                  Phones cannot open &quot;localhost&quot;. Open this page using your computer&apos;s network address (for example
                  http://192.168.1.20:3000) so the QR code works.
                </p>
              )}
            </div>
          </div>
        )}
        {data.phase === "lobby" && !data.tutorial && data.names && data.names.length > 0 && (
          <div className="names">
            {data.names.map((n, i) => (
              <span key={i}>{n}</span>
            ))}
          </div>
        )}

        <div className={sideBoard ? "grid2" : undefined} style={{ alignItems: "start", display: sideBoard ? "grid" : "contents" }}>
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
                <CaseFile item={item} showSignals={false} stake={item.mode === "loan" ? data.economy.loanStake : undefined} />
              </>
            )}

            {data.phase === "reveal" && item && (
              <div className={sideBoard ? undefined : "grid2"} style={{ alignItems: "start", display: sideBoard ? "flex" : undefined, flexDirection: "column", gap: 16 }}>
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
                {!sideBoard && <CaseFile item={item} showSignals stake={item.mode === "loan" ? data.economy.loanStake : undefined} />}
              </div>
            )}

            {(data.phase === "question" || data.phase === "qreveal") && item && (
              <div className={data.phase === "qreveal" && !sideBoard ? "grid2" : undefined} style={{ alignItems: "start" }}>
                <section className="card">
                  <div className="spread">
                    <span className="eyebrow">
                      Quiz {item.questionNo} · {item.reward === "money"
                        ? `correct answer pays +${money(data.economy.finalQuestionBonus)}`
                        : `correct: +${data.economy.powerUpBoostPct * 100}% power-up · wrong: −${data.economy.wrongAnswerPenaltyPct * 100}% of balance`}
                    </span>
                    {data.phase === "question" && (
                      <span className="big">
                        <SimpleCountdown now={now} endsAt={data.phaseEndsAt} />
                      </span>
                    )}
                  </div>
                  <h2>{data.phase === "question" ? "Everyone has their own question. Answer on your phone." : "How the room did"}</h2>
                  {data.phase === "question" ? (
                    <p className="eyebrow">
                      {data.submitted} of {data.activeCount} answered
                    </p>
                  ) : (
                    data.stats && <Distribution stats={data.stats} item={item} />
                  )}
                </section>
                {data.phase === "qreveal" && data.leaderboard && !sideBoard && (
                  <section className="card">
                    <span className="eyebrow">Leaderboard</span>
                    <Leaderboard entries={data.leaderboard} eliminated={data.eliminatedBoard} total={activeBanks} />
                  </section>
                )}
              </div>
            )}

            {data.phase === "final" && <Final data={data} code={code} />}
          </div>

          {sideBoard && (
            <section className="card">
              <span className="eyebrow">Leaderboard</span>
              <Leaderboard entries={data.leaderboard!} eliminated={data.eliminatedBoard} total={activeBanks} />
            </section>
          )}
        </div>

        {data.status === "paused" && (
          <div className="overlay">
            <div className="card">
              <h2>Paused</h2>
            </div>
          </div>
        )}
      </div>
      <Announcements data={data} now={now} />
    </main>
  );
}

/**
 * Brief banner (not full screen) for eliminations and the safety-floor notice. Never shown while a
 * case or quiz is open; each shows once for a few seconds, and a reload does not replay it.
 */
function Announcements({ data, now }: { data: ScreenView; now: number }) {
  if (data.phase === "ready" || data.phase === "open" || data.phase === "question") return null;
  const dismissed = data.settings.announceDismissedAt ?? 0;
  const visible = data.announcements.filter((a: Announcement) => a.showFrom !== null && a.showFrom > dismissed && now - a.showFrom < ANNOUNCE_MS);
  if (visible.length === 0) return null;
  const floor = visible.find((a) => a.kind === "floor");
  const elims = visible.filter((a) => a.kind === "elimination");
  return (
    <div className={`announce ${floor && elims.length === 0 ? "floor" : ""}`} role="status">
      <span style={{ fontSize: 40 }} aria-hidden>
        {floor && elims.length === 0 ? "🛟" : "💥"}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {elims.length > 0 && <strong>{elims.length === 1 ? "Bank eliminated" : `${elims.length} banks eliminated`}</strong>}
        {elims.map((a) => (
          <span key={a.id}>{a.text}</span>
        ))}
        {floor && <span style={{ color: "var(--accent)", fontWeight: 600 }}>{floor.text}</span>}
      </div>
    </div>
  );
}

function Final({ data, code }: { data: ScreenView; code: string }) {
  const activeBanks = data.playerCount - data.quota.used;
  if (!data.podiumRevealed) {
    return (
      <section className="splash">
        <span className="eyebrow">{data.endedEarly ? "Session ended by the host" : "All 29 interactions complete"}</span>
        <h1>Results are final</h1>
        <p className="muted">The podium will be revealed by the host.</p>
      </section>
    );
  }
  return (
    <>
      <Confetti onceKey={`bmg:confetti:${code}:screen`} />
      <h1>Congratulations to the top three!</h1>
      {data.podium && data.podium.length > 0 ? <Podium podium={data.podium} /> : <p className="muted">No bank finished the game.</p>}
      <div className="grid2" style={{ alignItems: "start" }}>
        <section className="card">
          <span className="eyebrow">Full final ranking</span>
          <Leaderboard entries={data.leaderboard ?? []} eliminated={data.eliminatedBoard} total={activeBanks} />
        </section>
        <section className="card">
          <span className="eyebrow">Debrief</span>
          <Debrief />
        </section>
      </div>
    </>
  );
}
