/**
 * The cash check: each payment against the couple's monthly budget, on the day its money leaves.
 * All of the arithmetic is here. The AI only explains the sentences this writes. Safe to import in
 * the browser.
 */
import { formatCents, sumCents } from "./cents";
import { addDays, formatDay, formatMonth } from "./dates";
import type { CashMonth, CashPayment, CashPlan, CashWarning, TimelineItem } from "./types";

export const DEFAULT_MONTHLY_BUDGET_CENTS = 500_000;

/** Payments this close together feel like one bill: day one to day seven. */
const WEEK_DAYS = 7;

/**
 * The day a payment's money leaves. Usually its due date, moved or not. Money already sent counts on
 * the day PayPal showed it paid, and one that's being sent or is overdue goes today, because that's
 * the soonest it can.
 */
export function payDate(item: TimelineItem, today: string): string {
  if (item.status === "paid") {
    const paidOn = (item.payment?.successSeenAt ?? item.payment?.checkedAt)?.slice(0, 10);
    return paidOn && paidOn < today ? paidOn : today;
  }
  if (item.status === "sending" || item.status === "awaiting_approval" || item.due < today) return today;
  return item.due;
}

const list = (payments: CashPayment[]) => payments.map((p) => `${p.label} (${formatCents(p.cents)}${p.paid ? ", already paid" : ""})`).join(" and ");

/** A clash of payments already made is history. Only warn while something can still change. */
const stillOpen = (payments: CashPayment[]) => payments.some((p) => !p.paid);

function sameWeekWarnings(payments: CashPayment[], budget: number): CashWarning[] {
  const weeks: CashPayment[][] = [];
  for (const first of payments) {
    const last = addDays(first.payDate, WEEK_DAYS - 1);
    const week = payments.filter((p) => p.payDate >= first.payDate && p.payDate <= last);
    const alreadyCovered = weeks.some((w) => week.every((p) => w.includes(p)));
    if (week.length > 1 && !alreadyCovered && stillOpen(week) && sumCents(week.map((p) => p.cents)) > budget) weeks.push(week);
  }
  return weeks.map((week) => {
    const totalCents = sumCents(week.map((p) => p.cents));
    const [from, to] = [week[0].payDate, week.at(-1)!.payDate];
    const span = from === to ? `on ${formatDay(from)}` : `between ${formatDay(from)} and ${formatDay(to)}`;
    return { kind: "same_week", from, to, payments: week, totalCents, overByCents: totalCents - budget, message: `${list(week)} land together ${span}: ${formatCents(totalCents)} in one week, ${formatCents(totalCents - budget)} over your ${formatCents(budget)} monthly budget.` };
  });
}

function monthsOf(payments: CashPayment[], budget: number): CashMonth[] {
  const months = new Map<string, CashPayment[]>();
  for (const p of payments) months.set(p.payDate.slice(0, 7), [...(months.get(p.payDate.slice(0, 7)) ?? []), p]);
  return [...months].map(([month, inMonth]) => {
    const totalCents = sumCents(inMonth.map((p) => p.cents));
    return { month, label: formatMonth(inMonth[0].payDate), payments: inMonth, totalCents, budgetCents: budget, leftCents: budget - totalCents };
  });
}

function overMonthWarnings(months: CashMonth[]): CashWarning[] {
  return months
    .filter((m) => m.leftCents < 0 && stillOpen(m.payments))
    .map((m) => {
      const count = m.payments.length === 1 ? "1 payment" : `${m.payments.length} payments`;
      const paid = m.payments.filter((p) => p.paid).length;
      return { kind: "over_month", from: m.payments[0].payDate, to: m.payments.at(-1)!.payDate, payments: m.payments, totalCents: m.totalCents, overByCents: -m.leftCents, message: `${m.label} needs ${formatCents(m.totalCents)} across ${count}${paid ? ` (${paid} already paid)` : ""}, ${formatCents(-m.leftCents)} over your ${formatCents(m.budgetCents)} monthly budget.` };
    });
}

export function cashPlan(items: TimelineItem[], today: string, monthlyBudgetCents: number): CashPlan {
  const payments = items
    .map((i): CashPayment => ({ id: i.id, label: `${i.vendorName} ${i.kind}`, cents: i.cents, due: i.due, payDate: payDate(i, today), paid: i.status === "paid" }))
    .sort((a, b) => a.payDate.localeCompare(b.payDate) || b.cents - a.cents || a.id.localeCompare(b.id));
  const months = monthsOf(payments, monthlyBudgetCents);
  return { monthlyBudgetCents, warnings: [...sameWeekWarnings(payments, monthlyBudgetCents), ...overMonthWarnings(months)], months };
}
