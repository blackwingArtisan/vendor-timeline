import { z } from "zod";
import { readJson, route } from "@/lib/http";
import { confirmContract } from "@/lib/wedding/contracts";
import { isCalendarDay } from "@/lib/wedding/dates";
import { currentPlanId } from "@/lib/wedding/plan";
import { VENDOR_ROLES } from "@/lib/wedding/types";

const Day = z.string().refine(isCalendarDay, "Enter a real date.");
const Body = z.object({
  vendorName: z.string().trim().min(1).max(120),
  vendorRole: z.enum(VENDOR_ROLES),
  payeeEmail: z.string().trim().email(),
  totalCents: z.number().int().positive(),
  depositCents: z.number().int().positive(),
  depositDue: Day,
  balanceDue: Day.nullable(),
});

/** The couple's confirmation. There is no balance field: the server works it out. */
export const POST = route<RouteContext<"/api/contracts/[id]/confirm">>(async (req, ctx) => confirmContract(await currentPlanId(), (await ctx.params).id, await readJson(req, Body)));
