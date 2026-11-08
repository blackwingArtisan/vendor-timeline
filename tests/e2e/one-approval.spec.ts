/**
 * One approval per payment: "Approve and pay" opens the checkout at once, with no second in-app
 * step. Closing the checkout leaves the payment ready to open again. Mock PayPal: the sandbox and
 * hosted runs of agent-flow and vendor-flow cover the same step on PayPal's own page.
 */
import { expect, test } from "@playwright/test";
import { formatCents } from "../../src/lib/wedding/cents";
import { PHOTOGRAPHER } from "../../src/lib/wedding/samples";

test("approve and pay opens checkout at once, and a closed checkout can be opened again", async ({ page }) => {
  const { paypal } = await (await page.request.get("/api/kit/status")).json();
  test.skip(paypal.mode !== "mock", "PayPal's own page is covered by agent-flow and vendor-flow.");
  await page.clock.setFixedTime(new Date("2026-11-20T12:00:00"));
  await page.goto("/timeline");
  const deposit = page.locator(`[data-testid="timeline-item"][data-role="${PHOTOGRAPHER.vendorRole}"][data-kind="deposit"]`);
  await deposit.getByTestId("pay-item").click();
  const prompt = deposit.getByTestId("approval-prompt");
  await expect(prompt.getByTestId("approve-button")).toHaveText("Approve and pay");
  await prompt.getByTestId("approve-button").click();

  // The checkout is already open: there is nothing else to approve in the app.
  await expect(page.getByTestId("mock-order-id")).toBeVisible();
  await expect(page.getByTestId("approval-prompt")).toHaveCount(0);
  await page.getByRole("button", { name: "Cancel" }).click();

  await expect(deposit.getByTestId("item-status")).toHaveText("Approved: pay in PayPal");
  const box = deposit.getByTestId("checkout-box");
  await expect(box).toContainText(`Pay ${formatCents(PHOTOGRAPHER.depositCents)} to ${PHOTOGRAPHER.vendorName} in PayPal's checkout`);
  await box.getByTestId("simulate-paypal-approval").click();
  await page.getByTestId("mock-approve").click();
  await expect(deposit.getByTestId("item-status")).toHaveText("Paid", { timeout: 60_000 });
  await expect(page.getByTestId("stat-paid")).toContainText(formatCents(PHOTOGRAPHER.depositCents));
});
