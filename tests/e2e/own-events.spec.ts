/**
 * Every entry shares one PayPal sandbox app, and PayPal sends each entry every other entry's
 * webhooks. This proves another app's sale on that same account never reaches this couple's
 * timeline, ledger or activity. On mock PayPal the kit's demo shop plays the other app. On the
 * sandbox the test itself makes a real $48.50 card sale with the same credentials, as another
 * entry would; against the hosted copy (E2E_BASE_URL) PayPal really sends its webhook there.
 */
import { expect, test } from "@playwright/test";
import { otherAppsSale, readCaptureEvent } from "./paypal-reread";

const TODAY = "2026-11-20";
const HOSTED = !!process.env.E2E_BASE_URL;

test("another app's sale on the same PayPal account never shows here", async ({ page }) => {
  test.setTimeout(300_000);
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/timeline");
  // A new visitor starts on the labelled sample plan, already confirmed.
  await expect(page.getByTestId("sample-plan")).toContainText("Sample plan");
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
  const { paypal } = await (await page.request.get("/api/kit/status")).json();

  let theirs: { orderId: string; captureId: string };
  if (paypal.mode === "mock") {
    // The kit's demo shop: a $48.50 coffee order and others, captured on the same mock PayPal, with their webhooks.
    const seeded = await (await page.request.post("/api/dev/seed")).json();
    expect(seeded.created.captures).toBeGreaterThan(0);
    const { events } = await (await page.request.get("/api/dev/webhooks")).json();
    expect(events.some((e: { event_type: string }) => e.event_type === "PAYMENT.CAPTURE.COMPLETED")).toBe(true);
    theirs = { orderId: "", captureId: "" };
  } else {
    theirs = await otherAppsSale("48.50");
    console.log(`Other app's sale: order ${theirs.orderId}, capture ${theirs.captureId}`);
    if (HOSTED) {
      // PayPal's own record that it sent the webhook, so the app below really had the chance to show it.
      const event = await readCaptureEvent(theirs.captureId);
      console.log(`PayPal sent ${event?.event_type} ${event?.id} for it`);
      expect(event).toBeTruthy();
      await page.waitForTimeout(10_000);
    }
  }

  const panel = page.getByTestId("activity-panel");
  await expect(panel).not.toContainText("PAYMENT.CAPTURE.COMPLETED");
  await expect(panel).not.toContainText("$48.50");
  if (theirs.captureId) await expect(panel).not.toContainText(theirs.captureId);

  // The couple's ledger holds only their own payments, and they have paid nothing yet.
  const { entries } = await (await page.request.get("/api/paypal/ledger")).json();
  expect(entries).toEqual([]);

  await page.reload();
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
  await expect(page.getByTestId("activity-panel")).not.toContainText("$48.50");

  await page.goto("/activity");
  // Nothing paid here: the webhooks card is empty, or the page says nothing has happened on this plan.
  await expect(page.getByText("No webhooks for your payments yet").or(page.getByTestId("activity-empty"))).toBeVisible();
  await expect(page.getByTestId("webhook-row")).toHaveCount(0);
  await expect(page.locator("main")).not.toContainText("48.50");
});
