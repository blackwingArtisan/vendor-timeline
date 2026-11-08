/**
 * Save PayPal (Vault v3 through Orders v2): the couple tick "Save my PayPal" on one approval and pay
 * in PayPal's checkout; PayPal saves their PayPal on success. The next payment is one approval and no
 * checkout window, charged server-side to the saved PayPal for exactly the confirmed term, and it is
 * Paid only once PayPal's capture and its webhook say so.
 * Mock PayPal only: in the sandbox, saving a PayPal needs a buyer login (PAYPAL_VAULT_SAVE=1 and a
 * sandbox buyer password), which this suite doesn't have.
 */
import { expect, test, type Page } from "@playwright/test";
import { formatCents } from "../../src/lib/wedding/cents";
import { FLORIST, PHOTOGRAPHER } from "../../src/lib/wedding/samples";

const row = (page: Page, role: string, kind: string) => page.locator(`[data-testid="timeline-item"][data-role="${role}"][data-kind="${kind}"]`);

test("save PayPal on one checkout, then pay the next with one approval and no checkout window", async ({ page }) => {
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
  const status = await (await page.request.get("/api/kit/status")).json();
  test.skip(status.paypal.mode !== "mock", "Saving a PayPal in the sandbox needs a buyer login.");

  // First: the florist deposit, in PayPal's checkout, asking PayPal to save the PayPal.
  const florist = row(page, "florist", "deposit");
  await florist.getByTestId("pay-item").click();
  const first = florist.getByTestId("approval-prompt");
  await expect(first.getByTestId("approval-from")).toHaveText("Your PayPal, in PayPal's checkout");
  await first.getByTestId("save-paypal").check();
  await first.getByTestId("approve-button").click();
  await expect(page.getByTestId("mock-order-id")).toHaveText(/\S/, { timeout: 60_000 });
  await page.getByTestId("mock-approve").click();
  await expect(florist.getByTestId("item-status")).toHaveText("Paid", { timeout: 60_000 });
  const saved = (await (await page.request.get("/api/timeline")).json()).wallet;
  expect(saved.saved.email).toMatch(/@/);
  expect(saved.canSave).toBe(false);

  // Next: the photographer deposit. One approval, charged to the saved PayPal; no checkout opens.
  const photographer = row(page, "photographer", "deposit");
  await photographer.getByTestId("pay-item").click();
  const second = photographer.getByTestId("approval-prompt");
  await expect(second.getByTestId("approval-from")).toHaveText(`Your saved PayPal (${saved.saved.email}), no checkout window`);
  await expect(second.getByTestId("approve-button")).toHaveText("Approve and pay with saved PayPal");
  await expect(second).toContainText(formatCents(PHOTOGRAPHER.depositCents));
  const url = page.url();
  await second.getByTestId("approve-button").click();
  await expect(photographer.getByTestId("item-status")).toHaveText("Paid", { timeout: 60_000 });
  expect(page.url()).toBe(url);
  await expect(page.getByTestId("mock-order-id")).toHaveCount(0);
  await expect(photographer.getByTestId("paid-saved")).toContainText("saved PayPal");
  await expect(photographer.getByTestId("paid-by")).toContainText("Confirmed by PayPal webhook");
  await expect(page.getByTestId("stat-paid")).toContainText(formatCents(FLORIST.depositCents + PHOTOGRAPHER.depositCents));

  // PayPal's own record: the confirmed term, captured, on the saved PayPal.
  await photographer.getByTestId("receipt-open").click();
  const receipt = photographer.getByTestId("receipt");
  await expect(receipt.getByTestId("receipt-capture")).toContainText(`COMPLETED ${(PHOTOGRAPHER.depositCents / 100).toFixed(2)} USD`, { timeout: 30_000 });
  await page.screenshot({ path: "screenshots/save-paypal-mock.png", fullPage: true });
});
