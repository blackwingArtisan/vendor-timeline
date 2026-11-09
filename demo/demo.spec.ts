/**
 * DEMO VIDEO (npm run demo:record). Tells the product's story in a real browser and saves a .webm
 * to videos/, with its edit list beside it (.cuts.json): the waits to cut (PayPal's page loading, the
 * webhook on its way) and every moment a spinner, skeleton or page load was on screen.
 * `npm run demo:mp4` applies the cuts, so the video has none of those frames and stays under 2:30.
 * It opens on a contract's text. PayPal's checkout is on camera for 5 to 8 s, the Guard's refusal
 * for at least 5 s, the caterer's mismatch flag for at least 4 s, and a caption that would cover
 * what it describes moves to the top. No pinned clock: every date on screen is the recording date.
 *
 * The captions follow /api/kit/status: they name Claude or PayPal only when the app really uses
 * them. With DEMO_REQUIRE_LIVE=1 the take fails on any visible "mock" or "simulated" text, and
 * unless AI is live and PayPal is the sandbox; use it for the take that's shown.
 *
 *   Local check, mock AI and mock PayPal:  DEMO_PORT=3730 npm run demo:record
 *   On the hosted site, where PayPal's webhook lands on camera:
 *     DEMO_REQUIRE_LIVE=1 DEMO_BASE_URL=https://vendor-timeline.onrender.com npm run demo:record
 *   Then the cut MP4 (newest recording and its .cuts.json): npm run demo:mp4
 */
import { expect, test, type Page } from "@playwright/test";
import { expectRepeatsFolded, paypalCallsOnScreen } from "../tests/e2e/activity-calls";
import { caption, clearOverlays, closePhone, coveredCaptions, DemoClock, highlight, mark, phone, titleCard, watchMockText } from "./captions";
import { openCardForm, payAsGuest } from "../tests/e2e/pay-in-checkout";
import { sandboxVendorEmail } from "../tests/e2e/paypal-reread";
import { formatCents } from "../src/lib/wedding/cents";
import { CATERER, CATERER_STATED_BALANCE_CENTS, FLORIST, SAMPLE_PDF } from "../src/lib/wedding/samples";

/** The cut video stays under 2:30. */
const DEMO_LIMIT_SECONDS = 145;
/** The caterer's "the contract says X, but total minus deposit is Y" flag is on camera at least this long. */
const FLAG_ON_CAMERA_S = 4;

/** PayPal's checkout gets at most this long on camera. */
const CHECKOUT_ON_CAMERA_MS = 8_000;
/** The Guard's refusal and PayPal's checkout each hold at least this long in the cut, or the take fails. */
const HOLD_ON_CAMERA_S = 5;

/** The dollar amounts in a piece of on-screen text, cents dropped when they're zero: "$2,500". */
const dollars = (text: string) => [...text.matchAll(/\$\d[\d,]*(?:\.\d\d)?/g)].map((m) => m[0].replace(/\.00$/, ""));

/** Scrolls `target` to `offset` px below the top of the frame (clear of a caption at the top). */
const scrollTo = async (page: Page, target: ReturnType<Page["getByTestId"]>, offset = 96) => {
  await target.evaluate((el, offset) => window.scrollBy({ top: el.getBoundingClientRect().top - offset, behavior: "smooth" }), offset);
  await page.waitForTimeout(600);
};

test("demo", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  // Under 2:30 cut, with room to spare.
  const clock = new DemoClock(DEMO_LIMIT_SECONDS);
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

  // Opening, cut from the video: a title card the edit lines its cuts up on (a white page going
  // dark), then the couple's own empty plan with the photographer's PDF uploaded. The video opens
  // on that contract's text.
  await clock.cut("opening", async () => {
    await page.goto("/");
    clock.sync();
    await titleCard(page, "Wedding Vendor Timeline", "", 1200);
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
    await page.getByTestId("contract-text").scrollIntoViewIfNeeded();
    await page.waitForTimeout(600);
  });

  // Scene 1: a real contract, and the case for the app, from research.
  const contractText = page.getByTestId("contract-text");
  clock.say(1, "Every vendor has its own contract and its own payment dates.");
  await highlight(page, contractText, 3400);
  await caption(page, "A photographer's contract, uploaded as a PDF. About 13 vendors per couple (The Knot 2026), each with its own payment dates.", { ms: 3600, over: contractText, position: "top" });
  await check("contract");

  // Shot 2: the problem, in the cash check's own words on the landing page.
  await page.goto("/");
  const pile = page.getByTestId("landing-cash-warning");
  await expect(pile).toBeVisible();
  await pile.scrollIntoViewIfNeeded();
  const pileText = await pile.innerText();
  const pileAmounts = dollars(pileText);
  clock.say(2, `Code adds them up${pileAmounts.length >= 1 ? `: ${pileAmounts[0]} in one ${/week of/.test(pileText) ? "week" : "month"}` : ""}.`);
  await highlight(page, pile, 3600);
  await caption(page, `Code finds where the money piles up: ${pileText.replace(/\.$/, "")}.`, { ms: 3600, over: pile, position: "bottom" });
  await check("problem");

  // Back to the contract, off camera: the same PDF, uploaded again.
  await clock.cut("back to the contract", async () => {
    await page.goto("/contracts");
    await expect(page.getByTestId("contracts-loaded")).toBeAttached();
    await expect(async () => {
      await page.getByTestId("upload-contract").setInputFiles(`public/sample-contracts/${SAMPLE_PDF}`);
      await expect(page.getByTestId("contract-text")).toHaveValue(/\S{20}/, { timeout: 4_000 });
    }).toPass({ timeout: 30_000 });
  });

  // Scene 2: read, each term beside its sentence.
  await page.getByTestId("read-contract").click();
  await clock.cut("contract read", () => page.waitForURL(/\/contracts\/ctr_/, { timeout: 90_000 }), 1500);
  await expect(page.getByTestId("confirm-terms")).toBeEnabled();
  // The review screen holds for about 7 s, with the contract's own sentence lit up.
  const source = page.getByTestId("source-deposit");
  await mark(source, 7000);
  clock.say(3, `${aiLive ? "Claude reads the terms. " : ""}Each amount sits beside its sentence, and nothing counts until you confirm it.`);
  await highlight(page, source, 7000);
  await caption(page, aiLive ? "Claude reads the payment terms. Each amount and date sits beside the sentence it came from." : "The payment terms, each amount and date beside the sentence it came from.", { ms: 3600, over: source, position: "top" });
  await caption(page, "Nothing reaches the timeline until you confirm it.", { ms: 2500, over: source, position: "top" });
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
  // The mismatch flag holds for at least 4 s, the caption clear of it.
  const flagFrom = clock.raw;
  await mark(flag, 4600);
  clock.say(4, "The caterer's contract gets its own sum wrong. Code flags it.");
  await highlight(page, flag, 4600);
  await caption(page, `The contract says the balance is ${formatCents(CATERER_STATED_BALANCE_CENTS)}. Its own total minus deposit is ${formatCents(CATERER.balanceCents)}, so code flags it.`, { ms: 3800, over: flag, position: "top" });
  const flagShown = clock.onCamera(flagFrom, clock.raw);
  console.log(`[demo] caterer flag on camera ${flagShown.toFixed(1)}s`);
  expect(flagShown).toBeGreaterThanOrEqual(FLAG_ON_CAMERA_S);
  await page.getByTestId("confirm-terms").click();
  await page.waitForURL(/\/timeline/);

  // The other three are the labelled samples, already read the same way.
  await page.request.post("/api/contracts/samples");
  await page.reload();
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
  const overdue = page.locator('[data-testid="timeline-item"][data-role="florist"][data-kind="deposit"]');
  clock.say(5, "Now one timeline for all five vendors. The florist's deposit is overdue.");
  await highlight(page, overdue, 3000);
  await caption(page, `With the other three, one timeline for all five. The florist's ${formatCents(FLORIST.depositCents)} deposit is already overdue.`, { ms: 3000, over: overdue, position: "top" });
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
  const refusalFrom = clock.raw;
  // The confirmed deposit is whatever the Guard's own reason names, not a number written here.
  const confirmedDeposit = dollars(await refusal.getByTestId("guard-reason").innerText()).find((d) => d !== "$5,000");
  clock.say(6, `Asked for $5,000, the Guard refuses${confirmedDeposit ? `: the confirmed deposit is ${confirmedDeposit}` : " in code"}. Nothing is sent.`);
  await highlight(page, refusal, 5400);
  await caption(page, "Asked to pay the caterer $5,000, the Guard checks the signed contract in code and refuses. Nothing is sent.", { ms: 5400, over: refusal, position: "top" });
  const refusalShown = clock.onCamera(refusalFrom, clock.raw);
  console.log(`[demo] Guard refusal on camera ${refusalShown.toFixed(1)}s`);
  expect(refusalShown, "the Guard's refusal holds on camera").toBeGreaterThanOrEqual(HOLD_ON_CAMERA_S);
  await check("guard");

  // Scene 5: the real ask. Urgent first, with code's cash plan.
  await goal.fill(realAsk);
  await page.getByTestId("ask-agent").click();
  const prompt = panel.getByTestId("approval-prompt").first();
  await clock.cut("agent", () => expect(prompt).toBeVisible({ timeout: 90_000 }), 1500);
  await page.screenshot({ path: "docs/screenshot.png" });
  const asked = dollars(await prompt.innerText())[0];
  clock.say(7, `The agent puts the overdue${asked ? ` ${asked}` : ""} deposit first. It can't pay alone.`);
  await highlight(page, panel.getByTestId("agent-messages"), 1800);
  await caption(page, "The agent puts the overdue deposit first, explains the cash clash and proposes a plan the contracts allow.", { ms: 3600, over: panel.getByTestId("agent-messages"), position: "bottom" });
  await check("agent");

  // Shot 8: the cash plan asks the florist for a later date, through a link the couple share. The
  // florist answers on a phone; Claude reads the date; code checks it; the couple approve the move.
  const ask = page.locator('[data-testid="cash-move"][data-item="florist.balance"]');
  await scrollTo(page, ask, 150);
  const may = page.locator('[data-testid="cash-chart-month"][data-month="2027-05"]');
  const mayBefore = Number(await may.getAttribute("data-total-cents"));
  clock.say(8, `The cash plan asks the florist for a later date. The couple share a link, and the florist answers on a phone. ${aiLive ? "Claude" : "The app"} reads the date, code checks it, and nothing moves until the couple approve.`);
  await highlight(page, ask, 1600);
  await ask.getByTestId("move-share").click();
  const link = await ask.getByTestId("move-link").inputValue();
  // The link box opens inside the card; bring the card back down under the top caption.
  await scrollTo(page, ask, 190);
  await caption(page, "The couple send the vendor a link themselves. The app doesn't email it.", { ms: 2200, over: ask, position: "top" });
  // The florist's phone comes up on the left, beside the couple's card.
  const vendor = await phone(page, new URL(link).pathname, { side: "left" });
  await expect(vendor.getByTestId("vendor-ask")).toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(900);
  await vendor.getByTestId("vendor-answer-other").click();
  await vendor.getByTestId("vendor-text").pressSequentially("The 5th is tight, the 8th is fine", { delay: 35 });
  await vendor.getByTestId("vendor-paypal-email").fill(sandbox ? sandboxVendorEmail() : "payments@bramble-vetch.example.com");
  await page.waitForTimeout(500);
  await vendor.getByTestId("vendor-send").click();
  await expect(vendor.getByTestId("vendor-sent")).toBeVisible();
  await page.waitForTimeout(900);
  await closePhone(page);
  await expect(ask.getByTestId("vendor-reply-text")).toBeVisible({ timeout: 15_000 });
  await ask.getByTestId("move-read").click();
  const move = ask.getByTestId("approval-prompt");
  await clock.cut("reply read", () => expect(move).toBeVisible({ timeout: 90_000 }), 800);
  await scrollTo(page, ask, 150);
  await highlight(page, move, 3000);
  const moveTo = (await move.innerText()).match(/to (\w{3}, \w{3} \d{1,2}, \d{4})/)?.[1];
  await caption(page, `${aiLive ? "Claude read" : "The app read"} "the 8th"; code checked it's before the wedding. Nothing moves until the couple approve.`, { ms: 3000, over: move, position: "top" });
  await move.getByTestId("approve-button").click();
  await expect(ask.getByTestId("move-done")).toBeVisible({ timeout: 30_000 });
  await expect(may).not.toHaveAttribute("data-total-cents", String(mayBefore));
  const card = page.getByTestId("cash-card");
  await scrollTo(page, card);
  await highlight(page, card, 2400);
  await caption(page, `Moved${moveTo ? ` to ${moveTo}` : ""}. May drops by the florist's balance, and that crowded week clears.`, { ms: 2800, over: card, position: "bottom" });
  await check("vendor link");

  // Scene 7: one approval, then PayPal's checkout, 5 to 8 s of it on camera.
  await scrollTo(page, prompt);
  clock.say(9, "One approval, then the couple pay it themselves.");
  await highlight(page, prompt.getByTestId("approve-button"), 1200);
  await caption(page, "Nothing moves without you. One approval, then pay it yourself in PayPal.", { ms: 2400, over: prompt.getByTestId("approve-button"), position: "bottom" });
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
    clock.say(10, `In PayPal's own checkout, for exactly ${asked ?? "that amount"}, with the sandbox test card.`);
    await caption(page, `PayPal's own checkout, for exactly the confirmed ${formatCents(FLORIST.depositCents)} (sandbox).`, { ms: 5600, position: "bottom" });
    await clock.cut("PayPal checkout", async () => {
      await payAsGuest(page, { typingDelay: 0 });
      await page.waitForURL(/\/timeline/, { timeout: 120_000 });
    });
    const shown = clock.onCamera(paypalFrom, clock.raw);
    console.log(`[demo] PayPal checkout on camera ${shown.toFixed(1)}s`);
    expect(shown, "PayPal's checkout holds on camera").toBeGreaterThanOrEqual(HOLD_ON_CAMERA_S);
    expect(shown).toBeLessThanOrEqual(CHECKOUT_ON_CAMERA_MS / 1000);
  } else {
    await expect(page.getByTestId("mock-order-id")).toHaveText(/\S/, { timeout: 60_000 });
    const checkoutFrom = clock.raw;
    clock.say(10, `Checkout, for exactly ${asked ?? "the confirmed amount"}.`);
    await caption(page, "Checkout, for exactly the confirmed amount.", { ms: 5400, position: "bottom" });
    const shown = clock.onCamera(checkoutFrom, clock.raw);
    console.log(`[demo] checkout on camera ${shown.toFixed(1)}s`);
    expect(shown, "the checkout holds on camera").toBeGreaterThanOrEqual(HOLD_ON_CAMERA_S);
    await page.getByTestId("mock-approve").click();
  }
  await check("checkout");

  // Scene 8: paid, from PayPal's own record and its webhook.
  const deposit = page.locator(`[data-testid="timeline-item"][data-role="florist"][data-kind="deposit"]`);
  await clock.cut("PayPal webhook on its way", () => expect(deposit.getByTestId("item-status")).toHaveText("Paid", { timeout: 200_000 }), 1500);
  // A webhook over a minute late (PayPal's sandbox has taken 58 s) shows first as the re-read; wait for it off camera.
  if (/hadn't come after a minute/.test(await deposit.getByTestId("paid-by").innerText())) {
    await clock.cut("PayPal webhook, late", () => expect(deposit.getByTestId("paid-by")).toContainText("Confirmed by PayPal webhook", { timeout: 150_000 }).catch(() => undefined), 800);
  }
  await deposit.scrollIntoViewIfNeeded();
  const proof = deposit.getByTestId("paypal-proof");
  await highlight(page, proof, 2200);
  const confirmedBy = await deposit.getByTestId("paid-by").innerText();
  const byWebhook = confirmedBy.startsWith("Confirmed by PayPal webhook");
  clock.say(11, byWebhook ? "Paid, and PayPal's webhook confirmed it." : sandbox ? "Paid, read back from PayPal." : "Paid.");
  await caption(page, sandbox ? `Paid. PayPal's capture reads COMPLETED${byWebhook ? ", and PayPal's webhook for it arrived" : ", read back from PayPal"}.` : "Paid. The capture reads COMPLETED.", { ms: 3000, over: proof, position: "top" });
  await deposit.getByTestId("receipt-open").click();
  const receipt = deposit.getByTestId("receipt");
  await expect(receipt.getByTestId("receipt-capture-id")).toHaveText(/\S/, { timeout: 30_000 });
  await receipt.scrollIntoViewIfNeeded();
  clock.say(12, sandbox ? "The receipt is read back from PayPal: order, capture, webhook event and debug id. Every PayPal call is listed below it." : "The receipt, and every call behind it.");
  await highlight(page, receipt, 2800);
  await caption(page, sandbox ? "Its receipt, read back from PayPal: order, capture, webhook event and PayPal's debug_id." : "Its receipt: order, capture and webhook event.", { ms: 3000, over: receipt, position: "top" });
  await check("paid");

  // "What's happening": every PayPal call behind that payment, in order.
  const activity = page.getByTestId("activity-panel");
  await clearOverlays(page);
  await activity.locator("summary").click();
  const calls = activity.locator('[data-testid="timeline-step"][data-kind="paypal"]');
  await expect(calls.first()).toBeVisible();
  await activity.evaluate((el) => window.scrollBy({ top: el.getBoundingClientRect().top - 24, behavior: "smooth" }));
  await page.waitForTimeout(700);
  const list = activity.getByTestId("tool-call-timeline");
  await highlight(page, list, 3200);
  // The count is what the panel shows: each card plus each folded row's own count.
  const onScreen = await paypalCallsOnScreen(list);
  await expectRepeatsFolded(list);
  await caption(page, sandbox ? `What's happening: every call to PayPal behind it, in order, ${onScreen.calls} in all${onScreen.repeated ? ", repeated reads on one row with a count" : ""}.` : "What's happening: every call behind it, in order.", { ms: 3600, over: list, position: "top" });
  await check("calls");

  // The end card comes up on a clear screen: no caption or outline left over the receipt.
  await clearOverlays(page);
  clock.say(13, "Claude reads, code checks, you approve, PayPal pays.");
  await titleCard(page, "How PayPal pays each vendor", "Create order → the couple approve in PayPal's checkout → capture → PAYMENT.CAPTURE.COMPLETED webhook", 3800, { stay: true });
  clock.end();
  await check("end");
  if (live.requireLive) {
    expect(status.ai.mode, "DEMO_REQUIRE_LIVE=1 needs real AI").toBe("live");
    expect(status.paypal.mode, "DEMO_REQUIRE_LIVE=1 needs PayPal's sandbox").toBe("sandbox");
  }
  const edit = clock.writeCuts("test-results/demo/cuts.json");
  const voice = clock.writeVoiceover("test-results/demo/voiceover.json");
  console.log(`[demo] Voiceover: ${voice.lines.map((l) => `${l.shot}@${l.at}s`).join(" ")}`);
  if (voice.tooLong.length) console.log(`[demo] Voiceover lines to trim: ${voice.tooLong.join("; ")}`);
  const after = await (await page.request.get("/api/kit/status")).json();
  console.log(`[demo] PayPal ${after.paypal.mode}, AI ${after.ai.mode}, AI spend today: ${JSON.stringify(after.ai.budget)}`);
  console.log(`[demo] Paid: ${await deposit.getByTestId("paypal-proof").innerText()}`);
  console.log(`[demo] Cut video ${edit.videoSeconds.toFixed(1)}s, raw ${Math.round(clock.raw)}s. Cuts: ${JSON.stringify(edit.cuts.map((c) => `${c.label} ${c.from.toFixed(1)}-${c.to.toFixed(1)}`))}`);
  expect(edit.videoSeconds).toBeLessThan(DEMO_LIMIT_SECONDS);
  expect(coveredCaptions, "captions covering what they describe").toEqual([]);
});
