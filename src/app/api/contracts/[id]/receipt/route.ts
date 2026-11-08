import { z } from "zod";
import { route } from "@/lib/http";
import { currentPlanId } from "@/lib/wedding/plan";
import { readReceipt } from "@/lib/wedding/receipt";

const Kind = z.enum(["deposit", "balance"]);

/** A paid payment's receipt, re-read from PayPal now: ?kind=deposit|balance. */
export const GET = route<RouteContext<"/api/contracts/[id]/receipt">>(async (req, ctx) => {
  const kind = Kind.parse(req.nextUrl.searchParams.get("kind"));
  return readReceipt(await currentPlanId(), (await ctx.params).id, kind);
});
