/**
 * The agent's review_payments output as cards: vendor, amount, due date and why it's listed. The
 * words come from the tool's own output, worked out by code; nothing here does sums. Safe to import
 * in the browser.
 */

interface PaymentFact {
  contract_id: string;
  kind: string;
  vendor: string;
  amount_text: string;
  due: string;
  days_until: number;
  status?: string;
}

interface ReviewOutput {
  pay_first?: PaymentFact | null;
  next_payment?: PaymentFact | null;
  overdue?: PaymentFact[];
  unpaid_payments?: PaymentFact[];
}

export interface ReviewCard {
  key: string;
  vendor: string;
  kind: string;
  amount: string;
  due: string;
  /** "Pay first", "Overdue", "Due next" or "Upcoming". */
  tag: "Pay first" | "Overdue" | "Due next" | "Upcoming";
  /** Why it's listed, in a few words. */
  why: string;
}

const when = (days: number) => (days < 0 ? `${-days} ${days === -1 ? "day" : "days"} overdue` : days === 0 ? "due today" : `due in ${days} ${days === 1 ? "day" : "days"}`);

const isFact = (f: unknown): f is PaymentFact => {
  const p = f as PaymentFact | null;
  return !!p && typeof p.vendor === "string" && typeof p.amount_text === "string" && typeof p.due === "string" && typeof p.days_until === "number";
};

/** Pay first, then anything overdue, the next one due, then the rest, each listed once. */
export function reviewCards(output: unknown, limit = 4): { cards: ReviewCard[]; more: number } {
  const o = (output ?? {}) as ReviewOutput;
  const seen = new Set<string>();
  const cards: ReviewCard[] = [];
  const add = (f: PaymentFact | null | undefined, tag: ReviewCard["tag"], why: (f: PaymentFact) => string) => {
    if (!isFact(f)) return;
    const key = `${f.contract_id}:${f.kind}`;
    if (seen.has(key)) return;
    seen.add(key);
    cards.push({ key, vendor: f.vendor, kind: f.kind, amount: f.amount_text, due: f.due, tag, why: why(f) });
  };
  add(o.pay_first, "Pay first", (f) => `Most urgent: ${when(f.days_until)}`);
  for (const f of o.overdue ?? []) add(f, "Overdue", (f) => `Past its date: ${when(f.days_until)}`);
  add(o.next_payment, "Due next", (f) => `Next to come: ${when(f.days_until)}`);
  for (const f of o.unpaid_payments ?? []) add(f, "Upcoming", (f) => `Not paid yet: ${when(f.days_until)}`);
  return { cards: cards.slice(0, limit), more: Math.max(0, cards.length - limit) };
}
