/**
 * APP-OWNED: webhook handlers. A payout item webhook must name one exact payment, and only then
 * can it mark that payment paid. A batch webhook can only prompt a re-read from PayPal. Either kind
 * for a batch this app didn't create is ignored. See payoutItemWebhook().
 */
import { payoutBatchWebhook, payoutItemWebhook } from "@/lib/wedding/pay";
import { onWebhook } from "./webhooks";

for (const type of ["PAYMENT.PAYOUTS-ITEM.SUCCEEDED", "PAYMENT.PAYOUTS-ITEM.FAILED", "PAYMENT.PAYOUTS-ITEM.UNCLAIMED", "PAYMENT.PAYOUTS-ITEM.RETURNED", "PAYMENT.PAYOUTS-ITEM.BLOCKED", "PAYMENT.PAYOUTS-ITEM.HELD", "PAYMENT.PAYOUTS-ITEM.REFUNDED"] as const) {
  onWebhook(type, async (event) => {
    await payoutItemWebhook(event);
  });
}
for (const type of ["PAYMENT.PAYOUTSBATCH.SUCCESS", "PAYMENT.PAYOUTSBATCH.DENIED"] as const) {
  onWebhook(type, async (event) => {
    await payoutBatchWebhook(event.resource.batch_header.payout_batch_id);
  });
}
