import { z } from "zod";
import { readJson, route } from "@/lib/http";
import { captureCheckout } from "@/lib/wedding/pay";
import { currentPlanId } from "@/lib/wedding/plan";

const Body = z.object({ kind: z.enum(["deposit", "balance"]), orderId: z.string().min(1).max(64) });

/** PayPal sent the couple back from its checkout. Captures that payment's own order, and nothing else. */
export const POST = route<RouteContext<"/api/contracts/[id]/capture">>(async (req, ctx) => {
  const { kind, orderId } = await readJson(req, Body);
  const contract = await captureCheckout(await currentPlanId(), (await ctx.params).id, kind, orderId);
  return { payment: contract.payments[kind] };
});
