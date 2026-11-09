/**
 * A sample contract's page says honestly how it was read: ahead of time, not on this visit, and how
 * to see a live read. No "mock" or "simulated" anywhere on it, so the hosted take's guard passes.
 * Runs on mock PayPal, the sandbox and the hosted copy with live AI.
 */
import { expect, test } from "@playwright/test";
import { PHOTOGRAPHER } from "../../src/lib/wedding/samples";

const MOCK_TEXT = /\bmock\b|simulated/i;

test("a sample contract says it was read ahead of time, and how to see a live read", async ({ page }) => {
  await page.goto("/contracts");
  await expect(page.getByTestId("sample-plan")).toContainText("Sample plan");
  await page.getByTestId("contract-list").getByRole("link", { name: new RegExp(PHOTOGRAPHER.vendorName) }).click();
  await page.waitForURL(/\/contracts\/ctr_/);

  await expect(page.getByTestId("read-by")).toHaveText("Read ahead of time");
  await expect(page.getByTestId("read-note")).toContainText("This fictional sample was read ahead of time, not on this visit.");
  const live = page.getByTestId("read-live-link");
  await expect(live).toHaveText("To see a live read, add a contract: paste its text or upload a PDF.");
  await expect(page.locator("main")).not.toContainText(MOCK_TEXT);
  // Hosted, the mode badges say "PayPal sandbox" and the model too, so the whole page is clean.
  if (process.env.E2E_BASE_URL) expect(await page.evaluate(() => document.body.innerText)).not.toMatch(MOCK_TEXT);

  await live.click();
  await page.waitForURL(/\/contracts$/);
  await expect(page.getByTestId("upload-contract")).toBeAttached();
  await expect(page.getByTestId("contract-text")).toBeVisible();
});
