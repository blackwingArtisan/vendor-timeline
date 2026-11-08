/**
 * APP-OWNED: webhook handlers. A capture webhook must name one of this app's payments, by its order
 * and capture, for the approved amount. Only PAYMENT.CAPTURE.COMPLETED can help mark it paid, and
 * only together with PayPal's own status read back with GET. See captureWebhook().
 */
import { captureWebhook, webhookPlanChannel } from "@/lib/wedding/pay";
import { onWebhook, routeWebhooks } from "./webhooks";

// A payment's webhook shows only to the couple whose payment it is.
routeWebhooks(webhookPlanChannel);

for (const type of ["PAYMENT.CAPTURE.COMPLETED", "PAYMENT.CAPTURE.DECLINED", "PAYMENT.CAPTURE.PENDING"] as const) {
  onWebhook(type, async (event) => {
    await captureWebhook(event);
  });
}
