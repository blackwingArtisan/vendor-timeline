/** Each browser gets its own wedding, so visitors to a shared copy never see each other's contracts. */
import { cookies } from "next/headers";
import { openPlan, startOwnPlan } from "./budget";
import { PLAN_COOKIE, PLAN_COOKIE_OPTIONS, isPlanId, newPlanId } from "./plan-cookie";

export async function currentPlanId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(PLAN_COOKIE)?.value;
  // src/proxy.ts normally got here first. This covers a request it didn't match.
  const id = isPlanId(existing) ? existing : newPlanId();
  if (id !== existing) store.set(PLAN_COOKIE, id, PLAN_COOKIE_OPTIONS);
  openPlan(id);
  return id;
}

/** Leave the sample plan for a new, empty one of the couple's own. */
export async function switchToOwnPlan(): Promise<string> {
  const id = newPlanId();
  startOwnPlan(id);
  (await cookies()).set(PLAN_COOKIE, id, PLAN_COOKIE_OPTIONS);
  return id;
}
