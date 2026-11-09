import { z } from "zod";
import { vendorReplyAgent } from "@/agents/vendor-reply";
import { getContext } from "@/lib/events/bus";
import { readJson, route } from "@/lib/http";
import { startAgentRun } from "@/lib/agent/runs";
import { requirePlanContract } from "@/lib/wedding/contracts";
import { isCalendarDay, utcToday } from "@/lib/wedding/dates";
import { currentPlanId } from "@/lib/wedding/plan";

const Body = z.object({ kind: z.enum(["deposit", "balance"]), today: z.string().refine(isCalendarDay, "Enter a real date.").optional() });

/** "Let the agent read it": the reply agent reads the vendor's answer and asks the couple to approve the move. */
export const POST = route<RouteContext<"/api/contracts/[id]/ask/read">>(
  async (req, ctx) => {
    const { kind, today = utcToday() } = await readJson(req, Body);
    const planId = await currentPlanId();
    const contract = requirePlanContract(planId, (await ctx.params).id);
    const name = contract.confirmed?.vendorName ?? "the vendor";
    const run = startAgentRun(vendorReplyAgent(planId, today), { goal: `Read ${name}'s reply about the ${kind} and move it if they agreed.`, context: { contract_id: contract.id, kind, today } }, { channel: getContext().channel });
    return { runId: run.id };
  },
  { rateLimit: "ai" },
);
