/**
 * The agent panel leads with the model's own sentence, under the model's name, then code's "Pay
 * first" line, labelled as the app's own check. With live AI the label is Claude's model; if the
 * model wrote nothing, nothing stands in for it. Runs on mock PayPal, the sandbox and the hosted copy.
 */
import { expect, test } from "@playwright/test";
import { formatCents } from "../../src/lib/wedding/cents";
import { FLORIST, SAMPLES } from "../../src/lib/wedding/samples";

const TODAY = "2026-11-20";

test("the model's sentence leads under its name, and Pay first is labelled as code's check", async ({ page }) => {
  const status = await (await page.request.get("/api/kit/status")).json();
  const live = status.ai.mode === "live";
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(SAMPLES.length * 2);
  await page.getByTestId("ask-agent").click();
  const panel = page.getByTestId("agent-panel");
  await expect(panel.getByTestId("approval-prompt")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("agent-phase")).not.toHaveText("Working", { timeout: 90_000 });

  const payFirst = panel.locator('[data-testid="agent-message"][data-from="app"]').first();
  await expect(payFirst).toContainText(`Pay first: the ${FLORIST.vendorName} deposit, ${formatCents(FLORIST.depositCents)}`);
  await expect(panel.getByTestId("pay-first-by").first()).toHaveText("Checked by code");

  const reply = panel.getByTestId("agent-reply");
  if (!(await reply.count())) {
    // The model wrote nothing: no label, no stand-in words.
    expect(live, "the scripted agent always says something").toBe(true);
    await expect(panel.getByTestId("agent-reply-by")).toHaveCount(0);
    return;
  }
  const by = panel.getByTestId("agent-reply-by");
  if (live) await expect(by).toHaveText(new RegExp(`^${status.ai.models.default}$`));
  else await expect(by).toHaveText("Scripted agent, AI off");
  await expect(by).not.toHaveText(/simulated|mock/i);
  await expect(panel.getByTestId("agent-reply-line")).toBeVisible();
  expect((await reply.innerText()).trim().length).toBeGreaterThan(10);
  // Claude's words come first, above code's check, and both show without opening Details.
  expect((await reply.boundingBox())!.y).toBeLessThan((await payFirst.boundingBox())!.y);
  await expect(panel.getByTestId("agent-details")).not.toHaveAttribute("open");
});
