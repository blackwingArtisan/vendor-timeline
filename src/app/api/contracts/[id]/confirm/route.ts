import { z } from "zod";
import { readJson, route } from "@/lib/http";
import { confirmContract } from "@/lib/wedding/contracts";
import { isCalendarDay } from "@/lib/wedding/dates";
import { currentPlanId } from "@/lib/wedding/plan";
import { VENDOR_ROLES } from "@/lib/wedding/types";

const Day = z.string().refine(isCalendarDay, "Enter a real date.");
const Body = z.object({
  vendorName: z.string().trim().min(1, "Enter the vendor's name.").max(120, "That vendor name is too long."),
  vendorRole: z.enum(VENDOR_ROLES),
  payeeEmail: z.string().trim().email("Enter the email address to pay, like name@example.com."),
  // Amount and date ranges are checked in confirmContract, so the words match the form's.
  totalCents: z.number({ error: "Enter the total." }),
  depositCents: z.number({ error: "Enter the deposit." }),
  depositDue: Day,
  balanceDue: Day.nullable(),
});

/** The couple's confirmation. There is no balance field: the server works it out. */
export const POST = route<RouteContext<"/api/contracts/[id]/confirm">>(async (req, ctx) => confirmContract(await currentPlanId(), (await ctx.params).id, await readJson(req, Body)));
