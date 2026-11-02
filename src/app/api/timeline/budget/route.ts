import { z } from "zod";
import { readJson, route } from "@/lib/http";
import { setMonthlyBudget } from "@/lib/wedding/budget";
import { currentPlanId } from "@/lib/wedding/plan";

const Body = z.object({ monthlyBudgetCents: z.number().int().min(100).max(100_000_000) });

export const POST = route(async (req) => setMonthlyBudget(await currentPlanId(), (await readJson(req, Body)).monthlyBudgetCents));
