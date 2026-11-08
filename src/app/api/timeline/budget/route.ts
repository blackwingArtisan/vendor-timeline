import { z } from "zod";
import { HttpError, readJson, route } from "@/lib/http";
import { setMonthlyBudget } from "@/lib/wedding/budget";
import { centsProblem, MAX_BUDGET_CENTS } from "@/lib/wedding/limits";
import { currentPlanId } from "@/lib/wedding/plan";

const Body = z.object({ monthlyBudgetCents: z.number({ error: "Enter a monthly budget, like 5,000.00." }) });

export const POST = route(async (req) => {
  const { monthlyBudgetCents } = await readJson(req, Body);
  const problem = centsProblem(monthlyBudgetCents, "Monthly budget", MAX_BUDGET_CENTS);
  if (problem) throw new HttpError(422, problem, "rule");
  return setMonthlyBudget(await currentPlanId(), monthlyBudgetCents);
});
