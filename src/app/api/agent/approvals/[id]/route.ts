import { z } from "zod";
import { HttpError, readJson, route } from "@/lib/http";
import { getApprovals } from "@/lib/agent/approvals";
import { checkoutAfterApproval, choosePayMethod, ownsApproval } from "@/lib/wedding/pay";
import { currentPlanId } from "@/lib/wedding/plan";

const Body = z.object({
  decision: z.enum(["approved", "denied"]),
  note: z.string().max(500).optional(),
  /** A payment: PayPal's checkout (the default) or the couple's saved PayPal, and whether to save it. */
  method: z.enum(["checkout", "saved"]).optional(),
  save: z.boolean().optional(),
});

/** The human's answer to a pending approval. For a payment it also returns PayPal's checkout address. Another couple's approval looks like one that doesn't exist. */
export const POST = route<RouteContext<"/api/agent/approvals/[id]">>(async (req, ctx) => {
  const b = await readJson(req, Body);
  const { id } = await ctx.params;
  const approval = getApprovals().get(id);
  const planId = await currentPlanId();
  if (!approval || !ownsApproval(planId, approval)) throw new HttpError(404, `Approval ${id} not found`, "not_found");
  if (b.decision === "approved") choosePayMethod(planId, approval, { method: b.method, save: b.save });
  const decided = getApprovals().decide(id, b.decision, "you", b.note);
  // A payment's approval goes straight on to PayPal's checkout: the one step the couple take.
  return { approval: decided, ...(await checkoutAfterApproval(decided)) };
});
