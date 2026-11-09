import { z } from "zod";
import { readJson, route } from "@/lib/http";
import { askContract, MAX_QUESTION_CHARS } from "@/lib/wedding/contract-question";
import { requirePlanContract } from "@/lib/wedding/contracts";
import { currentPlanId } from "@/lib/wedding/plan";

const Body = z.object({
  question: z.string({ error: "Type a question first." }).trim().min(5, "Type a question first.").max(MAX_QUESTION_CHARS, `Keep the question under ${MAX_QUESTION_CHARS} characters.`),
});

/** "Ask about this contract": an answer from this contract's own words, with the clause, checked by code. */
export const POST = route<RouteContext<"/api/contracts/[id]/question">>(
  async (req, ctx) => {
    const { question } = await readJson(req, Body);
    const contract = requirePlanContract(await currentPlanId(), (await ctx.params).id);
    return askContract(contract, question);
  },
  { rateLimit: "ai" },
);
