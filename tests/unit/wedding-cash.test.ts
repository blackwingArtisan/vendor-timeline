import { describe, expect, it } from "vitest";
import { listContracts } from "@/lib/wedding/contracts";
import { cashPlan } from "@/lib/wedding/cash";
import { loadSampleWedding } from "@/lib/wedding/demo";
import { viewTimeline } from "@/lib/wedding/pay";
import { BAND_ANSWERS, CATERER, FLORIST, SAMPLES } from "@/lib/wedding/samples";
import { setMonthlyBudget } from "@/lib/wedding/budget";
import type { ItemStatus, TimelineItem } from "@/lib/wedding/types";

const TODAY = "2026-11-20";

const item = (id: string, cents: number, due: string, status: ItemStatus = "upcoming"): TimelineItem => ({ id, contractId: id, kind: "deposit", vendorName: id, vendorRole: "other", cents, due, daysUntil: 1, status });

describe("the sample wedding", () => {
  it("loads five confirmed contracts into one timeline with a deposit and a balance each", async () => {
    const plan = "plan_sample_one";
    expect(loadSampleWedding(plan)).toEqual({ added: 5 });
    const view = await viewTimeline(plan, TODAY);
    expect(listContracts(plan)).toHaveLength(5);
    expect(view.items).toHaveLength(10);
    for (const sample of SAMPLES) expect(view.items.filter((i) => i.vendorRole === sample.vendorRole).map((i) => i.kind).sort()).toEqual(["balance", "deposit"]);
    expect(view.contractedCents).toBe(SAMPLES.reduce((sum, s) => sum + s.totalCents, 0));
  });

  it("keeps the band's blanks blank in what the AI proposed, and uses the couple's answers", () => {
    const plan = "plan_sample_two";
    loadSampleWedding(plan);
    const band = listContracts(plan).find((c) => c.confirmed!.vendorRole === "band")!;
    expect(band.proposed.balanceDue.value).toBeNull();
    expect(band.proposed.payeeEmail.value).toBeNull();
    expect(band.confirmed).toMatchObject(BAND_ANSWERS);
    expect(band.read).toEqual({ mocked: false, prepared: true, by: "Sample, prepared ahead of time, not read on this visit", costUsd: 0 });
  });

  it("adds nothing on a second click", () => {
    const plan = "plan_sample_three";
    loadSampleWedding(plan);
    expect(loadSampleWedding(plan)).toEqual({ added: 0 });
    expect(listContracts(plan)).toHaveLength(5);
  });

  it("finds the caterer and florist balances landing together", async () => {
    const plan = "plan_sample_four";
    loadSampleWedding(plan);
    const { cash } = await viewTimeline(plan, TODAY);
    const week = cash.warnings.find((w) => w.kind === "same_week")!;
    const total = CATERER.balanceCents + FLORIST.balanceCents;
    expect(week.totalCents).toBe(total);
    expect(week.overByCents).toBe(total - 500_000);
    expect(week.from).toBe("2027-05-29");
    // Like with like: a week's money is said as a week's money, not weighed against a month's budget.
    expect(week.message).toMatch(/^\$12,200\.00 leaves in the week of Sat, May 29, 2027: /);
    expect(week.message).not.toContain("monthly budget");
    expect(cash.warnings.filter((w) => w.kind === "over_month").map((w) => w.from.slice(0, 7))).toEqual(["2027-04", "2027-05"]);
  });

  it("follows the couple's budget", async () => {
    const plan = "plan_sample_five";
    loadSampleWedding(plan);
    setMonthlyBudget(plan, 2_000_000);
    const { cash } = await viewTimeline(plan, TODAY);
    expect(cash.monthlyBudgetCents).toBe(2_000_000);
    expect(cash.warnings).toEqual([]);
  });
});

describe("cashPlan", () => {
  it("warns about two payments a few days apart, even across a month end", () => {
    const { warnings } = cashPlan([item("a", 400_000, "2027-03-29"), item("b", 300_000, "2027-04-02")], TODAY, 500_000);
    expect(warnings.map((w) => [w.kind, w.totalCents, w.overByCents])).toEqual([["same_week", 700_000, 200_000]]);
  });

  it("stops the week at seven days", () => {
    expect(cashPlan([item("a", 400_000, "2027-03-01"), item("b", 300_000, "2027-03-07")], TODAY, 500_000).warnings.map((w) => w.kind)).toEqual(["same_week", "over_month"]);
    expect(cashPlan([item("a", 400_000, "2027-03-01"), item("b", 300_000, "2027-03-08")], TODAY, 500_000).warnings.map((w) => w.kind)).toEqual(["over_month"]);
  });

  it("leaves a total that exactly meets the budget alone", () => {
    expect(cashPlan([item("a", 300_000, "2027-03-01"), item("b", 200_000, "2027-03-02")], TODAY, 500_000).warnings).toEqual([]);
  });

  it("doesn't call one large payment a clash, but does flag its month", () => {
    expect(cashPlan([item("a", 900_000, "2027-03-01")], TODAY, 500_000).warnings.map((w) => w.kind)).toEqual(["over_month"]);
  });

  it("counts an overdue payment from today, when the money has to go", () => {
    const { warnings } = cashPlan([item("old", 400_000, "2026-10-01", "overdue"), item("new", 300_000, "2026-11-22")], TODAY, 500_000);
    expect(warnings[0]).toMatchObject({ kind: "same_week", from: TODAY, to: "2026-11-22", totalCents: 700_000 });
  });

  it("counts money on the day it leaves: moved, being sent, paid, or still to come", () => {
    const paid = { ...item("paid", 100_000, "2027-01-15", "paid"), payment: { successSeenAt: "2026-11-02T10:00:00.000Z" } as TimelineItem["payment"] };
    const sending = item("sending", 200_000, "2027-01-15", "sending");
    const waiting = item("waiting", 300_000, "2027-01-15", "awaiting_approval");
    const moved = { ...item("moved", 400_000, "2027-02-10"), movedFrom: "2027-01-15" };
    const { months } = cashPlan([paid, sending, waiting, moved], TODAY, 500_000);
    expect(months.flatMap((m) => m.payments.map((p) => [p.id, p.payDate]))).toEqual([
      ["paid", "2026-11-02"],
      ["waiting", TODAY],
      ["sending", TODAY],
      ["moved", "2027-02-10"],
    ]);
  });

  it("sets out each month's sums, and they add up", () => {
    const { months } = cashPlan([item("a", 400_000, "2027-03-01"), item("b", 300_000, "2027-03-20"), item("c", 100_000, "2027-04-01")], TODAY, 500_000);
    expect(months.map((m) => [m.month, m.label, m.totalCents, m.budgetCents, m.leftCents])).toEqual([
      ["2027-03", "March 2027", 700_000, 500_000, -200_000],
      ["2027-04", "April 2027", 100_000, 500_000, 400_000],
    ]);
  });

  it("counts money already paid against the month it left in", () => {
    const paid = { ...item("paid", 400_000, "2026-11-10", "paid"), payment: { successSeenAt: "2026-11-10T10:00:00.000Z" } as TimelineItem["payment"] };
    const { warnings } = cashPlan([paid, item("next", 300_000, "2026-11-28")], TODAY, 500_000);
    expect(warnings.map((w) => w.kind)).toEqual(["over_month"]);
    expect(warnings[0].message).toContain("(1 already paid)");
    expect(warnings[0].overByCents).toBe(200_000);
  });

  it("stays quiet about a month that's all paid", () => {
    const paid = { ...item("paid", 900_000, "2026-11-10", "paid"), payment: { successSeenAt: "2026-11-10T10:00:00.000Z" } as TimelineItem["payment"] };
    expect(cashPlan([paid], TODAY, 500_000).warnings).toEqual([]);
  });

  it("reports one clash once when several start days share it", () => {
    const { warnings } = cashPlan([item("a", 300_000, "2027-03-01"), item("b", 300_000, "2027-03-02"), item("c", 300_000, "2027-03-03")], TODAY, 500_000);
    expect(warnings.filter((w) => w.kind === "same_week")).toHaveLength(1);
  });
});
