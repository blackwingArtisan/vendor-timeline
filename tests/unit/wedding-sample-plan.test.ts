import { describe, expect, it } from "vitest";
import { isSamplePlan, monthlyBudget, openPlan, setMonthlyBudget, startOwnPlan } from "@/lib/wedding/budget";
import { addUnreadContract, listContracts } from "@/lib/wedding/contracts";
import { SAMPLES } from "@/lib/wedding/samples";

const fresh = () => `plan_test${Math.random().toString(36).slice(2, 10)}`;

describe("a new visitor's plan", () => {
  it("starts as the labelled sample, with the five samples confirmed, once", () => {
    const plan = fresh();
    openPlan(plan);
    openPlan(plan);
    expect(isSamplePlan(plan)).toBe(true);
    const contracts = listContracts(plan);
    expect(contracts).toHaveLength(SAMPLES.length);
    expect(contracts.every((c) => c.confirmed)).toBe(true);
  });

  it("leaves a plan that already holds the couple's contracts alone", () => {
    const plan = fresh();
    addUnreadContract(plan, { text: "Typed in.", fileName: "typed.txt" });
    openPlan(plan);
    expect(isSamplePlan(plan)).toBe(false);
    expect(listContracts(plan)).toHaveLength(1);
  });

  it("starting your own plan gives an empty one that stays empty", () => {
    const plan = fresh();
    startOwnPlan(plan);
    openPlan(plan);
    expect(isSamplePlan(plan)).toBe(false);
    expect(listContracts(plan)).toHaveLength(0);
  });

  it("saving a budget keeps the sample label", () => {
    const plan = fresh();
    openPlan(plan);
    setMonthlyBudget(plan, 700_000);
    expect(monthlyBudget(plan)).toBe(700_000);
    expect(isSamplePlan(plan)).toBe(true);
  });
});
