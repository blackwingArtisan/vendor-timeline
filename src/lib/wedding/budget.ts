/**
 * Each couple's plan record: their monthly budget, and whether it is the labelled sample plan.
 * A new visitor's plan starts as the sample, with the five fictional contracts confirmed, so the
 * first screen is a working timeline instead of an empty one. Server only.
 */
import { collection } from "@/lib/store/collection";
import { DEFAULT_MONTHLY_BUDGET_CENTS } from "./cash";
import { listContracts } from "./contracts";
import { loadSampleWedding } from "./demo";

export interface PlanRecord {
  id: string;
  monthlyBudgetCents?: number;
  /** True while the plan holds the five fictional sample contracts. */
  sample?: boolean;
}

const plans = () => collection<PlanRecord>("plans");

export const monthlyBudget = (planId: string) => plans().get(planId)?.monthlyBudgetCents ?? DEFAULT_MONTHLY_BUDGET_CENTS;

export const setMonthlyBudget = (planId: string, monthlyBudgetCents: number) => plans().upsert({ ...plans().get(planId), id: planId, monthlyBudgetCents });

export const isSamplePlan = (planId: string) => !!plans().get(planId)?.sample;

export const markSamplePlan = (planId: string, sample: boolean) => plans().upsert({ ...plans().get(planId), id: planId, sample });

/**
 * The first time a plan is seen, fill it with the sample wedding. A plan from before this rule
 * that already holds contracts is left as it is. All of it runs in one step with no await, so two
 * requests at once can't both fill it.
 */
export function openPlan(planId: string): void {
  if (plans().get(planId)) return;
  if (listContracts(planId).length) {
    plans().upsert({ id: planId, sample: false });
    return;
  }
  plans().upsert({ id: planId, sample: true });
  loadSampleWedding(planId);
}

/** "Start your own plan": a brand-new, empty plan. The sample stays behind under its old id. */
export function startOwnPlan(planId: string): void {
  plans().upsert({ id: planId, sample: false });
}
