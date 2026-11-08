/**
 * DEMO VIDEO (npm run demo:record). Tells the product's story in a real browser and saves a .webm
 * to videos/. The cut video stays under 100 s: waits the edit removes (PayPal's page loading, the
 * webhook on its way) are printed as raw-recording times to cut. No pinned clock: every date on
 * screen is the recording date.
 *
 *   Local check, mock AI and mock PayPal:  DEMO_PORT=3730 npm run demo:record
 *   On the hosted site, where PayPal's webhook lands on camera:
 *     DEMO_BASE_URL=https://vendor-timeline.onrender.com npx playwright test -c playwright.demo.config.ts
 */
import { expect, test, type Page } from "@playwright/test";
import { caption, DemoClock, highlight, titleCard } from "./captions";
import { payAsGuest } from "../tests/e2e/pay-in-checkout";
import { formatCents } from "../src/lib/wedding/cents";
import { CATERER, CATERER_STATED_BALANCE_CENTS, FLORIST, SAMPLE_PDF } from "../src/lib/wedding/samples";

/** PayPal's checkout gets at most this long on camera. */
const CHECKOUT_ON_CAMERA_MS = 8_000;

const scrollTo = async (page: Page, target: ReturnType<Page["getByTestId"]>) => {
  await target.evaluate((el) => window.scrollBy({ top: el.getBoundingClientRect().top - 96, behavior: "smooth" }));
  await page.waitForTimeout(600);
};

test("demo", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const clock = new DemoClock(100);
  const status = await (await page.request.get("/api/kit/status")).json();
  const sandbox = status.paypal.mode === "sandbox";

  // Scene 1: the case, from research, and the sample wedding's real cash warning.
  await page.goto("/");
  await titleCard(page, "Wedding Vendor Timeline", "Every vendor payment on one timeline, paid through PayPal", 2200);
  await highlight(page, page.getByTestId("landing-headline-figure"), 1800);
  await caption(page, "About 13 vendors per couple (The Knot 2026), each with its own contract and payment dates.", { ms: 3400 });
  await highlight(page, page.getByTestId("landing-cash-warning"), 1800);
  await caption(page, "The app's code finds where the money piles up: May 2027 needs $15,800 on a $5,000 monthly budget.", { ms: 3400 });
  clock.check("pitch");

  // Scene 2: the couple's own plan. A real PDF upload, read by Claude, each term beside its sentence.
  await page.goto("/timeline");
  await page.getByTestId("start-own-plan").click();
  await page.waitForURL(/\/timeline$/);
  await expect(page.getByText("Nothing confirmed yet")).toBeVisible();
  await page.goto("/contracts");
  await expect(page.getByTestId("contracts-loaded")).toBeAttached();
  await expect(async () => {
    await page.getByTestId("upload-contract").setInputFiles(`public/sample-contracts/${SAMPLE_PDF}`);
    await expect(page.getByTestId("contract-text")).toHaveValue(/\S{20}/, { timeout: 4_000 });
  }).toPass({ timeout: 30_000 });
  await caption(page, "Upload the photographer's contract, a PDF.", { ms: 1800 });
  await page.getByTestId("read-contract").click();
  await clock.cut("contract read", () => page.waitForURL(/\/contracts\/ctr_/, { timeout: 90_000 }), 1500);
  await expect(page.getByTestId("confirm-terms")).toBeEnabled();
  await highlight(page, page.getByTestId("source-deposit"), 1800);
  await caption(page, "Claude reads the payment terms. Each amount and date sits beside the sentence it came from.", { ms: 3200 });
  await page.getByTestId("confirm-terms").click();
  await page.waitForURL(/\/timeline/);
  clock.check("pdf");

  // Scene 3: the caterer's contract gets its own sum wrong, and code catches it.
  await page.goto("/contracts");
  await expect(page.getByTestId("contracts-loaded")).toBeAttached();
  await page.getByTestId(`sample-${CATERER.vendorRole}`).click();
  await expect(page.getByTestId("contract-text")).toHaveValue(/\S{20}/, { timeout: 30_000 });
  await page.getByTestId("read-contract").click();
  await clock.cut("contract read", () => page.waitForURL(/\/contracts\/ctr_/, { timeout: 90_000 }), 1000);
  const flag = page.getByTestId("flag-balance");
  await expect(flag).toContainText(formatCents(CATERER_STATED_BALANCE_CENTS));
  await flag.scrollIntoViewIfNeeded();
  await highlight(page, flag, 2000);
  await caption(page, `The contract says the balance is ${formatCents(CATERER_STATED_BALANCE_CENTS)}. Its own total minus deposit is ${formatCents(CATERER.balanceCents)}, so code flags it.`, { ms: 3800 });
  await page.getByTestId("confirm-terms").click();
  await page.waitForURL(/\/timeline/);

  // The other three are the labelled samples, already read the same way.
  await page.request.post("/api/contracts/samples");
  await page.reload();
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
  await caption(page, `With the other three, one timeline for all five. The florist's ${formatCents(FLORIST.depositCents)} deposit is already overdue.`, { ms: 3000 });
  clock.check("contracts");

  // Scene 4: the agent, urgent first, with code's cash plan.
  const panel = page.getByTestId("agent-panel");
  await scrollTo(page, panel);
  await page.getByTestId("ask-agent").click();
  const prompt = panel.getByTestId("approval-prompt").first();
  await clock.cut("agent", () => expect(prompt).toBeVisible({ timeout: 90_000 }), 1500);
  await page.screenshot({ path: "docs/screenshot.png" });
  await highlight(page, panel.getByTestId("agent-messages"), 1800);
  await caption(page, "The agent puts the overdue deposit first, explains the cash clash and proposes a plan the contracts allow.", { ms: 3600 });
  clock.check("agent");

  // Scene 5: the cash plan resolves a clash on screen. A vendor agrees to a later date.
  const ask = panel.locator('[data-testid="cash-move"][data-kind="ask_vendor"]').first();
  await scrollTo(page, ask);
  await highlight(page, ask.getByTestId("move-message"), 1600);
  await caption(page, "Asking a vendor for a later date? The message is drafted by code. Copy it and send it.", { ms: 3000 });
  await ask.getByTestId("move-copy").click();
  const week = page.locator('[data-testid="cash-warning"][data-kind="same_week"]');
  const weekBefore = await week.count();
  await ask.getByTestId("move-approve").click();
  await expect(ask.getByTestId("move-done")).toBeVisible();
  await expect(week).toHaveCount(Math.max(0, weekBefore - 1));
  await scrollTo(page, page.getByTestId("cash-card"));
  await highlight(page, page.getByTestId("cash-card"), 1800);
  await caption(page, "The vendor agreed, so the date moves and that crowded week clears from the cash check.", { ms: 3000 });
  clock.check("cash plan");

  // Scene 6: one approval, then PayPal's checkout, at most 8 s of it on camera.
  await scrollTo(page, prompt);
  await highlight(page, prompt.getByTestId("approve-button"), 1200);
  await caption(page, "Nothing moves without you. One approval, then pay it yourself in PayPal.", { ms: 2400 });
  await prompt.getByTestId("approve-button").click();
  if (sandbox) {
    await clock.cut("PayPal page loading", () => page.waitForURL(/sandbox\.paypal\.com/, { timeout: 60_000 }));
    await caption(page, "PayPal's own checkout, for exactly the confirmed amount (sandbox).", { ms: 2500, wait: false });
    await clock.cut("PayPal checkout", async () => {
      await payAsGuest(page, { typingDelay: 0 });
      await page.waitForURL(/\/timeline/, { timeout: 120_000 });
    }, CHECKOUT_ON_CAMERA_MS);
  } else {
    await expect(page.getByTestId("mock-order-id")).toHaveText(/\S/, { timeout: 60_000 });
    await caption(page, "PayPal's checkout, for exactly the confirmed amount.", { ms: 2200 });
    await page.getByTestId("mock-approve").click();
  }
  clock.check("checkout");

  // Scene 7: paid, from PayPal's own record and its webhook.
  const deposit = page.locator(`[data-testid="timeline-item"][data-role="florist"][data-kind="deposit"]`);
  await clock.cut("PayPal webhook on its way", () => expect(deposit.getByTestId("item-status")).toHaveText("Paid", { timeout: 200_000 }), 1500);
  await deposit.scrollIntoViewIfNeeded();
  await highlight(page, deposit.getByTestId("paypal-proof"), 2200);
  const confirmedBy = await deposit.getByTestId("paid-by").innerText();
  await caption(page, `Paid. PayPal's capture reads COMPLETED${confirmedBy.startsWith("Confirmed by PayPal webhook") ? ", and PayPal's webhook for it arrived" : ", read back from PayPal"}.`, { ms: 3000 });
  clock.check("paid");

  await titleCard(page, "Wedding Vendor Timeline", "Claude reads the contracts. Code does the sums. You approve. PayPal pays.", 2600);
  clock.check("end");
  const after = await (await page.request.get("/api/kit/status")).json();
  console.log(`[demo] PayPal ${after.paypal.mode}, AI ${after.ai.mode}, AI spend today: ${JSON.stringify(after.ai.budget)}`);
  console.log(`[demo] Paid: ${await deposit.getByTestId("paypal-proof").innerText()}`);
  console.log(`[demo] Cut video ${clock.seconds}s, raw ${Math.round(clock.raw)}s. Cuts: ${JSON.stringify(clock.cuts.map((c) => `${c.label} ${c.from.toFixed(1)}-${c.to.toFixed(1)}`))}`);
});
