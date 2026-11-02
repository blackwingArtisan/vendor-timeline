import { route } from "@/lib/http";
import { isCalendarDay } from "@/lib/wedding/dates";
import { viewTimeline } from "@/lib/wedding/pay";
import { currentPlanId } from "@/lib/wedding/plan";

/** ?today= is the couple's own calendar day, so "overdue" matches the date on their wall. */
export const GET = route(async (req) => {
  const today = req.nextUrl.searchParams.get("today");
  return viewTimeline(await currentPlanId(), today && isCalendarDay(today) ? today : undefined);
});
