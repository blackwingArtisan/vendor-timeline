import { route } from "@/lib/http";
import { switchToOwnPlan } from "@/lib/wedding/plan";

/** "Start your own plan": the browser moves to a new, empty plan. Nothing is deleted or paid. */
export const POST = route(async () => {
  await switchToOwnPlan();
  return { ok: true };
});
