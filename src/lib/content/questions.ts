import type { QuizCategory, QuizQuestion } from "../types";

// Source: banking_risk_management_balanced_mcq.docx (group project), as transcribed in
// Implementation Brief 2. Stems, options and supplied answer keys are kept verbatim; only the
// "A. " option prefixes are stripped, because options are shuffled per player.
//
// This is NOT an independently validated answer bank. Items with `review` are kept out of play
// until the group checks them against the presentation (set `playable: true` once resolved).

const LETTERS = ["A", "B", "C", "D"] as const;

function q(
  id: string,
  category: QuizCategory,
  stem: string,
  options: [string, string, string, string],
  key: (typeof LETTERS)[number],
  suppliedAnswer: string,
  review?: string,
): QuizQuestion {
  const colon = stem.indexOf(":");
  return {
    id,
    category,
    topic: colon > 0 && colon < 60 ? stem.slice(0, colon).trim() : category,
    prompt: colon > 0 && colon < 60 ? stem.slice(colon + 1).trim() : stem,
    options,
    answerIndex: LETTERS.indexOf(key),
    suppliedAnswer,
    review: review ?? null,
    playable: !review,
  };
}

export const QUIZ_POOL: QuizQuestion[] = [
  // ---------- 1: Warm-up ----------
  q(
    "Q01",
    "warm-up",
    "Specialized terminology: In banking operations, the term Non-Performing Loans typically refers to which loan classification groups according to the State Bank of Vietnam regulations?",
    [
      "Groups 1 to 2 representing standard performing assets with low default probabilities",
      "Groups 3 to 5 including substandard doubtful and loss loans carrying high credit risk",
      "Group 1 only covering fully collateralized short term commercial corporate loans",
      "Group 2 only comprising restructured loans with temporary delayed interest payments",
    ],
    "B",
    "B. Groups 3 to 5 including substandard doubtful and loss loans carrying high credit risk",
  ),
  q(
    "Q02",
    "warm-up",
    "Interest rates: What is the term for the difference between the borrowing rate and the lending rate of a commercial bank?",
    [
      "Net Interest Margin measuring the net profitability spread generated from interest earning assets",
      "Capital Adequacy Ratio evaluating total regulatory capital against risk weighted assets",
      "Return on Equity calculating net income relative to total shareholder equity investments",
      "Loan to Deposit Ratio determining total loans granted compared to customer deposits held",
    ],
    "A",
    "A. Net Interest Margin measuring the net profitability spread generated from interest earning assets",
    "The stem describes the interest-rate spread (lending rate minus borrowing rate). Net interest margin is net interest income divided by average earning assets, a different measure. Proposed fix: ask for the \"interest rate spread\" and offer it as option A, or reword the stem to describe NIM.",
  ),
  q(
    "Q03",
    "warm-up",
    "Capital adequacy: Which international treaty establishes global standards for bank capital, financial leverage, and liquidity?",
    [
      "Bretton Woods Agreement fixing international currency exchange rates post World War II",
      "The Basel Accords setting comprehensive international regulatory frameworks for banking safety",
      "Kyoto Protocol establishing international treaty commitments for reducing greenhouse emissions",
      "Maastricht Treaty creating the European Union and setting single currency convergence criteria",
    ],
    "B",
    "B. The Basel Accords setting comprehensive international regulatory frameworks for banking safety",
  ),
  q(
    "Q04",
    "warm-up",
    "Liquidity: What is the term for the mandatory funds that commercial banks must deposit at the Central Bank to ensure liquidity?",
    [
      "Excess Reserves held voluntarily above regulatory requirements for intraday clearing",
      "Required Reserves mandated by monetary authorities to safeguard immediate cash demands",
      "Tier Capital representing permanent shareholder equity and disclosed financial reserves",
      "Retained Earnings accumulated from prior years net profits reinvested into business growth",
    ],
    "B",
    "B. Required Reserves mandated by monetary authorities to safeguard immediate cash demands",
  ),
  q(
    "Q05",
    "warm-up",
    "Banking technology: What is the acronym of the global financial telecommunication network used to execute international wire transfers between banks?",
    [
      "SWIFT representing the secure messaging system connecting worldwide financial institutions",
      "VISA denoting the multinational payment card services corporation facilitating retail purchases",
      "ATM signifying automated teller machines providing self service cash withdrawal access",
      "IBAN designating international bank account numbers used for cross border identification",
    ],
    "A",
    "A. SWIFT representing the secure messaging system connecting worldwide financial institutions",
  ),
  q(
    "Q06",
    "warm-up",
    "Credit risk: What is the general English term for assets pledged by borrowers to secure a loan?",
    [
      "Dividend representing periodic profit distributions paid out to corporate shareholders",
      "Collateral signifying valuable property pledged as security against default repayment risk",
      "Equity denoting residual ownership interest in assets after deducting all liabilities",
      "Goodwill measuring intangible value arising from business reputation and customer lists",
    ],
    "B",
    "B. Collateral signifying valuable property pledged as security against default repayment risk",
  ),
  q(
    "Q07",
    "warm-up",
    "Interest rate risk: When the Central Bank decides to increase its policy rate, will the market value of long-term bonds held by banks increase or decrease?",
    [
      "Increase because higher market yields drive greater demand for existing fixed income assets",
      "Decrease because prevailing interest rates and bond market prices exhibit inverse correlation",
      "Remain completely unchanged because long term bonds carry guaranteed maturity face values",
      "Fluctuate randomly based on daily stock exchange trading volumes and retail sentiment",
    ],
    "B",
    "B. Decrease because prevailing interest rates and bond market prices exhibit inverse correlation",
  ),

  // ---------- 2: Tricky true false ----------
  q(
    "Q08",
    "tricky",
    "Credit Risk Definition Trap: True or False: Credit risk only occurs when borrowers deliberately commit fraud and run away with the money.",
    [
      "True - because financial default is caused exclusively by intentional fraudulent behavior",
      "False - because credit risk also encompasses objective macroeconomic shocks and business failures",
      "True - because all commercial borrowers sign legally binding contracts intending full repayment",
      "False - because modern banking institutions maintain insurance policies eliminating credit losses",
    ],
    "B",
    "B. False because credit risk also encompasses objective macroeconomic shocks and business failures",
  ),
  q(
    "Q09",
    "tricky",
    "Deposit Cash Flow Trap: When a customer withdraws cash from a transaction deposit account at Bank A to deposit into Bank B, how will the total money supply in the economy change?",
    [
      "Total money supply expands instantly through aggressive commercial credit multiplier effects",
      "Money shifts between accounts causing liquidity pressure while money supply contracts if reserves deplete",
      "Total money supply doubles immediately because cash transactions bypass central bank monitoring",
      "Nothing changes in the banking system since physical cash retains identical face valuation",
    ],
    "B",
    "B. Money shifts between accounts causing liquidity pressure while money supply contracts if reserves deplete",
    "Moving a deposit from Bank A to Bank B (via cash) leaves the aggregate money supply unchanged: one deposit is replaced by another. The keyed option says the money supply contracts, and option D says \"nothing changes in the banking system\", which ignores the liquidity shift between banks. Proposed fix: make the correct option \"Total money supply is unchanged; liquidity and reserves shift from Bank A to Bank B\".",
  ),
  q(
    "Q10",
    "tricky",
    "Technology Trap: A digital bank claims one hundred percent absolute security and states it will never be hacked. Is this statement true or false from a Risk Management perspective?",
    [
      "True - because modern software engineering eliminates all vulnerabilities through automated patching",
      "False - because cybersecurity operations never achieve absolute security or zero risk",
      "True - if the bank implements decentralized blockchain architecture across all distributed nodes",
      "False - only for small regional financial institutions lacking advanced firewall appliances",
    ],
    "B",
    "B. Completely false because cybersecurity operations never achieve absolute security or zero risk",
  ),
  q(
    "Q11",
    "tricky",
    "Collateral Trap: If a loan has collateral worth double the loan amount, can the bank be certain it faces no credit risk?",
    [
      "Yes - because excessive collateral coverage guarantees full recovery under any market condition",
      "No - because asset values plummet during market freezes and legal liquidation takes many years",
      "Yes - if the transaction receives direct authorization from the senior credit committee",
      "No - unless the collateral portfolio receives a government sovereign financial guarantee",
    ],
    "B",
    "B. No because asset values plummet during market freezes and legal liquidation takes many years",
  ),
  q(
    "Q12",
    "tricky",
    "Liquidity Management Trap: When a bank has a massive surplus of cash in its vaults, does this prove the bank has absolute liquidity safety and high operational efficiency, true or false?",
    [
      "True - because holding abundant physical currency completely eliminates financial panic risks",
      "False - because idle cash incurs high opportunity costs and indicates poor capital efficiency",
      "True - because maintaining extreme cash reserves prevents all forms of destructive bank runs",
      "False - only during periods of hyperinflation when physical currency loses purchasing power",
    ],
    "B",
    "B. False because idle cash incurs high opportunity costs and indicates poor capital efficiency",
  ),
  q(
    "Q13",
    "tricky",
    "Inflation and Interest Rate Trap: People often say that when inflation rises, banks make huge profits because they collect high interest rates. Is this statement always true?",
    [
      "Yes - commercial banks always capture higher net margins during inflationary economic cycles",
      "Not necessarily because funding costs can escalate faster than lending rates compressing margins",
      "Yes - because consumer loan demand consistently doubles during periods of rising price levels",
      "No - because commercial banking institutions invariably incur severe losses during inflation",
    ],
    "B",
    "B. Not necessarily because funding costs can escalate faster than lending rates compressing margins",
  ),

  // ---------- 3: Hardcore questions ----------
  q(
    "Q14",
    "hardcore",
    "SVB Event 2023: What was the direct cause of Silicon Valley Bank collapse stemming from investing too heavily in safe assets that depreciated when interest rates rose?",
    [
      "Speculative cryptocurrency derivatives trading yielding catastrophic unhedged financial losses",
      "United States Treasury Bonds and long term guaranteed corporate bonds losing market value",
      "Unsecured consumer credit card portfolios suffering unprecedented systemic default spikes",
      "Foreign exchange arbitrage speculation during volatile emerging market currency shifts",
    ],
    "B",
    "B. United States Treasury Bonds and long term guaranteed corporate bonds losing market value",
    "SVB's securities were mainly US Treasuries and agency mortgage-backed securities, not \"guaranteed corporate bonds\". The direct cause of the collapse was a deposit run after the bank sold securities at a loss, not the price fall alone. Proposed fix: \"Long-term US Treasuries and agency mortgage-backed securities lost value as rates rose, and the realised losses triggered a deposit run\", checked against the presentation's case evidence.",
  ),
  q(
    "Q15",
    "hardcore",
    "Operational Risk: A bank employee accidentally types an extra comma in a wire transfer instruction, sending out 100 times the actual amount. What type of risk does this error fall under in the Basel risk management framework?",
    [
      "Credit risk arising from borrower inability to fulfill contractual debt obligations",
      "Operational Risk specifically classified under human error and deficient internal controls",
      "Strategic risk resulting from inadequate business adaptation to shifting market trends",
      "Market risk caused by adverse fluctuations in foreign exchange and equity prices",
    ],
    "B",
    "B. Operational Risk specifically classified under human error and deficient internal controls",
  ),
  q(
    "Q16",
    "hardcore",
    "Financial Psychology: What is the term used by the financial community for the phenomenon where a mass of customers rush to withdraw money from a bank simply due to a false rumor on social media?",
    [
      "Bull market describing extended periods of rising equity prices and investor optimism",
      "Bank Run denoting simultaneous panic withdrawals driven by fears of institutional insolvency",
      "Quantitative easing representing unconventional monetary policy involving asset purchases",
      "Debt restructuring signifying formal agreements to modify original repayment terms",
    ],
    "B",
    "B. Bank Run denoting simultaneous panic withdrawals driven by fears of institutional insolvency",
  ),
  q(
    "Q17",
    "hardcore",
    "Cybercrime: What is the type of extortion malware that locks down a bank system data and demands ransom in cryptocurrency called?",
    [
      "Spyware designed secretly to monitor user keystrokes and harvest confidential passwords",
      "Ransomware encrypting institutional data files and demanding cryptocurrency for decryption keys",
      "Adware automatically generating unwanted promotional pop up advertisements during browsing",
      "Worm malware replicating itself across network connections to exhaust system bandwidth",
    ],
    "B",
    "B. Ransomware encrypting institutional data files and demanding cryptocurrency for decryption keys",
  ),
  q(
    "Q18",
    "hardcore",
    "Basel III Policy: To prevent short term liquidity risk during 30 days of stress, Basel III requires banks to maintain a ratio called LCR. What does LCR stand for in English?",
    [
      "Liquidity Coverage Ratio measuring high quality liquid assets against net cash outflows",
      "Loan Capital Ratio determining regulatory equity requirements relative to total lending volume",
      "Leverage Control Rate monitoring total asset exposure against core tier one funding",
      "Liquid Cash Reserve evaluating vault currency availability against daily depositor demands",
    ],
    "A",
    "A. Liquidity Coverage Ratio measuring high quality liquid assets against net cash outflows",
  ),
  q(
    "Q19",
    "hardcore",
    "Moral Hazard: What is the economic term for the phenomenon where an individual or organization tends to accept higher risks because they know that if something goes wrong, an agency or government will step in to bail them out?",
    [
      "Adverse selection occurring before transactions when asymmetric information distorts pricing",
      "Moral Hazard describing increased risk taking behavior protected by anticipated bailouts",
      "Market friction representing transaction costs and barriers inhibiting optimal allocation",
      "Arbitrage capturing risk free profit by exploiting simultaneous price discrepancies",
    ],
    "B",
    "B. Moral Hazard describing increased risk taking behavior protected by anticipated bailouts",
  ),
  q(
    "Q20",
    "hardcore",
    "Strategic Thinking: Why do regulatory authorities or Central Banks often prohibit commercial banks from investing too deeply and directly into the cryptocurrency market?",
    [
      "Because distributed ledger cryptocurrency networks operate too slowly for high frequency payments",
      "Because extreme asset volatility creates systemic instability and lacks transparent legal safeguards",
      "Because commercial banking branch networks lack reliable internet connectivity infrastructure",
      "Because digital token transactions provide fee free transfers eliminating banking revenues",
    ],
    "B",
    "B. Because extreme asset volatility creates systemic instability and lacks transparent legal safeguards",
  ),

  // ---------- 4: câu hỏi trọng tâm (core topics) ----------
  q(
    "Q21",
    "core",
    "Credit Risk Concentration: What does credit concentration risk refer to in commercial bank portfolio management?",
    [
      "Excessive exposure to a single borrower economic sector or geographic region increasing potential loss severity",
      "The total amount of physical cash stored inside regional vaults during holiday seasons",
      "The concentration of board members voting decisions on short term profitability targets",
      "Regulatory penalties imposed when customer complaints exceed quarterly benchmark limits",
    ],
    "A",
    "A. Excessive exposure to a single borrower economic sector or geographic region increasing potential loss severity",
  ),
  q(
    "Q22",
    "core",
    "Liquidity Coverage Ratio (LCR): Under Basel III standards, what is the primary purpose of requiring a high LCR for commercial banks?",
    [
      "To guarantee maximum dividend payouts for institutional shareholders and private investors",
      "To ensure banks hold sufficient high quality liquid assets to survive a severe 30 day stress scenario",
      "To prevent borrowers from defaulting on long term corporate real estate mortgage financing",
      "To restrict international wire transfers and curb inflationary money supply expansion",
    ],
    "B",
    "B. To ensure banks hold sufficient high quality liquid assets to survive a severe 30 day stress scenario",
  ),
  q(
    "Q23",
    "core",
    "Foreign Exchange Risk: How does foreign exchange risk impact a commercial bank holding unhedged liabilities denominated in foreign currencies while assets are in local currency?",
    [
      "Depreciation of the local currency increases the domestic currency value of foreign liabilities generating financial losses",
      "Appreciation of the local currency eliminates all transaction costs associated with cross border settlements",
      "Foreign exchange fluctuations have zero impact since central banks guarantee exchange rate stability",
      "Inflationary pressures automatically offset any valuation imbalances between domestic and foreign ledgers",
    ],
    "A",
    "A. Depreciation of the local currency increases the domestic currency value of foreign liabilities generating financial losses",
  ),
  q(
    "Q24",
    "core",
    "Cybersecurity Incident Response: Following a ransomware attack that encrypts primary database servers, what is the recommended immediate containment protocol?",
    [
      "Instantly transfer cryptocurrency funds to cybercriminals to prevent public data exposure",
      "Immediately disconnect infected network segments and isolate systems to prevent lateral malware spreading",
      "Delete all offline backup archives to free up storage space for emergency system reinstallation",
      "Broadcast internal security logs across social media platforms to alert external bank customers",
    ],
    "B",
    "B. Immediately disconnect infected network segments and isolate systems to prevent lateral malware spreading",
  ),
  q(
    "Q25",
    "core",
    "Net Stable Funding Ratio (NSFR): What is the core objective of the NSFR metric introduced under the Basel III regulatory framework?",
    [
      "To evaluate short term intraday liquidity clearing capacity across correspondent banking channels",
      "To promote longer term funding resilience by requiring stable funding matching asset maturity profiles",
      "To calculate exact capital adequacy ratios needed for speculative equity trading desks",
      "To measure consumer loan default probabilities during economic recessions and downturns",
    ],
    "B",
    "B. To promote longer term funding resilience by requiring stable funding matching asset maturity profiles",
  ),
  q(
    "Q26",
    "core",
    "Operational Risk Management: Which tool is commonly utilized by risk managers to identify assess and monitor operational risk events and internal control deficiencies across business units?",
    [
      "Risk and Control Self Assessment mechanisms conducted regularly by operational managers",
      "Daily stock market volatility indices tracking equity price fluctuations on public exchanges",
      "Consumer credit scoring algorithms predicting individual borrower repayment probabilities",
      "Central bank policy interest rate announcements determining macro monetary expansion",
    ],
    "A",
    "A. Risk and Control Self Assessment mechanisms conducted regularly by operational managers",
  ),
  q(
    "Q27",
    "core",
    "Too Big To Fail Phenomenon: Why do financial institutions classified as Too Big To Fail often create severe moral hazard problems within the banking industry?",
    [
      "Because their massive branch networks eliminate all forms of local operational risk entirely",
      "Because management and investors know government bailouts will protect them from failure encouraging excessive risk taking",
      "Because regulatory authorities exempt these specific institutions from maintaining any capital reserves",
      "Because customers receive guaranteed high investment returns regardless of general economic conditions",
    ],
    "B",
    "B. Because management and investors know government bailouts will protect them from failure encouraging excessive risk taking",
  ),
  q(
    "Q28",
    "core",
    "Stress Testing: What is the primary objective of conducting macroeconomic stress tests for commercial banking institutions?",
    [
      "To measure daily employee productivity and branch customer service satisfaction ratings",
      "To evaluate bank capital and liquidity resilience under hypothetical severe economic downturn scenarios",
      "To determine optimal marketing strategies for launching new retail credit card products",
      "To calculate exact quarterly corporate tax liabilities owed to national revenue authorities",
    ],
    "B",
    "B. To evaluate bank capital and liquidity resilience under hypothetical severe economic downturn scenarios",
  ),
  q(
    "Q29",
    "core",
    "Reputational Risk: How can a major cybersecurity breach or data leak directly translate into severe financial losses for a commercial bank?",
    [
      "Through immediate customer attrition loss of market trust and potential regulatory non compliance fines",
      "By automatically increasing central bank reserve requirement percentages across all domestic lenders",
      "Through mandatory government buyouts of common stock equity at premium market valuations",
      "By eliminating all interest rate risk exposure associated with long term fixed income bonds",
    ],
    "A",
    "A. Through immediate customer attrition loss of market trust and potential regulatory non compliance fines",
  ),
  q(
    "Q30",
    "core",
    "Compliance and AML Risk: What does Anti Money Laundering compliance primarily require commercial banks to implement across customer onboarding processes?",
    [
      "Guaranteed loan approval policies for all applicants regardless of documentation completeness",
      "Rigorous Know Your Customer verification transaction monitoring and suspicious activity reporting protocols",
      "Automatic fee waivers for international wire transfers exceeding statutory reporting limits",
      "Unlimited cash withdrawal privileges for high net worth clients without identity checks",
    ],
    "B",
    "B. Rigorous Know Your Customer verification transaction monitoring and suspicious activity reporting protocols",
  ),
];

/**
 * Balanced sampling: each quiz slot draws from one category, so every player's five questions
 * have the same mix (one warm-up, one tricky, two core, one hardcore). This evens out the
 * apparent difficulty between players but does not guarantee it.
 */
export const SLOT_CATEGORIES: QuizCategory[] = ["warm-up", "tricky", "core", "hardcore", "core"];

export const PLAYABLE_QUESTIONS = QUIZ_POOL.filter((x) => x.playable);
