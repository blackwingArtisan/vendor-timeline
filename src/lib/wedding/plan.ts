/** Each browser gets its own wedding, so visitors to a shared copy never see each other's contracts. */
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";

const COOKIE = "vt_plan";
const SIXTY_DAYS = 60 * 60 * 24 * 60;

export async function currentPlanId(): Promise<string> {
  const store = await cookies();
  const existing = store.get(COOKIE)?.value;
  if (existing && /^plan_[0-9a-f-]{12}$/.test(existing)) return existing;
  const id = `plan_${randomUUID().slice(0, 12)}`;
  store.set(COOKIE, id, { httpOnly: true, sameSite: "lax", path: "/", maxAge: SIXTY_DAYS });
  return id;
}
