/** Each browser gets its own wedding, so visitors to a shared copy never see each other's contracts. */
import { cookies } from "next/headers";
import { PLAN_COOKIE, PLAN_COOKIE_OPTIONS, isPlanId, newPlanId } from "./plan-cookie";

export async function currentPlanId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(PLAN_COOKIE)?.value;
  if (isPlanId(existing)) return existing;
  // src/proxy.ts normally got here first. This covers a request it didn't match.
  const id = newPlanId();
  store.set(PLAN_COOKIE, id, PLAN_COOKIE_OPTIONS);
  return id;
}
