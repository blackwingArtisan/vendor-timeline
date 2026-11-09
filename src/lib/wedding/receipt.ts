/**
 * A paid payment's receipt, read back from PayPal on request: the order and the capture as PayPal
 * holds them now, the webhook event that marked it paid, and PayPal's debug_id for each re-read, so
 * anyone can quote them to PayPal. Nothing here comes from the app's own copy except the ids it asks
 * PayPal about.
 */
import { HttpError } from "@/lib/http";
import { getPayPal } from "@/lib/paypal";
import { collectCalls } from "@/lib/paypal/meta";
import { requirePlanContract } from "./contracts";
import type { ItemKind, Payment } from "./types";

export interface ReceiptCall {
  /** "orders.get" */
  operation: string;
  debugId?: string;
  httpStatus?: number;
}

export interface Receipt {
  vendorName: string;
  kind: ItemKind;
  mode: "mock" | "sandbox";
  orderId: string;
  orderStatus?: string;
  captureId: string;
  captureStatus?: string;
  /** PayPal's own amount on the capture: "600.00 USD". */
  captureAmount?: string;
  payee?: string;
  /** The verified PAYMENT.CAPTURE.COMPLETED event, when one reached this copy of the app. */
  webhook?: { eventId: string; eventType: string; receivedAt: string };
  paidBy?: Payment["paidBy"];
  /** The webhook was expected here but hadn't come when the re-read made it paid. */
  webhookLate?: boolean;
  /** Each call made to PayPal for this receipt, with PayPal's debug_id. */
  calls: ReceiptCall[];
  readAt: string;
}

export async function readReceipt(planId: string, contractId: string, kind: ItemKind): Promise<Receipt> {
  const contract = requirePlanContract(planId, contractId);
  const payment = contract.payments[kind];
  if (payment?.state !== "paid" || !payment.orderId || !payment.captureId) throw new HttpError(409, "This payment hasn't been paid in PayPal yet, so there's no receipt.", "conflict");
  const { orderId, captureId } = payment;
  const paypal = getPayPal();
  const { result, calls } = await collectCalls(async () => {
    const order = await paypal.orders.get(orderId);
    const capture = await paypal.payments.getCapture(captureId);
    return { order, capture };
  });
  const { order, capture } = result;
  return {
    vendorName: contract.confirmed?.vendorName ?? contract.proposed.vendorName.value ?? "Vendor",
    kind,
    mode: paypal.mode,
    orderId: order.id,
    orderStatus: order.status,
    captureId: capture.id,
    captureStatus: capture.status,
    captureAmount: capture.amount ? `${capture.amount.value} ${capture.amount.currency_code}` : undefined,
    payee: order.purchase_units?.[0]?.payee?.email_address,
    webhook: payment.webhook ? { eventId: payment.webhook.eventId, eventType: payment.webhook.eventType, receivedAt: payment.webhook.receivedAt } : undefined,
    paidBy: payment.paidBy,
    webhookLate: payment.webhookLate,
    calls: calls.map((c) => ({ operation: c.operation, debugId: c.debugId, httpStatus: c.httpStatus })),
    readAt: new Date().toISOString(),
  };
}
