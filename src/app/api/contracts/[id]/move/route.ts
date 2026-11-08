import { z } from "zod";
import { timeline } from "@/lib/events/bus";
import { readJson, route } from "@/lib/http";
import { moveDueDate } from "@/lib/wedding/contracts";
import { formatDay, isCalendarDay } from "@/lib/wedding/dates";
import { currentPlanId } from "@/lib/wedding/plan";

const Body = z.object({ kind: z.enum(["deposit", "balance"]), due: z.string().max(10), today: z.string().refine(isCalendarDay, "Enter a real date.").optional() });

/** Saves a moved payment date. The server's copy is the truth, so a drag survives a reload. */
export const POST = route<RouteContext<"/api/contracts/[id]/move">>(async (req, ctx) => {
  const { kind, due, today } = await readJson(req, Body);
  const contract = moveDueDate(await currentPlanId(), (await ctx.params).id, kind, due, today);
  timeline.emit({ kind: "info", status: "succeeded", title: `Moved the ${contract.confirmed!.vendorName} ${kind}`, detail: `Now due ${formatDay(due)}` });
  return { ok: true };
});
