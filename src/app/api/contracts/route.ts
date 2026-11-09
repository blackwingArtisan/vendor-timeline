import { z } from "zod";
import { readJson, route } from "@/lib/http";
import { isSamplePlan } from "@/lib/wedding/budget";
import { addContract, listContracts } from "@/lib/wedding/contracts";
import { MAX_CONTRACT_CHARS } from "@/lib/wedding/limits";
import { planMix } from "@/lib/wedding/plan-mix";
import { currentPlanId } from "@/lib/wedding/plan";

const Body = z.object({
  text: z.string({ error: "Paste or upload a contract first." }).trim().min(40, "That is too short to be a contract.").max(MAX_CONTRACT_CHARS, `That contract is too long. The most the app reads is ${MAX_CONTRACT_CHARS.toLocaleString("en-US")} characters, so paste just the payment terms.`),
  fileName: z.string().max(200, "That file name is too long.").optional(),
});

export const GET = route(async () => {
  const planId = await currentPlanId();
  const contracts = listContracts(planId);
  return { contracts, samplePlan: isSamplePlan(planId), planMix: planMix(contracts) };
});

export const POST = route(async (req) => addContract(await currentPlanId(), await readJson(req, Body)), { rateLimit: "ai" });
