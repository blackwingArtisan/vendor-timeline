import { describe, expect, it } from "vitest";
import { cashPlan } from "@/lib/wedding/cash";
import { chartChanges, chartMonths, chartTopCents } from "@/lib/wedding/cash-chart";
import type { ItemStatus, TimelineItem } from "@/lib/wedding/types";

const TODAY = "2026-11-20";
const item = (id: string, cents: number, due: string, status: ItemStatus = "upcoming"): TimelineItem => ({ id, contractId: id, kind: "balance", vendorName: id, vendorRole: "other", cents, due, daysUntil: 10, status });

describe("the cash chart", () => {
  it("has a bar for every month from the first payment to the last, quiet months at zero", () => {
    const cash = cashPlan([item("a", 120_000, "2026-12-05"), item("b", 700_000, "2027-03-02"), item("c", 50_000, "2027-03-20")], TODAY, 500_000);
    const months = chartMonths(cash);
    expect(months.map((m) => [m.month, m.short, m.totalCents, m.overByCents])).toEqual([
      ["2026-12", "Dec ’26", 120_000, 0],
      ["2027-01", "Jan ’27", 0, 0],
      ["2027-02", "Feb", 0, 0],
      ["2027-03", "Mar", 750_000, 250_000],
    ]);
    expect(chartTopCents(months, 500_000)).toBe(750_000 * 1.15);
  });

  it("counts a paid payment in the month PayPal showed it paid, as the cash check does", () => {
    const paid = { ...item("a", 60_000, "2026-10-23", "paid"), payment: { successSeenAt: "2026-11-02T10:00:00Z" } } as TimelineItem;
    const months = chartMonths(cashPlan([paid, item("b", 100_000, "2026-11-30")], TODAY, 500_000));
    expect(months).toHaveLength(1);
    expect(months[0]).toMatchObject({ month: "2026-11", totalCents: 160_000, paidCents: 60_000, overByCents: 0 });
  });

  it("is empty with nothing to pay", () => {
    expect(chartMonths(cashPlan([], TODAY, 500_000))).toEqual([]);
  });
});

describe("what a move did to the chart", () => {
  it("names each month whose total changed, before and after", () => {
    const a = item("a", 174_000, "2027-05-29");
    const before = chartMonths(cashPlan([a, item("b", 240_000, "2027-06-05")], TODAY, 500_000));
    const after = chartMonths(cashPlan([{ ...a, due: "2027-06-05" }, item("b", 240_000, "2027-06-05")], TODAY, 500_000));
    expect(chartChanges(before, after)).toEqual([
      { month: "2027-05", label: "May 2027", fromCents: 174_000, toCents: 0 },
      { month: "2027-06", label: "June 2027", fromCents: 240_000, toCents: 414_000 },
    ]);
    expect(chartChanges(after, after)).toEqual([]);
  });
});
