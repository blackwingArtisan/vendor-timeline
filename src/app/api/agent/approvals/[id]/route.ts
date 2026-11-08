import { z } from "zod";
import { HttpError, readJson, route } from "@/lib/http";
import { getApprovals } from "@/lib/agent/approvals";
import { checkoutAfterApproval, ownsApproval } from "@/lib/wedding/pay";
import { currentPlanId } from "@/lib/wedding/plan";

const Body = z.object({ decision: z.enum(["approved", "denied"]), note: z.string().max(500).optional() });

/** The human's answer to a pending approval. For a payment it also returns PayPal's checkout address. Another couple's approval looks like one that doesn't exist. */
export const POST = route<RouteContext<"/api/agent/approvals/[id]">>(async (req, ctx) => {
  const b = await readJson(req, Body);
  const { id } = await ctx.params;
  const approval = getApprovals().get(id);
  if (!approval || !ownsApproval(await currentPlanId(), approval)) throw new HttpError(404, `Approval ${id} not found`, "not_found");
  const decided = getApprovals().decide(id, b.decision, "you", b.note);
  // A payment's approval goes straight on to PayPal's checkout: the one step the couple take.
  return { approval: decided, ...(await checkoutAfterApproval(decided)) };
});
