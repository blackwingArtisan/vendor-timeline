import { describe, expect, it } from "vitest";
import { setMonthlyBudget } from "@/lib/wedding/budget";
import { cashPlan } from "@/lib/wedding/cash";
import { cashFix, cashPlanSentence, paysEarlyAllowed } from "@/lib/wedding/cash-moves";
import { loadSampleWedding } from "@/lib/wedding/demo";
import { viewTimeline } from "@/lib/wedding/pay";
import { CATERER, FLORIST, PHOTOGRAPHER, VENUE } from "@/lib/wedding/samples";
import type { CashMove, ItemStatus, TimelineItem } from "@/lib/wedding/types";

const TODAY = "2026-11-20";

async function sample(plan: string, budgetCents?: number) {
  loadSampleWedding(plan);
  if (budgetCents) setMonthlyBudget(plan, budgetCents);
  return viewTimeline(plan, TODAY);
}

const brief = (m: CashMove) => `${m.kind} ${m.vendorName} ${m.itemKind} ${m.to}`;

/** The timeline with the plan's moves made, as the cash check would see it once each is done. */
const withMoves = (items: TimelineItem[], moves: CashMove[]) => items.map((i) => ({ ...i, due: moves.find((m) => m.itemId === i.id)?.to ?? i.due }));

const item = (id: string, cents: number, due: string, extra: Partial<TimelineItem> = {}, status: ItemStatus = "upcoming"): TimelineItem => ({ id, contractId: id, kind: "balance", vendorName: id, vendorRole: "other", cents, due, daysUntil: 10, status, ...extra });

describe("the cash plan", () => {
  it("at $12,000 a month, pays two balances early and May fits", async () => {
    const view = await sample("plan_fix_12k", 1_200_000);
    const fix = view.cashFix!;
    expect(fix.fits).toBe(true);
    expect(fix.moves.map(brief)).toEqual([`pay_now ${PHOTOGRAPHER.vendorName} balance ${TODAY}`, `pay_now ${FLORIST.vendorName} balance ${TODAY}`]);
    expect(fix.summary).toBe(`Two moves would fit every month in your $12,000.00 monthly budget: pay the ${PHOTOGRAPHER.vendorName} balance ($3,600.00) now and pay the ${FLORIST.vendorName} balance ($1,740.00) now. Approve each one in the cash plan.`);
    expect(fix.stillOver).toBeNull();
    // Code's own check agrees: with both made, no warning is left.
    expect(cashPlan(withMoves(view.items, fix.moves), TODAY, 1_200_000).warnings).toEqual([]);
  });

  it("at $15,000, one early payment is enough, the smallest that fits", async () => {
    const { cashFix: fix } = await sample("plan_fix_15k", 1_500_000);
    expect(fix!.fits).toBe(true);
    expect(fix!.moves.map(brief)).toEqual([`pay_now ${FLORIST.vendorName} balance ${TODAY}`]);
    // Quotes the contract's own sentence for why paying early is allowed.
    expect(fix!.moves[0].why).toContain('The contract says: "The rest ($1,740) is due two weeks before your wedding."');
    expect(fix!.moves[0].why).toContain("$1,740.00 out of May 2027 into November 2026");
  });

  it("at $5,000, asks the florist for a date before the wedding and says honestly what still can't fit", async () => {
    const view = await sample("plan_fix_5k");
    const fix = view.cashFix!;
    expect(fix.fits).toBe(false);
    expect(fix.moves.map(brief)).toEqual([`pay_now ${PHOTOGRAPHER.vendorName} balance ${TODAY}`, `ask_vendor ${FLORIST.vendorName} balance 2027-06-05`]);
    const ask = fix.moves[1];
    expect(ask.title).toBe(`Ask ${FLORIST.vendorName} to move the balance ($1,740.00) to Sat, Jun 5, 2027`);
    expect(ask.message).toContain(`Hello ${FLORIST.vendorName},`);
    expect(ask.message).toContain("the balance of $1,740.00 due Sat, May 29, 2027. Could we move it to Sat, Jun 5, 2027, still before the wedding on Sat, Jun 12, 2027?");
    expect(fix.summary).toMatch(/^No plan fits every month in your \$5,000\.00 monthly budget, but two moves your contracts allow bring it closer: /);
    expect(fix.stillOver).toBe(`Still over: April 2027 by $1,000.00 and May 2027 by $5,460.00. The ${VENUE.vendorName} balance ($6,000.00) and the ${CATERER.vendorName} balance ($10,460.00) are each more than your monthly budget on their own.`);
    const raise = `$10,500.00 a month is the smallest budget that fits every month, once you pay the ${PHOTOGRAPHER.vendorName} balance ($3,600.00) now and pay the ${FLORIST.vendorName} balance ($1,740.00) now. Code works this out from the same rules as the plan.`;
    expect(fix.budgetToFit).toEqual({ cents: 1_050_000, why: raise });
    expect(cashPlanSentence(fix)).toBe(`${fix.summary} ${fix.stillOver} Or raise the monthly budget: ${raise}`);
    // The May 29 week no longer clashes once both are made.
    expect(cashPlan(withMoves(view.items, fix.moves), TODAY, 500_000).warnings.map((w) => w.kind)).toEqual(["over_month", "over_month"]);
  });

  it("names the smallest budget its own plan fits, and at that budget the plan's moves leave every month under", async () => {
    const view = await sample("plan_fix_raise");
    const { cents } = view.cashFix!.budgetToFit!;
    expect(cents).toBe(1_050_000);
    const at = cashFix(view.items, TODAY, cents)!;
    expect(at.fits).toBe(true);
    expect(at.budgetToFit).toBeNull();
    expect(at.stillOver).toBeNull();
    expect(cashPlan(withMoves(view.items, at.moves), TODAY, cents).warnings).toEqual([]);
    // $100 less doesn't fit, whatever the moves.
    const below = cashFix(view.items, TODAY, cents - 10_000)!;
    expect(below.fits).toBe(false);
    expect(below.budgetToFit!.cents).toBe(cents);
    // A plan that fits names no budget.
    expect(cashFix(view.items, TODAY, 1_500_000)!.budgetToFit).toBeNull();
  });

  it("asks a vendor when this month has no room to pay early", () => {
    const items = [item("now", 450_000, "2026-11-25"), item("venue", 300_000, "2027-03-10", { vendorName: "Hall", weddingDay: "2027-06-12" }), item("cake", 300_000, "2027-03-20", { vendorName: "Cake", weddingDay: "2027-06-12" })];
    const fix = cashFix(items, TODAY, 500_000)!;
    expect(fix.fits).toBe(true);
    expect(fix.moves.map(brief)).toEqual(["ask_vendor Hall balance 2027-04-01"]);
    expect(fix.moves[0].why).toBe("A later date needs Hall's agreement. If they agree, that moves $3,000.00 out of March 2027 into April 2027.");
  });

  it("never pays early what the contract says can't be, and never moves a payment on its way to PayPal", () => {
    expect(paysEarlyAllowed("The balance is due no earlier than May 1, 2027.")).toBe(false);
    expect(paysEarlyAllowed("The balance is due by May 1, 2027.")).toBe(true);
    const items = [
      item("a", 300_000, "2027-03-10", { dueSentence: "Payment is due on March 10, 2027 and not before." }),
      item("b", 300_000, "2027-03-12", {}, "awaiting_approval"),
      item("c", 300_000, "2027-03-14", { weddingDay: "2027-03-20" }),
    ];
    // b is already today; a and c can't pay early or move past their wedding in a later month, so nothing helps.
    const fix = cashFix(items.slice(0, 1).concat(items[2]), TODAY, 500_000)!;
    expect(fix.moves.every((m) => m.kind !== "pay_now" || m.itemId !== "a")).toBe(true);
    expect(fix.moves.every((m) => m.itemId !== "b")).toBe(true);
    expect(cashFix(items, TODAY, 500_000)!.moves.every((m) => m.itemId !== "b")).toBe(true);
  });

  it("says so when no move helps", () => {
    const items = [item("big", 900_000, "2027-03-10", { vendorName: "Hall", weddingDay: "2027-03-12", dueSentence: "Due no earlier than March 10, 2027." })];
    const fix = cashFix(items, TODAY, 500_000)!;
    expect(fix.moves).toEqual([]);
    expect(fix.summary).toBe("No move your contracts allow brings this within your $5,000.00 monthly budget.");
    expect(fix.stillOver).toBe("Still over: March 2027 by $4,000.00. The Hall balance ($9,000.00) is more than your monthly budget on its own.");
  });

  it("is null when nothing clashes", async () => {
    const view = await sample("plan_fix_none", 2_000_000);
    expect(view.cash.warnings).toEqual([]);
    expect(view.cashFix).toBeNull();
  });
});
