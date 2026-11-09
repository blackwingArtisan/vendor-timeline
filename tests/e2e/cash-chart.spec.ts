/**
 * The cash chart answers to every move. A date moved from the payment table shifts its money from
 * one month's bar to another's, the over-budget mark follows the money, and a line says what just
 * changed. Every figure is the cash check's own. Runs on mock PayPal, the sandbox and the hosted
 * copy, with no AI and no payment.
 */
import { expect, test, type Page } from "@playwright/test";
import { openCashCheck } from "./open-cash";
import { CATERER } from "../../src/lib/wedding/samples";

const TODAY = "2026-11-20";
const month = (page: Page, m: string) => page.locator(`[data-testid="cash-chart-month"][data-month="${m}"]`);

test("moving a date moves its bar, and the over-budget mark follows the money", async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
  await openCashCheck(page);
  await page.getByTestId("monthly-budget").fill("6,000");
  await page.getByTestId("save-budget").click();

  const [may, june] = [month(page, "2027-05"), month(page, "2027-06")];
  await expect(may).toHaveAttribute("data-over", "true");
  await expect(may.getByTestId("cash-chart-over")).toHaveText("+$9,800");
  await expect(june).toHaveAttribute("data-over", "false");
  await expect(page.getByTestId("cash-chart-summary")).toHaveText("Over budget: May 2027 by $9,800.00.");

  // The caterer's balance moves to June 1, from the table's own "Change date".
  const balance = page.locator('[data-testid="timeline-item"][data-role="caterer"][data-kind="balance"]');
  await balance.getByTestId("move-date").click();
  await balance.getByTestId("move-date-input").fill("2027-06-01");
  await balance.getByTestId("move-date-save").click();
  await expect(balance.getByTestId("item-due")).toHaveText("Tue, Jun 1, 2027");

  await expect(may).toHaveAttribute("data-total-cents", String(1_580_000 - CATERER.balanceCents));
  await expect(may).toHaveAttribute("data-over", "false");
  await expect(june).toHaveAttribute("data-total-cents", String(240_000 + CATERER.balanceCents));
  await expect(june).toHaveAttribute("data-over", "true");
  await expect(june.getByTestId("cash-chart-over")).toHaveText("+$6,860");
  await expect(page.getByTestId("cash-chart-change")).toHaveText("Just changed: May 2027 $15,800.00 → $5,340.00, June 2027 $2,400.00 → $12,860.00.");
  await expect(page.getByTestId("cash-chart-summary")).toHaveText("Over budget: June 2027 by $6,860.00.");
  await page.getByTestId("cash-card").screenshot({ path: "screenshots/cash-chart-moved.png" });

  // The chart is the server's cash check, so it holds after a reload.
  await page.reload();
  await expect(month(page, "2027-06")).toHaveAttribute("data-over", "true");
  await expect(month(page, "2027-05")).toHaveAttribute("data-over", "false");
});
