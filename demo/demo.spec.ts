/**
 * DEMO VIDEO (npm run demo:record). Tells the app's story in a real browser and saves a .webm to
 * videos/. Keep it under about 2:50. Dates are pinned so the florist's deposit reads as overdue.
 */
import { expect, test } from "@playwright/test";
import { caption, DemoClock, highlight, titleCard } from "./captions";
import { formatCents, sumCents } from "../src/lib/wedding/cents";
import { BAND, CATERER, FLORIST, SAMPLES, VENUE, type SampleFacts } from "../src/lib/wedding/samples";

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

  async function openContracts() {
    await page.goto("/contracts");
    await expect(page.getByTestId("contracts-loaded")).toBeAttached();
  }

  async function readContract() {
    await expect(page.getByTestId("contract-text")).toHaveValue(/\S/, { timeout: 30_000 });
    await page.getByTestId("read-contract").click();
    await page.waitForURL(/\/contracts\/ctr_/, { timeout: 90_000 });
  }

  async function addSample(sample: SampleFacts) {
    await openContracts();
    await page.getByTestId(`sample-${sample.vendorRole}`).click();
    await readContract();
  }

  // Scene 2: one contract in, as a PDF, with terms beside their sentences
  await openContracts();
  await highlight(page, page.getByTestId("sample-pdf"));
  await page.getByTestId("sample-pdf").click();
  await caption(page, "Add a contract as a PDF, a text file, or pasted words.");
  await readContract();
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

  // Scene 5: the cash check, with the sums on show
  const clash = page.locator('[data-testid="cash-warning"][data-kind="same_week"]');
  await highlight(page, clash);
  await clash.getByText("Show the sums").click();
  await caption(page, "Each payment counts on the day it leaves. Code does the sums, and you can follow them.");
  clock.check("cash");

  // Scene 6: the agent stops, and a person decides
  await page.getByTestId("agent-panel").scrollIntoViewIfNeeded();
  await page.getByTestId("ask-agent").click();
  const panel = page.getByTestId("agent-panel");
  const prompt = panel.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 90_000 });
  await expect(page.getByTestId("agent-phase")).toHaveText("Stopped for your approval");
  await page.screenshot({ path: "docs/screenshot.png" });
  await caption(page, "The agent names what's due, warns about the clash, sets up the payment and stops.");
  // Up to the top of the screen, clear of the captions.
  await prompt.evaluate((card) => window.scrollBy({ top: card.getBoundingClientRect().top - 24, behavior: "smooth" }));
  await page.waitForTimeout(900);
  await highlight(page, prompt.getByTestId("approval-from"));
  await caption(page, "It's your money, so nothing leaves your PayPal balance until you approve. The card shows what it does to your month.");
  await highlight(page, prompt.getByTestId("approve-button"));
  await prompt.getByTestId("approve-button").click();
  const deposit = page.locator(`[data-testid="timeline-item"][data-role="photographer"][data-kind="deposit"]`);
  await expect(deposit.getByTestId("item-status")).toHaveText("Paid", { timeout: 150_000 });
  await deposit.scrollIntoViewIfNeeded();
  const confirmedBy = await deposit.getByTestId("paid-by").innerText();
  await caption(page, `Paid. ${confirmedBy.includes("webhook") ? "A PayPal webhook confirmed it" : "PayPal's own status confirmed it"}, with the PayPal ids right there.`);
  clock.check("paid");

  // Scene 7: proof
  await page.goto("/activity");
  await caption(page, "Every decision and PayPal call is in a tamper-evident audit log.");
  await titleCard(page, "Wedding Vendor Timeline", "Built with PayPal Payouts, webhooks and Claude", 2800);
  clock.check("end");
});
