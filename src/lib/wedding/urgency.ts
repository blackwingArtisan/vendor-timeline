/**
 * What to pay first, said by code. The agent shows this sentence word for word and only explains
 * around it, so nothing it writes can put a different payment first. Safe to import in the browser.
 */
import { formatCents } from "./cents";
import { formatDay } from "./dates";
import type { ItemStatus, TimelineItem, TimelineView } from "./types";

/** Titles of the agent messages written by code, not the model. The agent panel shows these first. */
export const PAY_FIRST_TITLE = "Pay first";
export const CASH_CHECK_TITLE = "Cash check";
export const CASH_PLAN_TITLE = "Cash plan";
export const APP_MESSAGE_TITLES: readonly string[] = [PAY_FIRST_TITLE, CASH_CHECK_TITLE, CASH_PLAN_TITLE];

const name = (i: TimelineItem) => `the ${i.vendorName} ${i.kind}`;
const late = (i: TimelineItem) => `${formatCents(i.cents)}, ${-i.daysUntil === 1 ? "1 day" : `${-i.daysUntil} days`} overdue since ${formatDay(i.due)}`;
const due = (i: TimelineItem) => `${formatCents(i.cents)}, due ${i.daysUntil === 0 ? "today" : formatDay(i.due)}`;

const WAITING: Partial<Record<ItemStatus, string>> = {
  awaiting_approval: "is waiting for your approval",
  awaiting_checkout: "is approved and waiting for you in PayPal's checkout",
  sending: "is being paid now",
};

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One short paragraph: what to pay first and why, then anything else overdue, then what comes next. */
export function payFirstSentence(view: TimelineView): string {
  const first = view.payFirst;
  const parts: string[] = [];
  // Overdue but already on its way to PayPal: said first, so the couple sees why it isn't "pay first".
  for (const i of view.overdue.filter((o) => WAITING[o.status])) parts.push(`${capital(name(i))} (${late(i)}) ${WAITING[i.status]}.`);
  if (first) {
    const why = first.status === "overdue" ? `${late(first)}. Overdue comes first.` : `${due(first)}. Nothing else is overdue, so the next one due comes first.`;
    parts.push(`Pay first: ${name(first)}, ${why}`);
  } else if (!parts.length) {
    parts.push("Nothing is waiting to be paid.");
  }
  const alsoLate = view.overdue.filter((o) => o.status === "overdue" && o.id !== first?.id);
  if (alsoLate.length) parts.push(`Also overdue: ${alsoLate.map((i) => `${name(i)} (${late(i)})`).join("; ")}.`);
  const next = view.nextDue && view.nextDue.id !== first?.id && view.nextDue.status !== "awaiting_approval" && view.nextDue.status !== "awaiting_checkout" ? view.nextDue : null;
  if (next) parts.push(`After that, next due is ${name(next)}, ${due(next)}.`);
  return parts.join(" ");
}
