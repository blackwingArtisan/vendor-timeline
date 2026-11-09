/** Reads the PayPal sandbox directly, so the checks don't depend on the app under test. */
import { DEFAULT_SANDBOX_VENDOR_EMAIL, loadEnvFiles } from "../../src/lib/env-core";

const API = "https://api-m.sandbox.paypal.com";

export interface PayoutRead {
  batch_header: {
    payout_batch_id: string;
    batch_status: string;
    sender_batch_header: { sender_batch_id: string };
    amount?: { currency: string; value: string };
  };
  items: {
    payout_item_id: string;
    transaction_id?: string;
    transaction_status: string;
    payout_item: { amount: { currency: string; value: string }; receiver: string; sender_item_id?: string };
  }[];
}

async function token(): Promise<string> {
  loadEnvFiles();
  const basic = Buffer.from(`${process.env.PAYPAL_CLIENT_ID}:${process.env.PAYPAL_CLIENT_SECRET}`).toString("base64");
  const res = await fetch(`${API}/v1/oauth2/token`, { method: "POST", headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=client_credentials" });
  if (!res.ok) throw new Error(`PayPal token request failed: ${res.status}`);
  return ((await res.json()) as { access_token: string }).access_token;
}

export async function readPayout(batchId: string): Promise<PayoutRead> {
  const res = await fetch(`${API}/v1/payments/payouts/${batchId}`, { headers: { Authorization: `Bearer ${await token()}` } });
  if (!res.ok) throw new Error(`GET payout ${batchId} failed: ${res.status}`);
  return (await res.json()) as PayoutRead;
}

/** The batch finishes after its item, so wait for both before reading the final state. */
export async function readFinishedPayout(batchId: string, tries = 20): Promise<PayoutRead> {
  let read = await readPayout(batchId);
  for (let i = 0; i < tries && (read.batch_header.batch_status !== "SUCCESS" || read.items[0]?.transaction_status !== "SUCCESS"); i++) {
    await new Promise((r) => setTimeout(r, 3000));
    read = await readPayout(batchId);
  }
  return read;
}

export interface PayoutEvent {
  id: string;
  event_type: string;
  resource: { payout_batch_id: string; payout_item: { sender_item_id?: string } };
}

/** PayPal's own record of the item webhook it sent for this batch. Its list can trail the webhook itself by over a minute. */
export async function readPayoutEvent(batchId: string, tries = 60): Promise<PayoutEvent | undefined> {
  for (let i = 0; i < tries; i++) {
    const res = await fetch(`${API}/v1/notifications/webhooks-events?page_size=50&event_type=PAYMENT.PAYOUTS-ITEM.SUCCEEDED`, { headers: { Authorization: `Bearer ${await token()}` } });
    if (!res.ok) throw new Error(`GET webhook events failed: ${res.status}`);
    const found = ((await res.json()) as { events: PayoutEvent[] }).events.find((e) => e.resource.payout_batch_id === batchId);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return undefined;
}

export interface OrderRead {
  id: string;
  status: string;
  intent: string;
  purchase_units: {
    reference_id: string;
    amount: { currency_code: string; value: string };
    payee: { email_address?: string; merchant_id?: string };
    payments?: { captures?: { id: string; status: string; amount: { currency_code: string; value: string } }[] };
  }[];
}

export interface CaptureRead {
  id: string;
  status: string;
  amount: { currency_code: string; value: string };
  supplementary_data?: { related_ids?: { order_id?: string } };
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${API}${path}`, { headers: { Authorization: `Bearer ${await token()}` } });
  if (!res.ok) throw new Error(`GET ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

export const readOrder = (orderId: string) => get<OrderRead>(`/v2/checkout/orders/${orderId}`);
export const readCapture = (captureId: string) => get<CaptureRead>(`/v2/payments/captures/${captureId}`);

/** The account the orders pay: the app's own sandbox business account, standing in for the vendor. */
export function sandboxSellerEmail(): string {
  loadEnvFiles();
  return process.env.PAYPAL_SANDBOX_SELLER_EMAIL!;
}

/** The separate vendor account the florist and caterer are paid to in sandbox. */
export function sandboxVendorEmail(): string {
  loadEnvFiles();
  return process.env.PAYPAL_SANDBOX_VENDOR_EMAIL?.trim() ?? DEFAULT_SANDBOX_VENDOR_EMAIL;
}

export interface CaptureEvent {
  id: string;
  event_type: string;
  resource: { id: string; supplementary_data?: { related_ids?: { order_id?: string } } };
}

/** PayPal's own record of the PAYMENT.CAPTURE.COMPLETED webhook it sent for this capture. Its list can trail the webhook by over a minute. */
export async function readCaptureEvent(captureId: string, tries = 60): Promise<CaptureEvent | undefined> {
  for (let i = 0; i < tries; i++) {
    const { events } = await get<{ events: CaptureEvent[] }>(`/v1/notifications/webhooks-events?page_size=50&event_type=PAYMENT.CAPTURE.COMPLETED`);
    const found = events.find((e) => e.resource.id === captureId);
    if (found) return found;
    await new Promise((r) => setTimeout(r, 3000));
  }
  return undefined;
}

/**
 * What another hackathon entry on the same sandbox app does: a card sale made straight on PayPal
 * with the shared credentials, never through this app. It completes at once, and PayPal sends its
 * PAYMENT.CAPTURE.COMPLETED webhook to every webhook on the app, this one's included.
 */
export async function otherAppsSale(value: string): Promise<{ orderId: string; captureId: string }> {
  const res = await fetch(`${API}/v2/checkout/orders`, {
    method: "POST",
    headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json", "PayPal-Request-Id": `other-app-${Date.now()}-${Math.random().toString(36).slice(2)}` },
    body: JSON.stringify({
      intent: "CAPTURE",
      purchase_units: [{ amount: { currency_code: "USD", value }, description: "Single-origin beans x2 (another app's sale)" }],
      payment_source: { card: { number: "4111111111111111", expiry: "2030-12", security_code: "123", name: "Other App Buyer", billing_address: { address_line_1: "1 Main St", admin_area_2: "San Jose", admin_area_1: "CA", postal_code: "95131", country_code: "US" } } },
    }),
  });
  const order = (await res.json()) as OrderRead;
  if (!res.ok) throw new Error(`Other app's order failed: ${res.status} ${JSON.stringify(order).slice(0, 300)}`);
  const captureId = order.purchase_units[0].payments?.captures?.[0]?.id;
  if (order.status !== "COMPLETED" || !captureId) throw new Error(`Other app's card sale didn't complete: ${order.status}`);
  return { orderId: order.id, captureId };
}
