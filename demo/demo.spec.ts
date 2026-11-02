/**
 * DEMO VIDEO (npm run demo:record). Tells the app's story in a real browser and saves a .webm to
 * videos/. Keep it under about 2:50. Dates are pinned so the florist's deposit reads as overdue.
 */
import { expect, test } from "@playwright/test";
import { caption, DemoClock, highlight, titleCard } from "./captions";
import { formatCents, sumCents } from "../src/lib/wedding/cents";
import { BAND, CATERER, FLORIST, PHOTOGRAPHER, SAMPLES, VENUE, type SampleFacts } from "../src/lib/wedding/samples";

const TODAY = "2026-11-20";
const BAND_BALANCE_DUE = "2027-06-05";

test("demo", async ({ page }) => {
  const clock = new DemoClock(170);
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));

  // Scene 1: the pitch
  await page.goto("/");
  await titleCard(page, "Wedding Vendor Timeline", "Every vendor payment on one timeline");
  await caption(page, "Every wedding vendor hides its deadlines in a different contract. Miss one and you can lose the vendor.");
  clock.check("pitch");

  async function addSample(sample: SampleFacts) {
    await page.goto("/contracts");
    await page.getByTestId(`sample-${sample.vendorRole}`).click();
    await expect(page.getByTestId("contract-text")).toHaveValue(/\S/);
    await page.getByTestId("read-contract").click();
    await page.waitForURL(/\/contracts\/ctr_/, { timeout: 90_000 });
  }

  // Scene 2: one contract in, terms beside their sentences
  await addSample(PHOTOGRAPHER);
  await expect(page.getByTestId("confirm-terms")).toBeEnabled();
  await caption(page, "AI reads the payment terms. Each amount and date sits beside the sentence it came from.");
  await highlight(page, page.getByTestId("balance-value"));
  await caption(page, "The balance is worked out in code from the numbers you confirm. The AI never does the maths.");
  await page.getByTestId("confirm-terms").click();
  await page.waitForURL(/\/timeline/);
  clock.check("first contract");

  // Scene 3: the rest of the vendors, including a contract with a wrong sum
  for (const sample of [CATERER, VENUE, FLORIST]) {
    await addSample(sample);
    if (sample === CATERER) {
      await highlight(page, page.getByTestId("flag-balance"));
      await caption(page, "This contract's balance doesn't add up, so it gets flagged instead of copied.");
    }
    await page.getByTestId("confirm-terms").click();
    await page.waitForURL(/\/timeline/);
  }
  await addSample(BAND);
  await caption(page, "The band's contract gives no email and no clear date. Nothing is guessed, so you fill them in.");
  await page.getByLabel("PayPal email to pay").fill("bookings@velvet-almanacs.example.com");
  await page.getByLabel("Balance due").fill(BAND_BALANCE_DUE);
  await page.getByTestId("confirm-terms").click();
  await page.waitForURL(/\/timeline/);
  clock.check("all contracts");

  // Scene 4: the timeline
  const total = sumCents(SAMPLES.flatMap((s) => [s.depositCents, s.balanceCents]));
  await expect(page.getByTestId("stat-total")).toContainText(formatCents(total));
  await caption(page, `Five contracts, one timeline, ${formatCents(total)} in total. One deposit is already overdue, and the next is the photographer's.`);
  clock.check("timeline");

  // Scene 5: pay the photographer, after a person approves
  const deposit = page.locator(`[data-testid="timeline-item"][data-role="photographer"][data-kind="deposit"]`);
  await highlight(page, deposit.getByTestId("pay-item"));
  await deposit.getByTestId("pay-item").click();
  const prompt = deposit.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await caption(page, "Nothing moves until a person approves.");
  await highlight(page, prompt.getByTestId("approve-button"));
  await prompt.getByTestId("approve-button").click();
  await expect(deposit.getByTestId("item-status")).toHaveText("Paid", { timeout: 150_000 });
  await caption(page, "Paid, using the status re-read from PayPal, with the PayPal ids right there.");
  clock.check("paid");

  // Scene 6: proof
  await page.goto("/activity");
  await caption(page, "Every decision and PayPal call is in a tamper-evident audit log.");
  await titleCard(page, "Wedding Vendor Timeline", "Built with PayPal Payouts, webhooks and Claude", 2800);
  clock.check("end");
});
