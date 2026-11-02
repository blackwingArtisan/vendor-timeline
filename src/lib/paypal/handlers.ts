/**
 * APP-OWNED: webhook handlers. A payout webhook only prompts a re-read from PayPal, and one for a
 * batch this app didn't create is ignored. See refreshFromWebhook().
 */
import { refreshFromWebhook } from "@/lib/wedding/pay";
import { onWebhook } from "./webhooks";

for (const type of ["PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "PAYMENT.PAYOUTS-ITEM.FAILED", "PAYMENT.PAYOUTS-ITEM.UNCLAIMED", "PAYMENT.PAYOUTS-ITEM.RETURNED", "PAYMENT.PAYOUTS-ITEM.BLOCKED", "PAYMENT.PAYOUTS-ITEM.HELD", "PAYMENT.PAYOUTS-ITEM.REFUNDED"] as const) {
  onWebhook(type, async (event) => {
    await refreshFromWebhook(event.resource.payout_batch_id);
  });
}
for (const type of ["PAYMENT.PAYOUTSBATCH.SUCCESS", "PAYMENT.PAYOUTSBATCH.DENIED"] as const) {
  onWebhook(type, async (event) => {
    await refreshFromWebhook(event.resource.batch_header.payout_batch_id);
  });
}
