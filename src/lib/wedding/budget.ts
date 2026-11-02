/** Each couple's monthly budget. Server only. */
import { collection } from "@/lib/store/collection";
import { DEFAULT_MONTHLY_BUDGET_CENTS } from "./cash";

const plans = () => collection<{ id: string; monthlyBudgetCents: number }>("plans");

export const monthlyBudget = (planId: string) => plans().get(planId)?.monthlyBudgetCents ?? DEFAULT_MONTHLY_BUDGET_CENTS;

export const setMonthlyBudget = (planId: string, monthlyBudgetCents: number) => plans().upsert({ id: planId, monthlyBudgetCents });
