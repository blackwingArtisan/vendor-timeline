/**
 * Why this matters, for the landing page. Every figure, quote and link here comes from
 * round4/research/vendor-timeline.md, where each source was opened and checked on 2026-11-08.
 * Forum posts are quoted as voices, not as measures of how common something is. Nothing here says
 * couples miss payments, what PayPal's buyer protection covers, or how many vendors take PayPal: the
 * research found no evidence for any of those.
 */

export interface Source {
  label: string;
  url: string;
}

export interface Evidence {
  text: string;
  source: Source;
  /** A forum post: a voice, not a figure. */
  voice?: boolean;
}

export interface PainPoint {
  title: string;
  evidence: Evidence[];
  /** What this app does about it. */
  answer: string;
}

export const KNOT_2026: Source = {
  label: "The Knot Real Weddings Study 2026",
  url: "https://s3.us-east-1.amazonaws.com/theknot.com/xo-content/pdf/the-knot-real-weddings-study-data-read-out-2026.pdf",
};
const KNOT_FINANCE_2024: Source = { label: "The Knot 2024 Couples Finance and Budget Report", url: "https://pros.weddingpro.com/report/2024-couples-finance-and-budget-report/" };
const ZOLA_2026: Source = { label: "Zola First Look Report 2026", url: "https://www.zola.com/expert-advice/the-first-look-report-2026" };
const LENDINGTREE_2025: Source = { label: "LendingTree newlywed survey, 2025", url: "https://www.lendingtree.com/debt-consolidation/newlywed-wedding-debt-survey/" };
const forum = (date: string, url: string): Source => ({ label: `WeddingWire forum, ${date}`, url });

/** The headline figure, said the way the research says to: "about 13", with The Knot named. */
export const HEADLINE = {
  figure: "About 13 vendors",
  line: "The average US couple hires about 13 wedding vendors, each with its own contract and its own payment dates.",
  method: "10,474 US couples married in 2025",
  source: KNOT_2026,
};

export const PAIN_POINTS: PainPoint[] = [
  {
    title: "Many vendors, and every due date is different",
    evidence: [
      { text: "About 13 vendors per wedding.", source: KNOT_2026 },
      { text: "One couple's final due dates were \"sort of all over the place\": the venue 30 days out, the caterer 10 days out, others about 2 weeks.", source: forum("2 Nov 2017", "https://www.weddingwire.com/wedding-forums/how-did-you-handle-final-payments/c988afae4343599e.html"), voice: true },
      { text: "Couples build their own trackers: \"an excel schedule with all of our vendors and due dates\".", source: forum("13 Feb 2016", "https://www.weddingwire.com/wedding-forums/wedding-budget-and-spending-how-did-you-pay-your-vendors-deposits-and-regular-payments-or-a-lump-sum/33414fc59ed9ceb6.html"), voice: true },
    ],
    answer: "Claude reads every deposit and balance from each contract, and one timeline replaces the spreadsheet.",
  },
  {
    title: "The budget is set too low",
    evidence: [
      { text: "69% of couples say their first budget was set lower than reality.", source: KNOT_FINANCE_2024 },
      { text: "78% of couples planning 2026 weddings worry the economy or tariffs will push the final bill above what they expect.", source: ZOLA_2026 },
    ],
    answer: "The cash check weighs every payment against your monthly budget and shows which months go over before the money is needed.",
  },
  {
    title: "Payments go on credit cards",
    evidence: [
      { text: "39% of couples used an existing credit card for wedding costs in 2024, up from 30% in 2021.", source: KNOT_FINANCE_2024 },
      { text: "67% of newlyweds took on wedding-related debt.", source: LENDINGTREE_2025 },
    ],
    answer: "The timeline shows each payment before it lands, so you can plan when it hits your card. You pay each one yourself in PayPal's checkout.",
  },
  {
    title: "Payments bunch up in the wedding week",
    evidence: [{ text: "\"2 major final payments are already due the week of the wedding.\"", source: forum("11 Jun 2021", "https://www.weddingwire.com/wedding-forums/vendor-payments/e2dd96f7afcd276b.html"), voice: true }],
    answer: "The cash check flags a crowded week, and the cash plan suggests paying a balance early or asking a vendor for a later date, with the message drafted for you.",
  },
  {
    title: "The bill doesn't match what was agreed",
    evidence: [{ text: "A venue billed an appetizer at $375 × 3 instead of the agreed $175 × 3.", source: forum("6 Jun 2023", "https://www.weddingwire.com/wedding-forums/final-bill-from-venue/e62b09b38d1a09ce.html"), voice: true }],
    answer: "Every term sits beside the contract sentence it came from, and code checks the contract's own sums before you confirm.",
  },
];
