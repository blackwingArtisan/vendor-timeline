/** The cookie that ties a browser to its wedding. Lives apart from plan.ts so the proxy can use it. */
export const PLAN_COOKIE = "vt_plan";
export const PLAN_COOKIE_OPTIONS = { httpOnly: true, sameSite: "lax", path: "/", maxAge: 60 * 60 * 24 * 60 } as const;

export function isPlanId(value: string | undefined): value is string {
  return !!value && /^plan_[0-9a-f-]{12}$/.test(value);
}

export function newPlanId(): string {
  return `plan_${crypto.randomUUID().slice(0, 12)}`;
}
