"use client";

import { useCallback, useEffect, useState } from "react";
import type { HostView } from "@/lib/view-types";
import { api, ApiError, creds, groupDigits, money, signedMoney, useFrame, usePoll } from "./client";
import { CaseFile, choiceLabels, Distribution, Leaderboard, Podium, QuotaChip, SimpleCountdown } from "./ui";

const PHASE_LABEL: Record<string, string> = {
  lobby: "Lobby: players joining",
  intro: "Instructions",
  ready: "Get ready",
  open: "Decision window",
  reveal: "Reveal",
  question: "Quiz (own question each)",
  qreveal: "Quiz answers + leaderboard",
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

const time = (t: number) => new Date(t).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

function Console({ code, token }: { code: string; token: string }) {
  const [showAnswer, setShowAnswer] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState("");
  const [copied, setCopied] = useState(false);

  const fetcher = useCallback(() => api<HostView>(`/api/sessions/${code}/state?role=host`, { token }), [code, token]);
  const { data, error, poll, serverNow } = usePoll<HostView>(fetcher, (d, now) => {
    if (d.phase === "lobby") return 2000;
    if (d.phase === "final") return 4000;
    const toEnd = d.phaseEndsAt === null ? 1000 : Math.max(0, d.phaseEndsAt - now) + 60;
    return Math.min(1000, toEnd);
  });
  useFrame(!!data && data.status === "running" && data.phase !== "lobby" && data.phase !== "final");

  useEffect(() => setShowAnswer(false), [data?.itemIndex]);

  async function act(action: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    setActionErr("");
    try {
      await api(`/api/sessions/${code}/host`, { method: "POST", token, body: JSON.stringify({ action, ...extra }) });
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
  const live = data.phase === "open" || data.phase === "question";

  return (
    <main className="wrap wide">
      <div className="spread">
        <div>
          <div className="eyebrow">Host console · you run the session, players run their own banks · {data.storeKind === "memory" ? "local test store" : "shared store"}</div>
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
                window.prompt("Host link (keep it private: it gives full control):", hostLink);
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
          <b>{data.phase === "lobby" || data.phase === "intro" ? "–" : `${data.itemIndex + 1} / ${data.totalItems}`}</b>
        </div>
        <div className="stat">
          <span className="eyebrow">Time</span>
          <b>{data.status === "paused" ? `${Math.ceil((data.pausedRemainingMs ?? 0) / 1000)}s saved` : <SimpleCountdown now={now} endsAt={data.phaseEndsAt} />}</b>
        </div>
        <div className="stat">
          <span className="eyebrow">Players (connected)</span>
          <b>
            {data.playerCount} ({data.activeCount})
          </b>
        </div>
        <div className="stat">
          <span className="eyebrow">Answered</span>
          <b>{live ? `${data.submitted} / ${data.activeCount}` : "–"}</b>
        </div>
        <div className="stat">
          <span className="eyebrow">Eliminations</span>
          <b>
            {data.quota.used} / {data.quota.total}
            {data.quota.floorActive && <span className="tag accent" style={{ marginLeft: 6, fontSize: 11 }}>1 VND floor</span>}
          </b>
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
          <button className="go" disabled={busy} onClick={() => act("continue")}>
            Continue
          </button>
        )}
        {data.status === "running" && data.phase !== "lobby" && (
          <button
            disabled={busy}
            onClick={() => {
              if (live && !window.confirm("Close this now? Players who have not answered get the timeout outcome.")) return;
              act("skip");
            }}
          >
            {live ? "Close now" : "Next"}
          </button>
        )}
        {data.phase === "final" && !data.podiumRevealed && (
          <button className="go" disabled={busy} onClick={() => act("reveal-podium")}>
            Reveal podium
          </button>
        )}
        {data.phase !== "final" && (
          <button
            className="danger"
            disabled={busy}
            onClick={() =>
              window.confirm(
                "End the session now? Any open case or quiz is settled with the answers already in, then results become final. This cannot be undone.",
              ) && act("end")
            }
          >
            End session
          </button>
        )}
        {actionErr && <span className="err">{actionErr}</span>}
        {error && <span className="err">{error.message}</span>}
      </section>

      <section className="row small">
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input type="checkbox" checked={data.settings.boardOnScreen} onChange={(e) => act("board", { value: e.target.checked })} style={{ width: "auto" }} />
          Keep the leaderboard on the projector
        </label>
        <label style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <input
            type="checkbox"
            checked={data.settings.announceEliminations}
            onChange={(e) => act("announcements", { value: e.target.checked })}
            style={{ width: "auto" }}
          />
          Show elimination announcements on the projector
        </label>
        <button className="small ghost" onClick={() => act("dismiss")}>
          Dismiss current announcement
        </button>
      </section>

      <div className="grid2" style={{ alignItems: "start" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {data.phase === "final" && data.podium && (
            <section className="card">
              <span className="eyebrow">Podium {data.podiumRevealed ? "(revealed)" : "(only you can see this until you reveal it)"}</span>
              <Podium podium={data.podium} />
            </section>
          )}
          {item && data.phase !== "final" && (
            <section className="card">
              <div className="spread">
                <span className="eyebrow">
                  {item.type === "decision"
                    ? `Case ${item.decisionNo} · ${item.mode === "fraud" ? "fraud desk" : "loan"}`
                    : `Quiz ${item.questionNo} · ${item.reward === "money" ? "money only" : `power-up or −${data.economy.wrongAnswerPenaltyPct * 100}%`} · each player has their own random question`}
                </span>
                {item.type === "decision" && (
                  <button className="small ghost" onClick={() => setShowAnswer((s) => !s)}>
                    {showAnswer ? "Hide answer" : "Show answer"}
                  </button>
                )}
              </div>
              {showAnswer && item.revealed && (
                <div className="verdict good">
                  <strong>
                    {choiceLabels(item.mode)[item.revealed.correct]} · {item.revealed.title}
                  </strong>
                  <span>{item.revealed.explanation}</span>
                </div>
              )}
            </section>
          )}
          {item?.case && data.phase !== "final" && <CaseFile item={item} showSignals={showAnswer} stake={item.mode === "loan" ? data.economy.loanStake : undefined} />}
          {data.stats && item && (
            <section className="card">
              <span className="eyebrow">How the room did</span>
              <Distribution stats={data.stats} item={item} />
            </section>
          )}
          <AdjustPanel code={code} token={token} data={data} onDone={poll} />
          <EliminationLog data={data} />
          <AdjustmentLog data={data} />
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <section className="card">
            <span className="eyebrow">Leaderboard</span>
            <Leaderboard entries={data.leaderboard ?? []} eliminated={data.eliminatedBoard} total={data.playerCount - data.quota.used} />
          </section>
          <section className="card">
            <span className="eyebrow">Players</span>
            {data.players.length === 0 && <p className="muted">Nobody has joined yet.</p>}
            <div className="scroll">
              <table>
                <tbody>
                  {data.players.map((p) => (
                    <tr key={p.id}>
                      <td className="mono">{p.status === "eliminated" ? `✕${p.eliminationOrder}` : (p.rank ?? "")}</td>
                      <td>
                        <span title={p.active ? "connected" : "not seen in the last 10 s"} style={{ color: p.active ? "var(--good)" : "var(--muted)" }}>
                          ●
                        </span>{" "}
                        {p.name}
                        {p.late && <span className="tag" style={{ marginLeft: 6 }}>late</span>}
                        {p.status === "eliminated" && <span className="tag bad" style={{ marginLeft: 6 }}>out</span>}
                      </td>
                      <td className="n">{money(p.balance)}</td>
                      <td className="n">{p.correct}</td>
                      <td className="n">{p.powerUps > 0 ? `${p.powerUps} PU` : ""}</td>
                      <td className="n">
                        <button
                          className="small danger"
                          onClick={() => window.confirm(`Remove ${p.name} from the game?`) && act("kick", { playerId: p.id })}
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

type Preview = {
  name: string;
  before: number;
  change: number;
  after: number;
  outcome: "applied" | "eliminated" | "floored" | "refused";
  order: number | null;
  refusal: string | null;
};

const newKey = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * Add or subtract VND for one player: preview the consequence, then apply once. The form's key
 * stays the same until the adjustment succeeds, so a double click or a retry cannot apply it twice.
 */
function AdjustPanel({ code, token, data, onDone }: { code: string; token: string; data: HostView; onDone: () => void }) {
  const [playerId, setPlayerId] = useState("");
  const [op, setOp] = useState<"add" | "subtract">("subtract");
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(newKey);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);

  const digits = amount.replace(/\D/g, "");
  const body = { id: key, playerId, op, amount: Number(digits), reason };
  // Any change to the form invalidates the preview and gives the next submission a new key.
  useEffect(() => {
    setPreview(null);
    setKey(newKey());
  }, [playerId, op, digits, reason]);

  async function doPreview() {
    setMsg("");
    try {
      setPreview(await api<Preview>(`/api/sessions/${code}/adjust`, { method: "POST", token, body: JSON.stringify({ ...body, preview: true }) }));
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Preview failed.");
    }
  }

  async function apply() {
    setBusy(true);
    setMsg("");
    try {
      const r = await api<{ record: { name: string; after: number; outcome: string }; duplicate: boolean }>(`/api/sessions/${code}/adjust`, {
        method: "POST",
        token,
        body: JSON.stringify(body),
      });
      setMsg(
        r.duplicate
          ? "Already applied (this adjustment was only applied once)."
          : `Applied: ${r.record.name} now has ${money(r.record.after)}${r.record.outcome === "eliminated" ? " and is eliminated" : r.record.outcome === "floored" ? " (safety floor)" : ""}.`,
      );
      setAmount("");
      setReason("");
      onDone();
    } catch (e) {
      setMsg(e instanceof ApiError ? e.message : "Could not apply. Check the connection; retrying will not apply it twice.");
    }
    setBusy(false);
  }

  const candidates = data.players.slice().sort((a, b) => a.name.localeCompare(b.name));
  return (
    <section className="card">
      <span className="eyebrow">Adjust a balance</span>
      <div className="grid2">
        <label>
          Player
          <select value={playerId} onChange={(e) => setPlayerId(e.target.value)} className="select">
            <option value="">Choose…</option>
            {candidates.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {money(p.balance)}
                {p.status === "eliminated" ? " (eliminated)" : ""}
              </option>
            ))}
          </select>
        </label>
        <label>
          Operation
          <select value={op} onChange={(e) => setOp(e.target.value as "add" | "subtract")} className="select">
            <option value="subtract">Subtract</option>
            <option value="add">Add</option>
          </select>
        </label>
        <label>
          Amount (whole VND)
          <input inputMode="numeric" value={digits ? groupDigits(Number(digits)) : ""} onChange={(e) => setAmount(e.target.value)} placeholder="50.000.000" />
        </label>
        <label>
          Reason (recorded)
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={120} placeholder="e.g. Presentation bonus" />
        </label>
      </div>
      <div className="row">
        <button className="small" disabled={!playerId || !digits || !reason.trim()} onClick={doPreview}>
          Preview
        </button>
        {preview && preview.outcome !== "refused" && (
          <button
            className={`small ${preview.outcome === "eliminated" ? "danger" : "go"}`}
            disabled={busy}
            onClick={() => (preview.outcome !== "eliminated" || window.confirm(`This eliminates ${preview.name}. Apply?`)) && apply()}
          >
            Apply {signedMoney(preview.change)}
          </button>
        )}
      </div>
      {preview && (
        <div className={`verdict ${preview.outcome === "eliminated" ? "bad" : preview.outcome === "refused" ? "meh" : "good"}`}>
          <strong>
            {preview.name}: {money(preview.before)} → {money(preview.after)}
          </strong>
          <span>
            {preview.outcome === "refused" && preview.refusal}
            {preview.outcome === "eliminated" && `This deduction takes the balance to zero: ${preview.name} becomes elimination ${preview.order} of ${data.quota.total}.`}
            {preview.outcome === "floored" && `The elimination quota is used up, so the balance stops at the ${data.economy.safetyFloor} VND safety floor.`}
            {preview.outcome === "applied" && "No elimination. Rankings update when you apply."}
          </span>
        </div>
      )}
      {msg && <p className="small">{msg}</p>}
    </section>
  );
}

function EliminationLog({ data }: { data: HostView }) {
  return (
    <section className="card">
      <div className="spread">
        <span className="eyebrow">Elimination log</span>
        <QuotaChip quota={data.quota} />
      </div>
      {data.eliminations.length === 0 ? (
        <p className="muted small">No eliminations yet.</p>
      ) : (
        <div className="scroll">
          <table>
            <thead>
              <tr>
                <th>#</th>
                <th>Bank</th>
                <th>Triggered by</th>
                <th className="n">Change</th>
                <th className="n">At</th>
              </tr>
            </thead>
            <tbody>
              {data.eliminations.map((e) => (
                <tr key={e.order}>
                  <td className="mono">{e.order}</td>
                  <td>{e.name}</td>
                  <td className="small">{e.cause}</td>
                  <td className="n neg">
                    {signedMoney(e.change)} <span className="muted">from {money(e.before)}</span>
                  </td>
                  <td className="n">{time(e.at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {data.quota.floorActive && <p className="small" style={{ color: "var(--accent)" }}>Quota reached: remaining banks have a 1 VND safety floor.</p>}
    </section>
  );
}

function AdjustmentLog({ data }: { data: HostView }) {
  if (data.adjustments.length === 0) return null;
  return (
    <section className="card">
      <span className="eyebrow">Adjustment log</span>
      <div className="scroll">
        <table>
          <thead>
            <tr>
              <th>At</th>
              <th>Player</th>
              <th className="n">Change</th>
              <th>Reason</th>
              <th className="n">Before → after</th>
              <th>By</th>
            </tr>
          </thead>
          <tbody>
            {data.adjustments
              .slice()
              .reverse()
              .map((a) => (
                <tr key={a.id}>
                  <td className="mono">{time(a.at)}</td>
                  <td>
                    {a.name}
                    {a.outcome !== "applied" && <span className="tag bad" style={{ marginLeft: 6 }}>{a.outcome}</span>}
                  </td>
                  <td className={`n ${a.op === "add" ? "pos" : "neg"}`}>{signedMoney(a.op === "add" ? a.amount : -a.amount)}</td>
                  <td className="small">{a.reason}</td>
                  <td className="n small">
                    {money(a.before)} → {money(a.after)}
                  </td>
                  <td className="small muted">{a.actor}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
