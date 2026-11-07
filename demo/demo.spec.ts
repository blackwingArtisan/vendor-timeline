/**
 * DEMO VIDEO (npm run demo:record). Tells the app's story in a real browser and saves a .webm to
 * videos/. Keep it under about 2:50. Dates are pinned so the florist's deposit reads as overdue.
 * On the sandbox (DEMO_PAYPAL_MODE=sandbox) the couple pay on PayPal's own checkout page, in the
 * same tab, so it's on camera.
 */
import { expect, test } from "@playwright/test";
import { caption, DemoClock, highlight, titleCard } from "./captions";
import { payInCheckout } from "../tests/e2e/pay-in-checkout";
import { formatCents } from "../src/lib/wedding/cents";
import { CATERER, FLORIST, PHOTOGRAPHER, type SampleFacts } from "../src/lib/wedding/samples";

const TODAY = "2026-11-20";

test("demo", async ({ page }) => {
  const clock = new DemoClock(170);
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  const status = await (await page.request.get("/api/kit/status")).json();
  const sandbox = status.paypal.mode === "sandbox";

  // Scene 1: the pitch
  await page.goto("/");
  await titleCard(page, "Wedding Vendor Timeline", "Every vendor payment on one timeline, paid from your own PayPal", 2800);
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
    await expect(page.getByTestId("confirm-terms")).toBeEnabled();
  }

  async function confirm() {
    await page.getByTestId("confirm-terms").click();
    await page.waitForURL(/\/timeline/);
  }

  async function upload(sample: SampleFacts, file = sample.file) {
    await openContracts();
    await expect(async () => {
      await page.getByTestId("upload-contract").setInputFiles(`public/sample-contracts/${file}`);
      await expect(page.getByTestId("contract-text")).toHaveValue(/\S{20}/, { timeout: 4_000 });
    }).toPass({ timeout: 30_000 });
  }

  // Scene 2: a PDF contract in, read by Claude, terms beside their sentences
  await upload(PHOTOGRAPHER, "photographer.pdf");
  await caption(page, "Upload a vendor's contract as a PDF.", { ms: 2200 });
  await readContract();
  await highlight(page, page.getByTestId("source-deposit"), 2200);
  await caption(page, "Claude reads the payment terms. Each amount and date sits beside the sentence it came from.");
  await confirm();
  clock.check("first contract");

  // Scene 3: a contract whose sums are wrong
  await upload(CATERER);
  await readContract();
  await page.getByTestId("flag-balance").scrollIntoViewIfNeeded();
  await highlight(page, page.getByTestId("flag-balance"), 2200);
  await caption(page, "This contract's balance doesn't add up, so it's flagged. Code works out the real balance.");
  await confirm();
  await openContracts();
  await page.getByTestId(`sample-${FLORIST.vendorRole}`).click();
  await readContract();
  await confirm();
  clock.check("contracts");

  // Scene 4: the timeline and the agent, urgent first
  await expect(page.getByTestId("stat-overdue")).toContainText(formatCents(FLORIST.depositCents));
  await caption(page, `One timeline. The florist's ${formatCents(FLORIST.depositCents)} deposit is already overdue.`, { ms: 2800 });
  await page.getByTestId("agent-panel").scrollIntoViewIfNeeded();
  await page.getByTestId("ask-agent").click();
  const panel = page.getByTestId("agent-panel");
  const prompt = panel.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 90_000 });
  await page.screenshot({ path: "docs/screenshot.png" });
  await highlight(page, panel.getByTestId("agent-messages"), 2000);
  await caption(page, "The agent puts the overdue florist deposit first, explains the cash clash, sets up the payment and stops.");
  await prompt.evaluate((card) => window.scrollBy({ top: card.getBoundingClientRect().top - 24, behavior: "smooth" }));
  await page.waitForTimeout(700);
  await highlight(page, prompt.getByTestId("approve-button"));
  await caption(page, "Nothing moves without you. Approve it, then pay it yourself with PayPal.", { ms: 2600 });
  await prompt.getByTestId("approve-button").click();
  clock.check("approval");

  // Scene 5: the couple pay in PayPal's own checkout
  const box = panel.getByTestId("checkout-box");
  await expect(box).toBeVisible({ timeout: 60_000 });
  await highlight(page, box, 2000);
  await caption(page, sandbox ? "PayPal's own checkout, for exactly the confirmed amount. In the sandbox a test business account stands in for the florist." : "PayPal's checkout, for exactly the confirmed amount.", { ms: 3200 });
  await payInCheckout(page, box, sandbox, {
    typingDelay: 25,
    beforePay: async () => {
      await caption(page, "The couple pay as a guest with PayPal's test card.", { ms: 2200 });
    },
  });
  clock.check("checkout");

  // Scene 6: paid, from PayPal's own record of the capture
  const deposit = page.locator(`[data-testid="timeline-item"][data-role="florist"][data-kind="deposit"]`);
  await expect(deposit.getByTestId("item-status")).toHaveText("Paid", { timeout: 150_000 });
  await deposit.scrollIntoViewIfNeeded();
  await highlight(page, deposit.getByTestId("paypal-proof"), 2600);
  const confirmedBy = await deposit.getByTestId("paid-by").innerText();
  await caption(page, `Paid. PayPal's capture reads COMPLETED${confirmedBy.startsWith("Confirmed by PayPal webhook") ? ", and PayPal's webhook for it arrived" : ", read back from PayPal's API"}. The capture id is right there.`);
  clock.check("paid");

  await titleCard(page, "Wedding Vendor Timeline", "PayPal Orders checkout, capture re-reads, webhooks and Claude", 2600);
  clock.check("end");
  const after = await (await page.request.get("/api/kit/status")).json();
  console.log(`[demo] PayPal ${after.paypal.mode}, AI ${after.ai.mode}, AI spend today: ${JSON.stringify(after.ai.budget)}`);
  console.log(`[demo] Paid: ${await deposit.getByTestId("paypal-proof").innerText()}`);
});
