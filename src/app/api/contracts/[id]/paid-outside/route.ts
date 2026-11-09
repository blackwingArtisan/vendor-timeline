import { z } from "zod";
import { timeline } from "@/lib/events/bus";
import { HttpError, readJson, route } from "@/lib/http";
import { formatCents } from "@/lib/wedding/cents";
import { formatDay, isCalendarDay } from "@/lib/wedding/dates";
import { readAmount } from "@/lib/wedding/limits";
import { recordPaidOutside } from "@/lib/wedding/pay";
import { currentPlanId } from "@/lib/wedding/plan";
import { OUTSIDE_METHODS } from "@/lib/wedding/types";

const Body = z.object({
  kind: z.enum(["deposit", "balance"]),
  amount: z.string().max(20),
  paidOn: z.string().max(10),
  method: z.enum(OUTSIDE_METHODS),
  today: z.string().refine(isCalendarDay, "Enter a real date.").optional(),
});

/** Records a deposit or balance paid outside PayPal (cash or cheque). Nothing goes to PayPal. */
export const POST = route<RouteContext<"/api/contracts/[id]/paid-outside">>(async (req, ctx) => {
  const { kind, amount, paidOn, method, today } = await readJson(req, Body);
  const read = readAmount(amount, "Amount");
  if (read.error !== undefined) throw new HttpError(422, read.error, "rule");
  const contract = recordPaidOutside(await currentPlanId(), (await ctx.params).id, kind, { cents: read.cents, paidOn, method }, today);
  timeline.emit({
    kind: "info",
    status: "succeeded",
    title: `Marked the ${contract.confirmed!.vendorName} ${kind} paid outside PayPal`,
    detail: `${formatCents(read.cents)} by ${method} on ${formatDay(paidOn)}. Not a PayPal payment: no PayPal call was made and none will be.`,
  });
  return { ok: true };
});
