/**
 * Every sample vendor is paid to a vendor's account, never this app's own. In sandbox each payment
 * is re-read from PayPal: the order pays the vendor's stand-in test business account, for exactly
 * the confirmed deposit. The photographer and florist are paid in vendor-flow and agent-flow; this
 * pays the other three.
 */
import { expect, test } from "@playwright/test";
import { formatCents } from "../../src/lib/wedding/cents";
import { BAND, CATERER, VENUE, type SampleFacts } from "../../src/lib/wedding/samples";
import { approveAndPay } from "./pay-in-checkout";
import { readOrder, sandboxPayeeFor, sandboxSellerEmail } from "./paypal-reread";

const row = (page: import("@playwright/test").Page, s: SampleFacts) => page.locator(`[data-testid="timeline-item"][data-role="${s.vendorRole}"][data-kind="deposit"]`);

test("the caterer, venue and band deposits each pay the vendor's own stand-in account, not the app's", async ({ page }) => {
  test.setTimeout(480_000);
  const status = await (await page.request.get("/api/kit/status")).json();
  const sandbox = status.paypal.mode === "sandbox";
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
  for (const vendor of [CATERER, VENUE, BAND]) {
    const deposit = row(page, vendor);
    await deposit.getByTestId("pay-item").click();
    const prompt = deposit.getByTestId("approval-prompt");
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    await expect(prompt).toContainText(`Pay ${vendor.vendorName} ${formatCents(vendor.depositCents)} for the deposit`);
    await expect(prompt.getByTestId("approval-to")).toHaveText(vendor.vendorName);
    if (sandbox) {
      await expect(prompt.getByTestId("stand-in")).toHaveAttribute("data-account", "vendor");
      await expect(prompt.getByTestId("stand-in")).toContainText(`(${sandboxPayeeFor(vendor.vendorRole)}), not this app's`);
    } else await expect(prompt.getByTestId("stand-in")).toHaveCount(0);
    const orderId = await approveAndPay(page, prompt, sandbox);
    await expect(deposit.getByTestId("item-status")).toHaveText("Paid", { timeout: 200_000 });
    if (sandbox) {
      await expect(deposit.getByTestId("paypal-payee")).toHaveText(sandboxPayeeFor(vendor.vendorRole));
      const order = await readOrder(orderId);
      const unit = order.purchase_units[0];
      const capture = unit.payments?.captures?.[0];
      console.log(`${vendor.label} deposit, re-read from PayPal: order ${order.id} ${order.status}, payee ${unit.payee.email_address}, capture ${capture?.id} ${capture?.status} ${capture?.amount.value} ${capture?.amount.currency_code}`);
      expect(order.status).toBe("COMPLETED");
      expect(unit.payee.email_address?.toLowerCase()).toBe(sandboxPayeeFor(vendor.vendorRole).toLowerCase());
      expect(unit.payee.email_address?.toLowerCase()).not.toBe(sandboxSellerEmail().toLowerCase());
      expect(capture).toMatchObject({ status: "COMPLETED", amount: { value: (vendor.depositCents / 100).toFixed(2), currency_code: "USD" } });
    }
  }
});
