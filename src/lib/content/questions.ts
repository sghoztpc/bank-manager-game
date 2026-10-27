import type { BonusQuestion } from "../types";

// PLACEHOLDERS: these must be checked against, or replaced with, the group's presentation
// before a real class. Keep the slot order: slot 3 and slot 4 deliberately cover liquidity risk
// and risk interactions, which the decision cases only touch on.
// Slots 1-4 award a power-up token; slot 5 awards money only.

export const QUESTIONS: BonusQuestion[] = [
  {
    id: "Q1",
    topic: "Credit risk",
    prompt: "Which measure shows whether a borrower's income can cover ALL of their debt payments?",
    options: ["Loan-to-value ratio (LTV)", "Debt service ratio (DSR)", "The loan's interest rate", "The collateral's market price"],
    answerIndex: 1,
    explanation: "DSR compares total debt payments with income. LTV only tells you how much collateral backs the loan.",
  },
  {
    id: "Q2",
    topic: "Operational risk and fraud",
    prompt: "A customer is tricked into sending money to a fake \"safe account\". Which risk category is this for the bank?",
    options: ["Market risk", "Liquidity risk", "Operational risk (external fraud)", "Interest rate risk"],
    answerIndex: 2,
    explanation: "Losses from fraud, failed processes or systems are operational risk, separate from credit risk on loans.",
  },
  {
    id: "Q3",
    topic: "Liquidity risk",
    prompt: "What is liquidity risk for a bank?",
    options: [
      "Borrowers fail to repay their loans",
      "The bank cannot meet cash outflows when due without heavy losses",
      "Share prices fall on the stock market",
      "Staff make mistakes in processing payments",
    ],
    answerIndex: 1,
    explanation: "A bank can be solvent on paper and still fail if it cannot turn assets into cash fast enough to pay depositors.",
  },
  {
    id: "Q4",
    topic: "Interactions between risks",
    prompt: "A bank lends heavily to property developers, secured on land. Land prices fall 30%. What is most likely?",
    options: [
      "Only credit risk rises; the land collateral fully protects the bank",
      "Defaults rise while collateral values fall, and losses can trigger liquidity strain",
      "Only operational risk rises",
      "Nothing changes until the loans mature",
    ],
    answerIndex: 1,
    explanation: "Concentration links the risks: the same price fall raises defaults, shrinks collateral, and can make depositors and lenders pull funding.",
  },
  {
    id: "Q5",
    topic: "Liquidity risk management",
    prompt: "Which tool best helps a bank survive a sudden wave of deposit withdrawals?",
    options: [
      "Approving more long-term loans",
      "Holding a buffer of high-quality liquid assets",
      "Raising interest rates on existing loans",
      "Relaxing fraud checks to speed up payments",
    ],
    answerIndex: 1,
    explanation: "High-quality liquid assets (the idea behind the Liquidity Coverage Ratio) can be sold or pledged quickly for cash.",
  },
];
