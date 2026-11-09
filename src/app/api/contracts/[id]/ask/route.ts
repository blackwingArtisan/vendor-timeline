import { z } from "zod";
import { readJson, route } from "@/lib/http";
import { isCalendarDay } from "@/lib/wedding/dates";
import { currentPlanId } from "@/lib/wedding/plan";
import { openAsk } from "@/lib/wedding/vendor-ask";

const Body = z.object({ kind: z.enum(["deposit", "balance"]), to: z.string().max(10), today: z.string().refine(isCalendarDay, "Enter a real date.").optional() });

/** "Share the ask": a link for this one payment, for the couple to send the vendor themselves. */
export const POST = route<RouteContext<"/api/contracts/[id]/ask">>(async (req, ctx) => {
  const { kind, to, today } = await readJson(req, Body);
  const ask = openAsk(await currentPlanId(), (await ctx.params).id, kind, to, today);
  return { token: ask.token, path: `/vendor/${ask.token}` };
});
