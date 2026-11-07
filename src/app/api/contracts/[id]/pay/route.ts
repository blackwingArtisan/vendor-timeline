import { z } from "zod";
import { getContext } from "@/lib/events/bus";
import { readJson, route } from "@/lib/http";
import { rememberOrigin } from "@/lib/wedding/origin";
import { requestPayment } from "@/lib/wedding/pay";
import { currentPlanId } from "@/lib/wedding/plan";

const Body = z.object({ kind: z.enum(["deposit", "balance"]) });

/** Sends a payment to the approval gate, then to PayPal's checkout. The amount comes from the confirmed terms, never the browser. */
export const POST = route<RouteContext<"/api/contracts/[id]/pay">>(async (req, ctx) => {
  const { kind } = await readJson(req, Body);
  rememberOrigin(req);
  requestPayment(await currentPlanId(), (await ctx.params).id, kind, getContext().channel);
  return { ok: true };
});
