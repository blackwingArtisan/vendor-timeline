/**
 * DEMO VIDEO (npm run demo:record). Tells the product's story in a real browser and saves a .webm
 * to videos/, with its edit list beside it (.cuts.json): the waits to cut (PayPal's page loading, the
 * webhook on its way) and every moment a spinner, skeleton or page load was on screen.
 * `npm run demo:mp4` applies the cuts, so the video has none of those frames and stays under 100 s.
 * PayPal's checkout is on camera for at most 8 s. No pinned clock: every date on
 * screen is the recording date.
 *
 *   Local check, mock AI and mock PayPal:  DEMO_PORT=3730 npm run demo:record
 *   On the hosted site, where PayPal's webhook lands on camera:
 *     DEMO_BASE_URL=https://vendor-timeline.onrender.com npm run demo:record
 *   Then the cut MP4 (newest recording and its .cuts.json): npm run demo:mp4
 */
import { expect, test, type Page } from "@playwright/test";
import { caption, DemoClock, highlight, mark, titleCard, watchMockText } from "./captions";
import { openCardForm, payAsGuest } from "../tests/e2e/pay-in-checkout";
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
  await clock.watchBusy(page);
  const live = await watchMockText(page);
  // The captions follow what the app really runs: they name Claude and PayPal only when it's them.
  const status = await (await page.request.get("/api/kit/status")).json();
  const sandbox = status.paypal.mode === "sandbox";
  const aiLive = status.ai.mode === "live";
  console.log(`[demo] PayPal ${status.paypal.mode}, AI ${status.ai.mode}${live.requireLive ? ", DEMO_REQUIRE_LIVE=1" : ""}`);
  const check = async (label: string) => {
    clock.check(label);
    await live.check(label);
  };

  // Scene 1: the case, from research, and the sample wedding's real cash warning.
  await page.goto("/");
  clock.sync();
  await titleCard(page, "13 vendors. 13 payment dates. One timeline.", "Wedding Vendor Timeline, paid through PayPal", 3800);
  await highlight(page, page.getByTestId("landing-headline-figure"), 1800);
  await caption(page, "About 13 vendors per couple (The Knot 2026), each with its own contract and payment dates.", { ms: 3400 });
  await highlight(page, page.getByTestId("landing-cash-warning"), 1800);
  await caption(page, "The app's code finds where the money piles up: May 2027 needs $15,800 on a $5,000 monthly budget.", { ms: 3400 });
  await check("pitch");

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
  // The review screen holds for about 7 s, with the contract's own sentence lit up.
  const source = page.getByTestId("source-deposit");
  await mark(source, 7000);
  await highlight(page, source, 7000);
  await caption(page, aiLive ? "Claude reads the payment terms. Each amount and date sits beside the sentence it came from." : "The payment terms, each amount and date beside the sentence it came from.", { ms: 3600 });
  await caption(page, "Nothing reaches the timeline until you confirm it.", { ms: 2500 });
  await page.getByTestId("confirm-terms").click();
  await page.waitForURL(/\/timeline/);
  await check("pdf");

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
  // The mismatch flag gets 4 s.
  await highlight(page, flag, 4000);
  await caption(page, `The contract says the balance is ${formatCents(CATERER_STATED_BALANCE_CENTS)}. Its own total minus deposit is ${formatCents(CATERER.balanceCents)}, so code flags it.`, { ms: 3100 });
  await page.getByTestId("confirm-terms").click();
  await page.waitForURL(/\/timeline/);

  // The other three are the labelled samples, already read the same way.
  await page.request.post("/api/contracts/samples");
  await page.reload();
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
  await caption(page, `With the other three, one timeline for all five. The florist's ${formatCents(FLORIST.depositCents)} deposit is already overdue.`, { ms: 3000 });
  await check("contracts");

  // Scene 4: the agent is asked for more than the contract says, and the Guard refuses it in code.
  const panel = page.getByTestId("agent-panel");
  await scrollTo(page, panel);
  const goal = page.getByTestId("agent-goal");
  const realAsk = await goal.inputValue();
  await goal.fill("Pay the caterer $5,000.");
  await page.getByTestId("ask-agent").click();
  const refusal = panel.getByTestId("guard-refusal");
  await clock.cut("agent", () => expect(refusal).toBeVisible({ timeout: 90_000 }), 1000);
  await highlight(page, refusal, 2400);
  await caption(page, "Asked to pay the caterer $5,000, the Guard checks the signed contract in code and refuses. Nothing is sent.", { ms: 4200 });
  await check("guard");

  // Scene 5: the real ask. Urgent first, with code's cash plan.
  await goal.fill(realAsk);
  await page.getByTestId("ask-agent").click();
  const prompt = panel.getByTestId("approval-prompt").first();
  await clock.cut("agent", () => expect(prompt).toBeVisible({ timeout: 90_000 }), 1500);
  await page.screenshot({ path: "docs/screenshot.png" });
  await highlight(page, panel.getByTestId("agent-messages"), 1800);
  await caption(page, "The agent puts the overdue deposit first, explains the cash clash and proposes a plan the contracts allow.", { ms: 3600 });
  await check("agent");

  // Scene 6: the cash plan resolves a clash on screen. A vendor agrees to a later date.
  const ask = page.locator('[data-testid="cash-move"][data-kind="ask_vendor"]').first();
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
  await check("cash plan");

  // Scene 7: one approval, then PayPal's checkout, at most 8 s of it on camera.
  await scrollTo(page, prompt);
  await highlight(page, prompt.getByTestId("approve-button"), 1200);
  await caption(page, "Nothing moves without you. One approval, then pay it yourself in PayPal.", { ms: 2400 });
  await prompt.getByTestId("approve-button").click();
  if (sandbox) {
    // PayPal's page loading and its spinners are cut; its checkout, with the amount, stays on screen briefly.
    const paypalFrom = clock.raw;
    // Straight to PayPal's card form, which shows the amount at the top.
    await clock.cut("PayPal page loading", async () => {
      await page.waitForURL(/sandbox\.paypal\.com/, { timeout: 60_000 });
      await openCardForm(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
    });
    await caption(page, `PayPal's own checkout, for exactly the confirmed ${formatCents(FLORIST.depositCents)} (sandbox).`, { ms: 3200 });
    await clock.cut("PayPal checkout", async () => {
      await payAsGuest(page, { typingDelay: 0 });
      await page.waitForURL(/\/timeline/, { timeout: 120_000 });
    });
    const shown = clock.onCamera(paypalFrom, clock.raw);
    console.log(`[demo] PayPal checkout on camera ${shown.toFixed(1)}s`);
    expect(shown).toBeLessThanOrEqual(CHECKOUT_ON_CAMERA_MS / 1000);
  } else {
    await expect(page.getByTestId("mock-order-id")).toHaveText(/\S/, { timeout: 60_000 });
    await caption(page, "Checkout, for exactly the confirmed amount.", { ms: 2200 });
    await page.getByTestId("mock-approve").click();
  }
  await check("checkout");

  // Scene 8: paid, from PayPal's own record and its webhook.
  const deposit = page.locator(`[data-testid="timeline-item"][data-role="florist"][data-kind="deposit"]`);
  await clock.cut("PayPal webhook on its way", () => expect(deposit.getByTestId("item-status")).toHaveText("Paid", { timeout: 200_000 }), 1500);
  await deposit.scrollIntoViewIfNeeded();
  await highlight(page, deposit.getByTestId("paypal-proof"), 2200);
  const confirmedBy = await deposit.getByTestId("paid-by").innerText();
  await caption(page, sandbox ? `Paid. PayPal's capture reads COMPLETED${confirmedBy.startsWith("Confirmed by PayPal webhook") ? ", and PayPal's webhook for it arrived" : ", read back from PayPal"}.` : "Paid. The capture reads COMPLETED.", { ms: 3000 });
  await deposit.getByTestId("receipt-open").click();
  const receipt = deposit.getByTestId("receipt");
  await expect(receipt.getByTestId("receipt-capture-id")).toHaveText(/\S/, { timeout: 30_000 });
  await receipt.scrollIntoViewIfNeeded();
  await highlight(page, receipt, 2000);
  await caption(page, sandbox ? "Its receipt, read back from PayPal: order, capture, webhook event and PayPal's debug_id." : "Its receipt: order, capture and webhook event.", { ms: 3000 });
  await check("paid");

  await titleCard(page, "How PayPal pays each vendor", "Create order → the couple approve in PayPal's checkout → capture → PAYMENT.CAPTURE.COMPLETED webhook", 3200, { stay: true });
  clock.end();
  await check("end");
  if (live.requireLive) {
    expect(status.ai.mode, "DEMO_REQUIRE_LIVE=1 needs real AI").toBe("live");
    expect(status.paypal.mode, "DEMO_REQUIRE_LIVE=1 needs PayPal's sandbox").toBe("sandbox");
  }
  const edit = clock.writeCuts("test-results/demo/cuts.json");
  const after = await (await page.request.get("/api/kit/status")).json();
  console.log(`[demo] PayPal ${after.paypal.mode}, AI ${after.ai.mode}, AI spend today: ${JSON.stringify(after.ai.budget)}`);
  console.log(`[demo] Paid: ${await deposit.getByTestId("paypal-proof").innerText()}`);
  console.log(`[demo] Cut video ${edit.videoSeconds.toFixed(1)}s, raw ${Math.round(clock.raw)}s. Cuts: ${JSON.stringify(edit.cuts.map((c) => `${c.label} ${c.from.toFixed(1)}-${c.to.toFixed(1)}`))}`);
  expect(edit.videoSeconds).toBeLessThanOrEqual(100);
});
