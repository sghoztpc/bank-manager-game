import type { LoanCase } from "../types";

// The host-only tutorial case (Brief 3). It is NOT in the live case pool, so demonstrating it
// never gives away a live answer. Figures are consistent: repayments 9.000.000 + 8.500.000 =
// 17.500.000 VND a month against income of 25.000.000 VND a month = DSR 70%.

export const TUTORIAL_CASE: LoanCase = {
  id: "T01",
  kind: "loan",
  customer: "Hoàng Văn Mẫu (example customer)",
  profile: "35 · delivery company driver · Hà Nội",
  segment: "Personal",
  purpose: "Buy a car for the family",
  amount: "400.000.000 VND",
  term: "5 years",
  evidence: [
    { label: "Income", value: "25.000.000 VND/month salary (verified)", signal: "neutral" },
    { label: "Existing repayments", value: "9.000.000 VND/month (motorbike loan + credit card)", signal: "bad" },
    { label: "New loan repayment", value: "8.500.000 VND/month", signal: "neutral" },
    { label: "DSR after loan", value: "70%", signal: "bad" },
    { label: "Repayment history", value: "CIC group 2 · 40 days late on the motorbike loan last year", signal: "bad" },
    { label: "Collateral", value: "The car · LTV 95%", signal: "bad" },
  ],
  outcome: {
    result: "default",
    pct: 0.3,
    story: "Two repayments were missed by month 8. The bank repossessed the car and sold it below the loan balance.",
  },
  explanation:
    "70% of his income was already promised to lenders, his recent history shows late payments, and the car barely covers the loan. Too little room for a bad month.",
};

/** Plain-language notes, keyed by the evidence row label (plus the header fields). */
export const TUTORIAL_NOTES: Record<string, string> = {
  amount: "Loan principal: the total the customer wants to borrow, paid back over the term. Not a monthly figure.",
  stake: "In the game every loan file puts the same 500.000.000 VND of your bank's lending at risk, so no single file decides the game.",
  Income: "Money coming in each month that can pay the loan. \"Verified\" means the bank has seen proof.",
  "Existing repayments": "What the customer already pays other lenders each month. Same unit as income: per month.",
  "New loan repayment": "What this loan would add each month. Compare monthly with monthly, never with the 400.000.000 VND principal.",
  "DSR after loan":
    "Debt Service Ratio = all monthly repayments ÷ monthly income = (9.000.000 + 8.500.000) ÷ 25.000.000 = 70%. Lower is safer; above about 50% is stretched.",
  "Repayment history":
    "CIC = Vietnam's national Credit Information Centre. Group 1 = always paid on time; group 2 = 10 to 90 days late; group 3 and above = bad debt.",
  Collateral:
    "An asset pledged as security. LTV (Loan-to-Value) = loan ÷ asset value. 95% means the car barely covers the loan. Collateral reduces the loss if things go wrong; it does not make the customer able to pay.",
};

export const TUTORIAL_STEPS = ["inspect", "decide", "reveal"] as const;
export type TutorialStep = (typeof TUTORIAL_STEPS)[number];
