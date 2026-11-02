import { NextResponse, type NextRequest } from "next/server";
import { PLAN_COOKIE, PLAN_COOKIE_OPTIONS, isPlanId, newPlanId } from "@/lib/wedding/plan-cookie";

/**
 * Give a new visitor their plan on the very first request, before any page script runs. Left to
 * the API routes, two requests at once each made a plan, the last cookie won, and a contract saved
 * under the other plan came back "not found".
 */
export function proxy(request: NextRequest) {
  if (isPlanId(request.cookies.get(PLAN_COOKIE)?.value)) return NextResponse.next();

  const id = newPlanId();
  request.cookies.set(PLAN_COOKIE, id);
  const headers = new Headers(request.headers);
  headers.set("cookie", request.cookies.toString());
  const response = NextResponse.next({ request: { headers } });
  response.cookies.set(PLAN_COOKIE, id, PLAN_COOKIE_OPTIONS);
  return response;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|.*\\.[a-z0-9]+$).*)"],
};
