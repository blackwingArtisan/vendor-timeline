/**
 * When the agent can't read the vendor's reply (its run failed, stalled, or the server lost it in
 * a restart), the couple's card says so plainly and offers a retry that works. It never sits on
 * "Agent reading" with no message. Here the first read starts a run the server doesn't have, which
 * is what a restart mid-read leaves behind; the retry is a real read.
 */
import { devices, expect, test } from "@playwright/test";

const TODAY = "2026-11-20";

test("a reply the agent couldn't read shows the failure and a retry that works", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
  await page.getByTestId("ask-agent").click();
  const ask = page.locator('[data-testid="cash-move"][data-item="florist.balance"]');
  await expect(ask).toBeVisible({ timeout: 90_000 });
  await ask.getByTestId("move-share").click();
  const link = await ask.getByTestId("move-link").inputValue();

  // The florist answers on their phone.
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["iPhone 13"];
  const phone = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
  const vendor = await phone.newPage();
  await vendor.goto(link);
  await vendor.getByTestId("vendor-answer-other").click();
  await vendor.getByTestId("vendor-text").fill("The 5th is tight, the 8th is fine");
  await vendor.getByTestId("vendor-send").click();
  await expect(vendor.getByTestId("vendor-sent")).toBeVisible();
  await phone.close();
  await expect(ask.getByTestId("vendor-reply-text")).toBeVisible({ timeout: 15_000 });

  // The first read starts a run the server then doesn't know.
  await page.route("**/api/contracts/*/ask/read", (route) => route.fulfill({ json: { runId: "run_lostinrestart" } }), { times: 1 });
  await ask.getByTestId("move-read").click();
  await expect(ask.getByTestId("move-read-failed")).toHaveText("Couldn't read the reply. Try again.", { timeout: 15_000 });
  await expect(ask.getByTestId("ask-stage")).toHaveText("Couldn't read");
  await expect(ask.getByTestId("move-read")).toHaveCount(0);
  await page.screenshot({ path: "screenshots/read-retry-failed.png" });

  // Try again: a real read, and the move waits for the couple as usual.
  await ask.getByTestId("move-read-retry").click();
  const prompt = ask.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 90_000 });
  await expect(prompt).toContainText("to Tue, Jun 8, 2027");
  await expect(ask.getByTestId("move-read-failed")).toHaveCount(0);
  await context.close();
});
