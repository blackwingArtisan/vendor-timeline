/**
 * The month-by-month cash chart's numbers, all from the cash check (cash.ts). Every month from the
 * first payment to the last gets a bar, so a quiet month shows as quiet rather than missing. Safe to
 * import in the browser.
 */
import { sumCents } from "./cents";
import { formatMonth } from "./dates";
import type { CashPlan } from "./types";

export interface ChartMonth {
  /** "2027-05" */
  month: string;
  label: string;
  /** "May", or "Jan ’27" where a year starts, so the axis reads without a legend. */
  short: string;
  totalCents: number;
  paidCents: number;
  budgetCents: number;
  /** Above zero when the month needs more than the budget. */
  overByCents: number;
}

const nextMonth = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
};

export function chartMonths(cash: CashPlan): ChartMonth[] {
  if (!cash.months.length) return [];
  const known = new Map(cash.months.map((m) => [m.month, m]));
  const [first, last] = [cash.months[0].month, cash.months.at(-1)!.month].sort();
  const months: ChartMonth[] = [];
  for (let month = first; month <= last; month = nextMonth(month)) {
    const m = known.get(month);
    const totalCents = m?.totalCents ?? 0;
    const label = formatMonth(`${month}-01`);
    const [name, year] = label.split(" ");
    months.push({
      month,
      label,
      short: month === first || month.endsWith("-01") ? `${name.slice(0, 3)} ’${year.slice(2)}` : name.slice(0, 3),
      totalCents,
      paidCents: sumCents((m?.payments ?? []).filter((p) => p.paid).map((p) => p.cents)),
      budgetCents: cash.monthlyBudgetCents,
      overByCents: Math.max(0, totalCents - cash.monthlyBudgetCents),
    });
  }
  return months;
}

/** The chart's top: the biggest month or the budget, whichever is higher, with room for a label. */
export const chartTopCents = (months: ChartMonth[], budgetCents: number) => Math.max(budgetCents, ...months.map((m) => m.totalCents)) * 1.15;

export interface ChartChange {
  month: string;
  label: string;
  fromCents: number;
  toCents: number;
}

/** Which months' totals changed between two charts, and by how much: what a move just did. */
export function chartChanges(before: ChartMonth[], after: ChartMonth[]): ChartChange[] {
  const was = new Map(before.map((m) => [m.month, m]));
  const now = new Map(after.map((m) => [m.month, m]));
  const months = [...new Set([...was.keys(), ...now.keys()])].sort();
  return months
    .map((month) => ({ month, label: (now.get(month) ?? was.get(month))!.label, fromCents: was.get(month)?.totalCents ?? 0, toCents: now.get(month)?.totalCents ?? 0 }))
    .filter((c) => c.fromCents !== c.toCents);
}
