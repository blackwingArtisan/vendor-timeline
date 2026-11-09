/**
 * What a couple's request asks to pay, read by code before any model sees it. When the request
 * names a vendor and an amount that isn't one of that vendor's confirmed terms, the app sends that
 * exact ask to the Guard itself, so the refusal is the code's whatever a model would have said.
 * Safe to import in the browser.
 */
import { dollarMatches } from "./cents";
import type { TimelineItem } from "./types";

/** The payment a request names by vendor, role or "deposit"/"balance", if it names one. */
export function namedIn(goal: string, items: TimelineItem[]): TimelineItem | undefined {
  const text = goal.toLowerCase();
  const byVendor = items.filter((i) => text.includes(i.vendorRole) || text.includes(i.vendorName.toLowerCase()));
  const byKind = byVendor.filter((i) => text.includes(i.kind));
  return byKind.length === 1 ? byKind[0] : byVendor.length >= 1 ? byVendor.find((i) => i.status !== "paid") : undefined;
}

const PAY_VERB = /\b(pay|send|transfer|wire|set up)\b/i;
/** Words that make a figure a budget or a balance in hand, not the amount to pay. */
const NOT_THE_ASK = /budget|month|week|left|afford|have|saved|save|spend|under|over|up to|less than|more than/i;

/** The first dollar figure the request asks to pay, in cents: "Pay the caterer $5,000" → 500000. */
export function askedCents(goal: string): number | undefined {
  if (!PAY_VERB.test(goal)) return undefined;
  for (const m of dollarMatches(goal)) {
    const before = goal.slice(Math.max(0, m.start - 24), m.start);
    const after = goal.slice(m.end, m.end + 16);
    if (!NOT_THE_ASK.test(before) && !NOT_THE_ASK.test(after)) return m.cents;
  }
  return undefined;
}

export interface AskedMismatch {
  /** The unpaid payment the request names, whose confirmed amount the Guard checks against. */
  item: TimelineItem;
  askedCents: number;
}

/**
 * The request names one of the couple's unpaid payments and an amount that isn't its confirmed
 * term (or, when it doesn't say deposit or balance, isn't any of that vendor's unpaid terms).
 */
export function askedMismatch(goal: string, items: TimelineItem[]): AskedMismatch | null {
  const unpaid = items.filter((i) => i.status !== "paid");
  const item = namedIn(goal, unpaid);
  const asked = askedCents(goal);
  if (!item || asked === undefined) return null;
  const text = goal.toLowerCase();
  const sameVendor = unpaid.filter((i) => i.contractId === item.contractId);
  const terms = text.includes(item.kind) ? [item] : sameVendor;
  return terms.some((t) => t.cents === asked) ? null : { item, askedCents: asked };
}
