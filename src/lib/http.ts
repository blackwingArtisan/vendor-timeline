/**
 * Route handler wrapper used by every API route:
 *
 *   export const POST = route(async (req) => {
 *     const body = await readJson(req, z.object({ amount: z.string() }));
 *     return getPayPal().orders.create(...);          // plain values become JSON
 *   }, { rateLimit: "api" });
 *
 * It (1) opts out of prerendering (Cache Components), (2) tags timeline events with the
 * browser session (x-kit-session header) so each tab sees its own activity, (3) rate-limits,
 * (4) maps PayPal/AI/validation errors to JSON with the right status (and PayPal debug_id).
 */
import { connection, type NextRequest } from "next/server";
import { ZodError, type z } from "zod";
import { withContext } from "./events/bus";
import { getEnv, InvalidEnvError } from "./env";
import { PayPalApiError, PayPalNetworkError } from "./paypal/errors";
import { enforceRateLimit } from "./ai/rate-limit";
import { RateLimitedError } from "./ai/errors";

export const SESSION_HEADER = "x-kit-session";

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code = "HTTP_ERROR",
  ) {
    super(message);
  }
}

export interface RouteOptions {
  /** "api" (default for non-GET), "ai" for routes that call Claude, false to skip. */
  rateLimit?: "ai" | "api" | false;
  /** 404 unless PAYPAL_MODE=mock (dev helpers). */
  mockOnly?: boolean;
}

/** Zod's own wording ("Too big: expected string...") is for developers. Our schemas say it plainly. */
const ZOD_WORDING = /^(Invalid|Expected|Too (big|small)|Required|Unrecognized|Number must|String must)/;

function plainIssue(error: ZodError): string {
  const message = error.issues[0]?.message;
  return message && !ZOD_WORDING.test(message) ? message : "Something in that request wasn't right, so nothing changed. Check it and try again.";
}

/** What a person sees when PayPal refuses something. PayPal's own words stay in paypalMessage for developers. */
export function plainPayPalMessage(error: PayPalApiError): string {
  const code = error.issue ?? error.paypalName;
  const ref = error.debugId ? ` PayPal reference: ${error.debugId}.` : "";
  if (code === "ORDER_NOT_APPROVED" || code === "PAYER_ACTION_REQUIRED") return "PayPal hasn't had your approval for this payment yet, so nothing was taken. Finish paying in PayPal's checkout.";
  if (code === "INSTRUMENT_DECLINED") return "PayPal declined that card or account, so nothing was taken. Try another way to pay in PayPal's checkout.";
  if (code === "ORDER_ALREADY_CAPTURED" || code === "DUPLICATE_INVOICE_ID") return "This payment has already gone through. Refresh the page to see it.";
  if (code === "PAYEE_ACCOUNT_RESTRICTED" || code === "PAYEE_ACCOUNT_INVALID" || code === "PAYEE_NOT_ENABLED_FOR_CARD_PROCESSING") return `PayPal can't send money to that vendor's account right now, so nothing was taken. Check the vendor's PayPal email.${ref}`;
  if (error.status === 401 || error.status === 403) return `PayPal didn't accept this app's sign-in, so nothing was paid.${ref}`;
  return `PayPal couldn't do that just now, so nothing was paid. Try again in a minute.${ref}`;
}

export function errorResponse(error: unknown): Response {
  if (error instanceof PayPalApiError) {
    const body = { type: "paypal", ...error.toJSON(), message: plainPayPalMessage(error), paypalMessage: error.message };
    return Response.json({ error: body }, { status: error.status >= 400 && error.status < 600 ? error.status : 502 });
  }
  if (error instanceof PayPalNetworkError) return Response.json({ error: { type: "paypal_network", message: "PayPal didn't answer, so nothing was paid. Try again in a minute." } }, { status: 502 });
  if (error instanceof ZodError) return Response.json({ error: { type: "validation", message: plainIssue(error), issues: error.issues } }, { status: 400 });
  if (error instanceof RateLimitedError) {
    return Response.json({ error: { type: "rate_limited", message: error.message, retryAfterSeconds: error.retryAfterSeconds } }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
  }
  if (error instanceof HttpError) return Response.json({ error: { type: error.code, message: error.message } }, { status: error.status });
  if (error instanceof InvalidEnvError) return Response.json({ error: { type: "config", message: error.message } }, { status: 500 });
  const e = error as { name?: string; message?: string; status?: number };
  const status = typeof e?.status === "number" && e.status >= 400 && e.status < 600 ? e.status : 500;
  if (status === 500) console.error("[api]", error);
  return Response.json({ error: { type: e?.name ?? "error", message: e?.message ?? "Unexpected error" } }, { status });
}

export function route<Ctx = { params: Promise<Record<string, string>> }>(
  handler: (req: NextRequest, ctx: Ctx) => Promise<unknown> | unknown,
  opts: RouteOptions = {},
) {
  return async (req: NextRequest, ctx: Ctx): Promise<Response> => {
    await connection();
    try {
      if (opts.mockOnly && getEnv().paypalMode !== "mock") throw new HttpError(404, "Only available in PAYPAL_MODE=mock", "not_found");
      const limit = opts.rateLimit ?? (req.method === "GET" ? false : "api");
      if (limit) enforceRateLimit(req, limit);
      const channel = req.headers.get(SESSION_HEADER) || "global";
      const result = await withContext({ channel, actor: "user" }, () => handler(req, ctx));
      if (result instanceof Response) return result;
      return Response.json(result ?? { ok: true });
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export async function readJson<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown = {};
  const text = await req.text();
  if (text) {
    try {
      raw = JSON.parse(text);
    } catch {
      throw new HttpError(400, "That request couldn't be read, so nothing changed. Try again.", "invalid_json");
    }
  }
  return schema.parse(raw);
}

export const moneyValue = /^\d+(\.\d{1,2})?$/;
