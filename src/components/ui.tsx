"use client";

import type { LeaderEntry, RevealStats } from "@/lib/types";
import type { EconomyView, ItemView, PublicRow } from "@/lib/view-types";
import { cr, pct } from "./client";

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
export function CaseFile({ item, showSignals }: { item: ItemView; showSignals: boolean }) {
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

export function Leaderboard({ entries, meId, total }: { entries: LeaderEntry[]; meId?: string; total?: number }) {
  if (entries.length === 0) return <p className="muted">No results yet.</p>;
  return (
    <div className="scroll">
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Manager</th>
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
                {e.late && (
                  <span className="tag" style={{ marginLeft: 6 }}>
                    late
                  </span>
                )}
              </td>
              <td className="n">{cr(e.balance)}</td>
              <td className="n">{e.correct}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {total !== undefined && total > entries.length && <p className="muted small">Top {entries.length} of {total}</p>}
    </div>
  );
}

/** How the room decided, with the right answer highlighted. */
export function Distribution({ stats, item }: { stats: RevealStats; item: ItemView }) {
  if (item.type === "question" && stats.options && item.question) {
    const total = Math.max(1, stats.options.reduce((a, b) => a + b, 0) + stats.timeout);
    return (
      <div className="dist">
        {item.question.options.map((o, i) => (
          <div key={i}>
            <div className="spread small">
              <span>
                {LETTERS[i]}. {o}
              </span>
              <span className="mono">{stats.options![i]}</span>
            </div>
            <div className={`bar${item.answer?.answerIndex === i ? " right" : ""}`}>
              <i style={{ width: `${(stats.options![i] / total) * 100}%` }} />
            </div>
          </div>
        ))}
      </div>
    );
  }
  const labels = choiceLabels(item.mode);
  const total = Math.max(1, stats.approve + stats.decline + stats.timeout);
  const right = item.revealed?.correct;
  const rows: [string, number, boolean][] = [
    [labels.a, stats.approve, right === "a"],
    [labels.d, stats.decline, right === "d"],
    ["Timed out", stats.timeout, false],
  ];
  return (
    <div className="dist">
      {rows.map(([label, n, ok]) => (
        <div key={label}>
          <div className="spread small">
            <span>
              {label} {ok && <span className="tag good">right call</span>}
            </span>
            <span className="mono">{n}</span>
          </div>
          <div className={`bar${ok ? " right" : ""}`}>
            <i style={{ width: `${(n / total) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function QuestionOptions({
  item,
  chosen,
  onPick,
  disabled,
}: {
  item: ItemView;
  chosen: number | null;
  onPick?: (i: number) => void;
  disabled?: boolean;
}) {
  if (!item.question) return null;
  const answer = item.answer?.answerIndex;
  return (
    <div className="options">
      {item.question.options.map((o, i) => {
        const cls = answer !== undefined ? (i === answer ? "right" : i === chosen ? "wrong" : "") : i === chosen ? "chosen" : "";
        return (
          <button key={i} className={cls} disabled={disabled || !onPick} onClick={() => onPick?.(i)}>
            <span className="letter">{LETTERS[i]}</span>
            <span>{o}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The rules, generated from the live balancing numbers. */
export function Rules({ e, compact }: { e: EconomyView; compact?: boolean }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <p>
        You run a lending desk with <b>{cr(e.startingBalance)}</b> (fictional credits). Finish with the most money. 24 cases, 20
        seconds each, and 5 bonus questions.
      </p>
      <ul style={{ margin: 0, paddingLeft: 18, display: "flex", flexDirection: "column", gap: 4 }}>
        <li>
          <b>Loan files.</b> Each commits {cr(e.loanStake)}. Approve a loan that is repaid: about <span className="pos">+{cr(e.referenceLoanGain)}</span>. Approve one
          that defaults: about <span className="neg">−{cr(e.referenceLoanLoss)}</span>. Decline: the money goes into government bills instead, <span className="pos">+{cr(e.alternativeReturn)}</span>.
        </li>
        <li>
          <b>Fraud alerts</b> (every 4th case). Right call: <span className="pos">+{cr(e.fraudReward)}</span>. Fraud let through:{" "}
          <span className="neg">−{cr(e.fraudMissLoss)}</span>. Genuine customer blocked: <span className="neg">−{cr(e.falseBlockLoss)}</span>.
        </li>
        <li>
          <b>Speed bonus</b> on correct decisions only: +5% of what you earned within 5 s, +4% within 10 s, +3% within 15 s, nothing after.
        </li>
        <li>
          <b>No decision in time</b> means the loan is declined or the payment blocked, with that outcome.
        </li>
        {!compact && (
          <li>
            <b>Bonus questions</b> after cases 5, 10, 15 and 20 earn a power-up token; the last one, after case 24, pays{" "}
            <span className="pos">+{cr(e.finalQuestionBonus)}</span>.
          </li>
        )}
      </ul>
      {!compact && (
        <p className="muted small">
          Reading guide: DSR (debt payments ÷ income) lower is safer, above ~50% is stretched. DSCR (cash flow ÷ debt payments) higher
          is safer, below ~1.2x is thin. LTV lower is safer. CIC group 1 = always on time; group 2+ = late payments. Returns are
          classroom points, not real banking forecasts.
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
      <li>Declining is never free: the safe alternative earns less, so a bank that refuses all risk also falls behind.</li>
    </ul>
  );
}

export function roiText(roi: number | null) {
  return roi === null ? null : `ROI ${pct(roi)}`;
}
