"use client";

import { useEffect, useState } from "react";
import type { LeaderEntry, RevealStats } from "@/lib/types";
import type { EconomyView, ItemView, PublicRow, QuotaView } from "@/lib/view-types";
import { money, pct } from "./client";

const LETTERS = ["A", "B", "C", "D"];

export function choiceLabels(mode: "loan" | "fraud" | undefined) {
  return mode === "fraud" ? { a: "Allow", d: "Block" } : { a: "Approve", d: "Decline" };
}

function Rows({ rows, signals }: { rows: PublicRow[]; signals?: string[] }) {
  return (
    <dl className="kv">
      {rows.map((r, i) => (
        <div key={i} className={signals?.[i] === "bad" ? "flag-bad" : signals?.[i] === "good" ? "flag-good" : undefined}>
          <dt>{r.label}</dt>
          <dd>{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** The customer file. With `showSignals`, rows that mattered are tinted red or green. */
export function CaseFile({ item, showSignals, stake }: { item: ItemView; showSignals: boolean; stake?: number }) {
  const c = item.case;
  if (!c) return null;
  const signals = showSignals ? item.revealed?.signals : undefined;
  if (c.kind === "loan") {
    return (
      <section className="card">
        <div className="spread">
          <span className="eyebrow">{c.segment} loan file</span>
          <span className="eyebrow mono">
            {c.amount} · {c.term}
          </span>
        </div>
        <div>
          <h2 className="customer">{c.customer}</h2>
          <p className="muted small">{c.profile}</p>
        </div>
        <p>
          <span className="muted">Purpose: </span>
          {c.purpose}
        </p>
        {stake !== undefined && (
          <p className="small">
            <span className="muted">Your bank&apos;s exposure on this file: </span>
            <span className="mono">{money(stake)}</span>
          </p>
        )}
        <Rows rows={c.evidence} signals={signals} />
      </section>
    );
  }
  const split = c.profile.length;
  return (
    <section className="card">
      <span className="eyebrow">Fraud & security alert</span>
      <div className="headline">{c.headline}</div>
      <div>
        <h2 className="customer" style={{ fontSize: "20px" }}>
          {c.customer}
        </h2>
      </div>
      <div className="grid2">
        <div className="card" style={{ padding: 10, background: "var(--panel2)" }}>
          <span className="eyebrow">Normal activity</span>
          <Rows rows={c.profile} signals={signals?.slice(0, split)} />
        </div>
        <div className="card" style={{ padding: 10, background: "var(--panel2)" }}>
          <span className="eyebrow">This alert</span>
          <Rows rows={c.alert} signals={signals?.slice(split)} />
        </div>
      </div>
    </section>
  );
}

/** Countdown bar for a decision window, with the speed-bonus tier marks. */
export function TimerBar({ now, deadlineAt, totalMs, tiers }: { now: number; deadlineAt: number; totalMs: number; tiers?: boolean }) {
  const left = Math.max(0, deadlineAt - now);
  const frac = Math.min(1, left / totalMs);
  const secs = Math.ceil(left / 1000);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <div className="spread">
        <span className="eyebrow">Time left</span>
        <span className="mono" aria-live="off">
          {secs}s
        </span>
      </div>
      <div className={`timer${frac < 0.25 ? " low" : ""}`} role="progressbar" aria-valuemin={0} aria-valuemax={20} aria-valuenow={secs}>
        <i style={{ width: `${frac * 100}%` }} />
      </div>
      {tiers && (
        <div className="tiers" aria-hidden>
          <span>+5% speed bonus</span>
          <span>+4%</span>
          <span>+3%</span>
          <span>no bonus</span>
        </div>
      )}
    </div>
  );
}

export function SimpleCountdown({ now, endsAt }: { now: number; endsAt: number | null }) {
  if (endsAt === null) return null;
  return <span className="mono">{Math.max(0, Math.ceil((endsAt - now) / 1000))}s</span>;
}

function RankChange({ n }: { n: number }) {
  if (!n) return null;
  return (
    <span className={`tag ${n > 0 ? "good" : "bad"}`} aria-label={n > 0 ? `up ${n}` : `down ${-n}`} style={{ marginLeft: 6 }}>
      {n > 0 ? `▲${n}` : `▼${-n}`}
    </span>
  );
}

/**
 * Active players ranked by balance (shared ranks for ties), then eliminated players in a
 * separate, labelled section in elimination order at 0 VND.
 */
export function Leaderboard({
  entries,
  eliminated,
  meId,
  total,
}: {
  entries: LeaderEntry[];
  eliminated?: LeaderEntry[] | null;
  meId?: string;
  total?: number;
}) {
  if (entries.length === 0 && !eliminated?.length) return <p className="muted">No results yet.</p>;
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Bank</th>
            <th className="n">Balance</th>
            <th className="n">Correct</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((e) => (
            <tr key={e.id} className={e.id === meId ? "me" : undefined}>
              <td className="mono">{e.rank}</td>
              <td>
                {e.name}
                {e.id === meId && <span className="tag accent" style={{ marginLeft: 6 }}>you</span>}
                {e.late && <span className="tag" style={{ marginLeft: 6 }}>late</span>}
                <RankChange n={e.rankChange} />
              </td>
              <td className="n">{money(e.balance)}</td>
              <td className="n">{e.correct}</td>
            </tr>
          ))}
        </tbody>
        {eliminated && eliminated.length > 0 && (
          <tbody className="out">
            <tr>
              <th colSpan={4}>Eliminated</th>
            </tr>
            {eliminated.map((e) => (
              <tr key={e.id} className={e.id === meId ? "me" : undefined}>
                <td className="mono">✕{e.eliminationOrder}</td>
                <td>
                  {e.name} <span className="tag bad">out #{e.eliminationOrder}</span>
                </td>
                <td className="n">{money(0)}</td>
                <td className="n">{e.correct}</td>
              </tr>
            ))}
          </tbody>
        )}
      </table>
      {total !== undefined && total > entries.length && <p className="muted small">Top {entries.length} of {total} active banks</p>}
    </div>
  );
}

/** How the room decided (decisions), or how the room did on their own questions (quizzes). */
export function Distribution({ stats, item }: { stats: RevealStats; item: ItemView }) {
  if (item.type === "question") {
    const rows: [string, number, string][] = [
      ["Correct", stats.correct, "right"],
      ["Wrong", stats.wrong ?? 0, ""],
      ["No answer", stats.timeout, ""],
    ];
    const total = Math.max(1, stats.correct + (stats.wrong ?? 0) + stats.timeout);
    return <Bars rows={rows} total={total} />;
  }
  const labels = choiceLabels(item.mode);
  const total = Math.max(1, stats.approve + stats.decline + stats.timeout);
  const right = item.revealed?.correct;
  return (
    <Bars
      total={total}
      rows={[
        [labels.a, stats.approve, right === "a" ? "right" : ""],
        [labels.d, stats.decline, right === "d" ? "right" : ""],
        ["Timed out", stats.timeout, ""],
      ]}
    />
  );
}

function Bars({ rows, total }: { rows: [string, number, string][]; total: number }) {
  return (
    <div className="dist">
      {rows.map(([label, n, cls]) => (
        <div key={label}>
          <div className="spread small">
            <span>
              {label} {cls === "right" && <span className="tag good">right call</span>}
            </span>
            <span className="mono">{n}</span>
          </div>
          <div className={`bar ${cls}`}>
            <i style={{ width: `${(n / total) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A player's own quiz: options in their personal order; submits the option id. */
export function QuestionOptions({
  item,
  chosen,
  onPick,
  disabled,
}: {
  item: ItemView;
  chosen: number | null;
  onPick?: (id: number) => void;
  disabled?: boolean;
}) {
  if (!item.question) return null;
  const answer = item.answer?.id;
  return (
    <div className="options">
      {item.question.options.map((o, i) => {
        const cls = answer !== undefined ? (o.id === answer ? "right" : o.id === chosen ? "wrong" : "") : o.id === chosen ? "chosen" : "";
        return (
          <button key={o.id} className={cls} disabled={disabled || !onPick} onClick={() => onPick?.(o.id)}>
            <span className="letter">{LETTERS[i]}</span>
            <span>{o.text}</span>
          </button>
        );
      })}
    </div>
  );
}

export function QuotaChip({ quota }: { quota: QuotaView }) {
  return (
    <span className={`tag ${quota.floorActive ? "accent" : quota.used > 0 ? "bad" : ""}`}>
      Eliminations: {quota.used} / {quota.total}
      {quota.floorActive ? " · 1 VND floor active" : ""}
    </span>
  );
}

/** Podium for everyone ranked 1 to 3, ties included; empty places stay empty. */
export function Podium({ podium }: { podium: LeaderEntry[] }) {
  const at = (r: number) => podium.filter((e) => e.rank === r);
  const medal = ["🥇", "🥈", "🥉"];
  const slot = (r: number, cls: string) => {
    const people = at(r);
    return (
      <div className={cls}>
        <span className="place" aria-label={`Place ${r}`}>
          {people.length ? medal[r - 1] : ""}
        </span>
        {people.length ? (
          people.map((e) => (
            <div key={e.id}>
              <h2>{e.name}</h2>
              <span className="mono">{money(e.balance)}</span>
            </div>
          ))
        ) : (
          <span className="muted small">No bank in this place</span>
        )}
        {people.length > 1 && <span className="tag accent">tied</span>}
      </div>
    );
  };
  return (
    <div className="podium">
      {slot(2, "p2")}
      {slot(1, "p1")}
      {slot(3, "p3")}
    </div>
  );
}

/** Brief confetti burst. Plays once per key on this device, never blocks input, honours reduced motion. */
export function Confetti({ onceKey }: { onceKey: string }) {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      if (localStorage.getItem(onceKey)) return;
      localStorage.setItem(onceKey, "1");
    } catch {
      // No storage: still play once for this page view.
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
    setShow(true);
    const t = setTimeout(() => setShow(false), 3500);
    return () => clearTimeout(t);
  }, [onceKey]);
  if (!show) return null;
  const colours = ["#f2a93b", "#3cbf8f", "#5aa9ef", "#ef5a5f", "#e2e9f0"];
  return (
    <div className="confetti" aria-hidden>
      {Array.from({ length: 60 }, (_, i) => (
        <i
          key={i}
          style={{
            left: `${(i * 37) % 100}%`,
            background: colours[i % colours.length],
            animationDelay: `${(i % 12) * 0.08}s`,
            animationDuration: `${2.2 + (i % 5) * 0.25}s`,
          }}
        />
      ))}
    </div>
  );
}

/** The rules, generated from the live balancing numbers. */
export function Rules({ e, compact }: { e: EconomyView; compact?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p>
        You run a bank with <b>{money(e.startingBalance)}</b> of its own capital (a fictional classroom balance). Finish with the most money.
        24 cases, 20 seconds each, and 5 quiz questions.
      </p>
      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
        <li>
          <b>Loan files.</b> Each one puts {money(e.loanStake)} of lending at risk, more than your capital, as in a real bank. Repaid: about{" "}
          <span className="pos">+{money(e.referenceLoanGain)}</span>. Defaulted: about <span className="neg">−{money(e.referenceLoanLoss)}</span>. Decline:
          the money goes into government bills instead, <span className="pos">+{money(e.alternativeReturn)}</span>.
        </li>
        <li>
          <b>Fraud alerts</b> (every 4th case). Right call: <span className="pos">+{money(e.fraudReward)}</span>. Fraud let through:{" "}
          <span className="neg">−{money(e.fraudMissLoss)}</span>. Genuine customer blocked: <span className="neg">−{money(e.falseBlockLoss)}</span>.
        </li>
        <li>
          <b>Speed bonus</b> on correct decisions only: +5% of what you earned within 5 s, +4% within 10 s, +3% within 15 s, nothing after.
        </li>
        <li>
          <b>No decision in time</b> means the loan is declined or the payment blocked, with that outcome.
        </li>
        <li>
          <b>Bankruptcy.</b> The first {e.eliminationQuota} banks whose balance reaches 0 VND are eliminated. After that, every remaining bank has a{" "}
          {e.safetyFloor} VND safety floor.
        </li>
        {!compact && (
          <li>
            <b>Quiz.</b> You get your own question after cases 5, 10, 15 and 20: a correct answer earns a power-up (+{e.powerUpBoostPct * 100}% on
            what your next correct decision earns); a wrong answer, or none, costs <span className="neg">{e.wrongAnswerPenaltyPct * 100}% of your balance</span>.
            The last quiz, after case 24, pays <span className="pos">+{money(e.finalQuestionBonus)}</span> if correct. {e.quizSeconds} seconds each.
          </li>
        )}
      </ul>
      {!compact && (
        <p className="muted small">
          Reading guide: DSR (debt payments ÷ income) lower is safer, above ~50% is stretched. DSCR (cash flow ÷ debt payments) higher is safer,
          below ~1.2x is thin. LTV lower is safer. CIC group 1 = always on time; group 2+ = late payments. Returns are classroom amounts, not
          real banking forecasts.
        </p>
      )}
    </div>
  );
}

export function Debrief() {
  return (
    <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 6 }}>
      <li>
        <b>Credit risk</b> is about capacity (DSR, DSCR, verified cash flow) and willingness (history). Collateral reduces the loss; it does not repay the loan.
      </li>
      <li>
        <b>Leverage</b>: your bank lent more than its own capital on every file, so a few bad loans could wipe it out. That is why banks must hold capital buffers.
      </li>
      <li>
        <b>Fraud screening</b> weighs many signals together: a new phone or a big amount alone is not fraud, and scams can come from the customer&apos;s own device.
      </li>
      <li>
        <b>Cybersecurity incidents</b> are about who controls the access (SIM swaps, password resets, approved change windows), not just the payment.
      </li>
      <li>
        <b>Liquidity risk</b>: a profitable borrower or bank can still fail if cash arrives too late. Buffers matter.
      </li>
      <li>
        <b>Risks interact</b>: concentration in one sector or buyer makes defaults, falling collateral and funding stress arrive together.
      </li>
    </ul>
  );
}

export function roiText(roi: number | null) {
  return roi === null ? null : `ROI ${pct(roi)}`;
}
