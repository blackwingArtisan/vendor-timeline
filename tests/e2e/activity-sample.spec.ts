/**
 * /activity on a fresh sample plan says plainly that nothing has been asked for or paid on it yet,
 * labelled as the sample, with a way to the timeline, instead of two empty cards. Once the agent
 * asks for a payment, the plan's own log shows there. Runs on mock PayPal, the sandbox and the
 * hosted copy with live AI.
 */
import { expect, test } from "@playwright/test";
import { SAMPLES } from "../../src/lib/wedding/samples";

test("a fresh sample plan's Activity is one labelled card with a way to the timeline", async ({ page }) => {
  await page.goto("/activity");
  const empty = page.getByTestId("activity-empty");
  await expect(empty).toBeVisible();
  await expect(empty.getByTestId("activity-sample")).toHaveText("Sample plan");
  await expect(empty).toContainText("Nothing asked for or paid on this plan yet");
  await expect(page.getByText("Nothing yet", { exact: true })).toHaveCount(0);
  await expect(page.getByText("No webhooks for your payments yet")).toHaveCount(0);

  await empty.getByTestId("activity-to-timeline").click();
  await page.waitForURL(/\/timeline$/);
  await expect(page.getByTestId("timeline-item")).toHaveCount(SAMPLES.length * 2);

  // The agent asks for a payment: that plan's own log takes the empty card's place.
  await page.getByTestId("ask-agent").click();
  await expect(page.getByTestId("agent-panel").getByTestId("approval-prompt")).toBeVisible({ timeout: 90_000 });
  await page.goto("/activity");
  await expect(page.getByTestId("audit-row").first()).toBeVisible();
  await expect(page.getByTestId("activity-empty")).toHaveCount(0);
  expect(await page.getByTestId("audit-action").allInnerTexts()).toContain("Waiting for your approval");
});
