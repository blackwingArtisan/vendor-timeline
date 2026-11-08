/**
 * Incoming webhook pipeline (used by POST /api/paypal/webhooks and by the mock's deliveries):
 *   verify signature -> parse -> de-duplicate -> ledger + timeline -> your onWebhook handlers
 *
 * Register handlers in src/lib/paypal/handlers.ts.
 */
import { timeline, withContext } from "../events/bus";
import { singleton } from "../singleton";
import { getEnv } from "../env";
import { getPayPal } from "./index";
import { ingestPayPalResource, ledger } from "./ledger";
import { dispatchWebhook, invoiceFromEvent, parseWebhookEvent, webhookChannel, type AnyWebhookEvent } from "./webhooks";
import "./handlers";

const seen = singleton("paypal:webhook-seen", () => new Map<string, number>());

function amountOf(event: AnyWebhookEvent) {
  const r = event.resource as Record<string, unknown>;
  const m = (r.amount ?? r.dispute_amount ?? invoiceFromEvent(event)?.amount) as { currency_code?: string; value?: string } | undefined;
  return m?.currency_code && m.value ? { currency_code: m.currency_code, value: m.value } : undefined;
}

/**
 * Sandbox entries share one PayPal app, and PayPal sends every webhook all of that app's events.
 * An event counts here only if it names an order, capture, authorization, refund, invoice, payout
 * batch or dispute this app itself made or touched (its ledger). Anything else, including an event
 * that names nothing this app can check, is another app's, so one entry's money stays out of another's.
 */
export function isOtherAppsEvent(event: AnyWebhookEvent) {
  const r = event.resource as {
    id?: string;
    links?: { rel: string; href: string }[];
    supplementary_data?: { related_ids?: { order_id?: string; authorization_id?: string; capture_id?: string } };
    payout_batch_id?: string;
    batch_header?: { payout_batch_id?: string };
    dispute_id?: string;
    disputed_transactions?: { seller_transaction_id?: string }[];
  };
  const batchId = r.payout_batch_id ?? r.batch_header?.payout_batch_id;
  if (batchId) return !ledger.get("payout", batchId);
  const orderId = r.supplementary_data?.related_ids?.order_id ?? (event.event_type.startsWith("CHECKOUT.ORDER.") ? r.id : undefined);
  if (orderId) return !ledger.get("order", orderId);
  if (event.event_type.startsWith("INVOICING.INVOICE.")) {
    const invoiceId = invoiceFromEvent(event)?.id;
    return !invoiceId || !ledger.get("invoice", invoiceId);
  }
  const related = r.supplementary_data?.related_ids;
  const upId = r.links?.find((l) => l.rel === "up")?.href.split("/").pop();
  const known = [
    r.id && ledger.get("capture", r.id),
    r.id && ledger.get("authorization", r.id),
    r.id && ledger.get("refund", r.id),
    r.dispute_id && ledger.get("dispute", r.dispute_id),
    related?.authorization_id && ledger.get("authorization", related.authorization_id),
    related?.capture_id && ledger.get("capture", related.capture_id),
    upId && (ledger.get("capture", upId) ?? ledger.get("authorization", upId) ?? ledger.get("order", upId)),
    ...(r.disputed_transactions ?? []).map((t) => t.seller_transaction_id && ledger.get("capture", t.seller_transaction_id)),
  ];
  return !known.some(Boolean);
}

export async function processWebhookEvent(event: AnyWebhookEvent, opts: { replay?: boolean } = {}) {
  // PayPal retries a delivery up to 25 times over 3 days; handle each event id once.
  if (!opts.replay && seen.has(event.id)) return { duplicate: true, handled: 0, errors: [] as string[] };
  seen.set(event.id, Date.now());
  if (seen.size > 5000) seen.delete(seen.keys().next().value!);

  ingestPayPalResource(event.resource);
  const channel = webhookChannel(event);
  return withContext({ channel, actor: "webhook" }, async () => {
    const result = await dispatchWebhook(event);
    timeline.emit({
      kind: "webhook",
      status: result.errors.length ? "failed" : "succeeded",
      title: event.event_type,
      subtitle: opts.replay ? `Replayed webhook · ${event.id}` : `Webhook · ${event.id}`,
      detail: event.summary,
      amount: amountOf(event),
      error: result.errors.length ? { name: "WebhookHandlerError", message: result.errors.join("; ") } : undefined,
      data: { event, handlers: result.handled },
    });
    return { duplicate: false, ...result };
  });
}

export async function handleWebhookRequest(req: Request): Promise<Response> {
  const raw = await req.text();
  const verification = await getPayPal().webhooks.verify(req.headers, raw);
  if (!verification.verified) {
    timeline.emit({
      kind: "webhook",
      status: "failed",
      channel: "global",
      title: "Webhook rejected",
      detail: verification.reason ?? verification.status,
    });
    const status = verification.status === "NOT_CONFIGURED" ? 503 : 400;
    return Response.json({ error: "WEBHOOK_VERIFICATION_FAILED", ...verification }, { status });
  }
  let event: AnyWebhookEvent;
  try {
    event = parseWebhookEvent(raw);
  } catch {
    return Response.json({ error: "INVALID_WEBHOOK_PAYLOAD" }, { status: 400 });
  }
  if (getEnv().paypalMode === "sandbox" && isOtherAppsEvent(event)) return Response.json({ received: true, ignored: "other-app" });
  const replay = getEnv().paypalMode === "mock" && req.headers.get("x-kit-replay") === "1";
  const result = await processWebhookEvent(event, { replay });
  // Always 2xx once verified, or PayPal keeps retrying; handler errors show on the timeline.
  return Response.json({ received: true, ...result });
}
