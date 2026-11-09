/**
 * What the agent read (review_payments) shows as cards under Details: vendor, amount, due date and
 * why, pay first leading. The figures are code's, so they match the contracts whatever the model
 * says. Runs on mock PayPal, the sandbox and the hosted copy with live AI.
 */
import { expect, test } from "@playwright/test";
import { formatCents } from "../../src/lib/wedding/cents";
import { formatDay } from "../../src/lib/wedding/dates";
import { FLORIST, PHOTOGRAPHER, SAMPLES } from "../../src/lib/wedding/samples";

/** Pinned so the florist's deposit is overdue and the photographer's comes next. */
const TODAY = "2026-11-20";
const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

test("the agent's review shows as cards: vendor, amount, due and why", async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(SAMPLES.length * 2);
  await page.getByTestId("ask-agent").click();
  const panel = page.getByTestId("agent-panel");
  await expect(panel.getByTestId("approval-prompt")).toBeVisible({ timeout: 90_000 });

  await panel.getByTestId("agent-details").locator("summary").click();
  const cards = panel.getByTestId("review-card");
  await expect(cards).toHaveCount(4);
  await expect(panel.getByTestId("review-cards-more")).toHaveText(`${SAMPLES.length * 2 - 4} more on the timeline below.`);

  const first = cards.first();
  await expect(first).toHaveAttribute("data-tag", "Pay first");
  await expect(first.getByTestId("review-card-vendor")).toHaveText(FLORIST.vendorName);
  await expect(first.getByTestId("review-card-kind")).toHaveText("deposit");
  await expect(first.getByTestId("review-card-amount")).toHaveText(formatCents(FLORIST.depositCents));
  await expect(first.getByTestId("review-card-due")).toHaveText(formatDay(FLORIST.depositDue));
  await expect(first.getByTestId("review-card-why")).toHaveText(`Most urgent: ${daysBetween(FLORIST.depositDue, TODAY)} days overdue`);

  const next = panel.locator('[data-testid="review-card"][data-tag="Due next"]');
  await expect(next.getByTestId("review-card-vendor")).toHaveText(PHOTOGRAPHER.vendorName);
  await expect(next.getByTestId("review-card-amount")).toHaveText(formatCents(PHOTOGRAPHER.depositCents));
  await expect(next.getByTestId("review-card-why")).toHaveText(`Next to come: due in ${daysBetween(TODAY, PHOTOGRAPHER.depositDue)} days`);
  await expect(panel.getByTestId("review-cards")).toBeVisible();
});
