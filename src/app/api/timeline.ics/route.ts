import { route } from "@/lib/http";
import { listContracts } from "@/lib/wedding/contracts";
import { monthlyBudget } from "@/lib/wedding/budget";
import { isCalendarDay, utcToday } from "@/lib/wedding/dates";
import { timelineIcs } from "@/lib/wedding/ics";
import { appOrigin } from "@/lib/wedding/origin";
import { currentPlanId } from "@/lib/wedding/plan";
import { buildTimeline } from "@/lib/wedding/timeline";

/** The couple's unpaid payments as a calendar file: one all-day event per deposit or balance. */
export const GET = route(async (req) => {
  const planId = await currentPlanId();
  const param = req.nextUrl.searchParams.get("today");
  const today = param && isCalendarDay(param) ? param : utcToday();
  const { items } = buildTimeline(listContracts(planId), today, monthlyBudget(planId));
  return new Response(timelineIcs(items, { planId, origin: appOrigin() }), {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="wedding-payments.ics"',
      "Cache-Control": "no-store",
    },
  });
});
