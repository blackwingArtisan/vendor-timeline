/**
 * The cash check: which unpaid payments land together against the couple's monthly budget. All of
 * the arithmetic is here. The AI only explains the sentences this writes. An overdue payment counts
 * from today, because that is when the money has to go. Safe to import in the browser.
 */
import { formatCents, sumCents } from "./cents";
import { addDays, formatDay, formatMonth } from "./dates";
import type { CashPayment, CashPlan, CashWarning, TimelineItem } from "./types";

export const DEFAULT_MONTHLY_BUDGET_CENTS = 500_000;

/** Payments this close together feel like one bill: day one to day seven. */
const WEEK_DAYS = 7;

type Dated = CashPayment & { on: string };

const list = (payments: CashPayment[]) => payments.map((p) => `${p.label} (${formatCents(p.cents)})`).join(" and ");

function sameWeekWarnings(payments: Dated[], budget: number): CashWarning[] {
  const weeks: Dated[][] = [];
  for (const first of payments) {
    const last = addDays(first.on, WEEK_DAYS - 1);
    const week = payments.filter((p) => p.on >= first.on && p.on <= last);
    const alreadyCovered = weeks.some((w) => week.every((p) => w.includes(p)));
    if (week.length > 1 && !alreadyCovered && sumCents(week.map((p) => p.cents)) > budget) weeks.push(week);
  }
  return weeks.map((week) => {
    const totalCents = sumCents(week.map((p) => p.cents));
    const [from, to] = [week[0].on, week.at(-1)!.on];
    const span = from === to ? `on ${formatDay(from)}` : `between ${formatDay(from)} and ${formatDay(to)}`;
    return { kind: "same_week", from, to, payments: week, totalCents, overByCents: totalCents - budget, message: `${list(week)} land together ${span}: ${formatCents(totalCents)} in one week, ${formatCents(totalCents - budget)} over your ${formatCents(budget)} monthly budget.` };
  });
}

function overMonthWarnings(payments: Dated[], budget: number): CashWarning[] {
  const months = new Map<string, Dated[]>();
  for (const p of payments) months.set(p.on.slice(0, 7), [...(months.get(p.on.slice(0, 7)) ?? []), p]);
  const warnings: CashWarning[] = [];
  for (const month of months.values()) {
    const totalCents = sumCents(month.map((p) => p.cents));
    if (totalCents <= budget) continue;
    const overByCents = totalCents - budget;
    warnings.push({ kind: "over_month", from: month[0].on, to: month.at(-1)!.on, payments: month, totalCents, overByCents, message: `${formatMonth(month[0].on)} needs ${formatCents(totalCents)} across ${month.length === 1 ? "1 payment" : `${month.length} payments`}, ${formatCents(overByCents)} over your ${formatCents(budget)} monthly budget.` });
  }
  return warnings;
}

export function cashPlan(unpaid: TimelineItem[], today: string, monthlyBudgetCents: number): CashPlan {
  const payments = unpaid
    .map((i): Dated => ({ id: i.id, label: `${i.vendorName} ${i.kind}`, cents: i.cents, due: i.due, on: i.due < today ? today : i.due }))
    .sort((a, b) => a.on.localeCompare(b.on) || b.cents - a.cents || a.id.localeCompare(b.id));
  const warnings = [...sameWeekWarnings(payments, monthlyBudgetCents), ...overMonthWarnings(payments, monthlyBudgetCents)];
  const plain = warnings.map((w) => ({ ...w, payments: w.payments.map(({ id, label, cents, due }) => ({ id, label, cents, due })) }));
  return { monthlyBudgetCents, warnings: plain };
}
