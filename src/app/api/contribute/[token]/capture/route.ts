import { z } from "zod";
import { readJson, route } from "@/lib/http";
import { contributorCapture } from "@/lib/wedding/contributor";

const Body = z.object({ orderId: z.string().min(1).max(64) });

/** PayPal sent the contributor back from their checkout. Captures that link's own order, and nothing else. */
export const POST = route<RouteContext<"/api/contribute/[token]/capture">>(async (req, ctx) => {
  const { orderId } = await readJson(req, Body);
  return contributorCapture((await ctx.params).token, orderId);
});
