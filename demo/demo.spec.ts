/**
 * DEMO VIDEO (npm run demo:record). Tells the product's story in a real browser and saves a .webm
 * to videos/, with its edit list beside it (.cuts.json): the waits to cut (PayPal's page loading, the
 * webhook on its way) and every moment a spinner, skeleton or page load was on screen.
 * `npm run demo:mp4` applies the cuts, so the video has none of those frames and stays under 2:00.
 * About six beats, result first: the problem on the sample timeline (the overdue $600, May over
 * budget); five contracts become one timeline (a PDF read on camera; held 5 s); the caterer's sum
 * caught; the Guard's refusal; PayPal's checkout for exactly $600 (held 8 s); the receipt with its
 * capture, webhook and debug_id (held 8 s). The vendor and Linda answer on real 390-wide phones
 * beside the couple's page. It ends on the live URL, between 100 s and 2:00. Every voiceover line
 * starts with its beat, the first at 0 s, and fits at 15 characters a second; every narrated beat
 * holds at least 4 s; a caption that would cover what it describes moves to the top. No pinned
 * clock: every date on screen is the recording date.
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
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { caption, clearOverlays, closePhone, coveredCaptions, DemoClock, highlight, mark, phone, PHONE_VIEWPORT, titleCard, watchMockText } from "./captions";
import { openCardForm, payAsGuest } from "../tests/e2e/pay-in-checkout";
import { sandboxPayeeFor } from "../tests/e2e/paypal-reread";
import { formatCents } from "../src/lib/wedding/cents";
import { CATERER, CATERER_STATED_BALANCE_CENTS, FLORIST, SAMPLE_PDF } from "../src/lib/wedding/samples";

/** The cut video stays under 2:00, and long enough to breathe. */
const DEMO_LIMIT_SECONDS = 118;
const DEMO_MIN_SECONDS = 100;
/** Where a judge can try it. */
const LIVE_URL = "vendor-timeline.onrender.com";
/** The caterer's "the contract says X, but total minus deposit is Y" flag is on camera at least this long. */
const FLAG_ON_CAMERA_S = 5;

/** The Guard's refusal and the five-contract timeline each hold at least this long in the cut, or the take fails. */
const HOLD_ON_CAMERA_S = 5;
/** PayPal's checkout and the receipt read back from PayPal each hold at least this long, and the checkout at most PAY_HOLD_MAX_S. */
const PAY_HOLD_S = 8;
const PAY_HOLD_MAX_S = 10;
/** The illustrative parent who pays one vendor. */
const PARENT = "Linda";
/** A voiceover line is read at 15 characters a second, and must fit before the next one starts. */
const VOICE_CHARS_PER_SECOND = 15;

/** The dollar amounts in a piece of on-screen text, cents dropped when they're zero: "$2,500". */
const dollars = (text: string) => [...text.matchAll(/\$\d[\d,]*(?:\.\d\d)?/g)].map((m) => m[0].replace(/\.00$/, ""));

/** Scrolls `target` to `offset` px below the top of the frame (clear of a caption at the top). */
const scrollTo = async (page: Page, target: ReturnType<Page["getByTestId"]>, offset = 84) => {
  await target.evaluate((el, offset) => window.scrollBy({ top: el.getBoundingClientRect().top - offset, behavior: "smooth" }), offset);
  await page.waitForTimeout(600);
};

/**
 * The parent, off camera on her own phone: opens her link and pays in PayPal's checkout (as a guest
 * with the sandbox test card), or the mock checkout. Her screen was already shown in the phone frame.
 */
async function parentPays(browser: Browser, url: string, sandbox: boolean, baseURL: string | undefined) {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["iPhone 13"];
  const context = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL });
  try {
    const parent = await context.newPage();
    await parent.goto(url);
    const box = parent.getByTestId("contrib-checkout");
    await expect(box).toBeVisible({ timeout: 30_000 });
    if (sandbox) {
      await box.getByTestId("paypal-checkout").click();
      await parent.waitForURL(/sandbox\.paypal\.com/, { timeout: 60_000 });
      await payAsGuest(parent);
      await expect(async () => expect(new URL(parent.url()).pathname).toMatch(/^\/contribute\//)).toPass({ timeout: 120_000, intervals: [1_000] });
    } else {
      await box.getByTestId("simulate-paypal-approval").click();
      await parent.getByTestId("mock-approve").click();
    }
    await expect(parent.getByTestId("contrib-paid")).toBeVisible({ timeout: 120_000 });
  } finally {
    await context.close();
  }
}

/** The phone on camera is a real 390-wide page of its own, fully opaque: never a see-through overlay. */
async function phoneIsReal(page: Page, screen: Page) {
  expect(await screen.evaluate(() => innerWidth)).toBe(PHONE_VIEWPORT.width);
  expect(screen.context()).not.toBe(page.context());
  const shell = await page.evaluate(() => {
    const el = document.getElementById("__demo_phone");
    if (!el) return null;
    const style = getComputedStyle(el);
    return { opacity: style.opacity, visibility: style.visibility, transition: style.transitionDuration };
  });
  expect(shell).toEqual({ opacity: "1", visibility: "visible", transition: "0s" });
}

test("demo", async ({ page, context, browser }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
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
  // dark), which fades to a new visitor's first screen: the sample wedding's timeline.
  await clock.cut("opening", async () => {
    await page.goto("/timeline");
    await expect(page.getByTestId("timeline-item")).toHaveCount(10);
    await expect(page.getByTestId("cash-chart")).toBeVisible();
    clock.sync();
    await titleCard(page, "Wedding Vendor Timeline", "", 1200);
  });

  // Beat 1, result first: the problem on the sample wedding's own timeline. The overdue deposit and
  // the month over budget are code's, worked out from the five sample contracts.
  const chart = page.getByTestId("cash-card");
  const firstRow = page.locator('[data-testid="timeline-item"][data-role="florist"][data-kind="deposit"]');
  await expect(firstRow.getByTestId("item-status")).toHaveText("Overdue");
  // Read from the screen, code's own line: "Over budget: April 2027 by $1,000.00, May 2027 by $10,800.00."
  // The month furthest over is the one named.
  const overs = [...(await page.getByTestId("cash-chart-summary").innerText()).matchAll(/(\w+) \d{4} by (\$[\d,]+)/g)].map((m) => ({ month: m[1], by: m[2], cents: Number(m[2].replace(/\D/g, "")) }));
  const worst = overs.sort((x, y) => y.cents - x.cents)[0];
  const overMonth = worst?.month ?? "a month";
  clock.say(1, `Couples pay about 13 vendors. Here a ${dollars(formatCents(FLORIST.depositCents))[0]} deposit is overdue, and ${overMonth} is over budget.`);
  await scrollTo(page, chart, 20);
  await highlight(page, chart, 4200);
  await caption(page, "For couples paying about 13 wedding vendors (The Knot 2026): one timeline, a cash plan, each vendor paid in PayPal.", { ms: 4000, over: chart, position: "bottom", side: "left" });
  await scrollTo(page, firstRow, 150);
  await highlight(page, firstRow, 4200);
  await caption(page, `The florist's ${formatCents(FLORIST.depositCents)} deposit is overdue, and ${overMonth} is ${worst?.by ?? "far"} over the monthly budget.`, { ms: 4000, over: firstRow, position: "top" });
  await check("problem");

  // Beat 2: the couple's own contracts go in. The photographer's PDF is uploaded and read on camera.
  await clock.cut("to the contracts", async () => {
    await page.getByTestId("start-own-plan").click();
    await page.waitForURL(/\/timeline$/);
    await expect(page.getByText("Nothing confirmed yet")).toBeVisible();
    await page.goto("/contracts");
    await expect(page.getByTestId("contracts-loaded")).toBeAttached();
    await page.waitForTimeout(300);
  });
  const uploadButton = page.locator("label").filter({ has: page.getByTestId("upload-contract") });
  const contractText = page.getByTestId("contract-text");
  await scrollTo(page, contractText, 70);
  clock.say(2, `The couple add each contract, here a PDF. ${aiLive ? "Claude reads" : "The app reads"} the terms, each beside its sentence.`);
  await highlight(page, uploadButton, 1400);
  await expect(async () => {
    await page.getByTestId("upload-contract").setInputFiles(`public/sample-contracts/${SAMPLE_PDF}`);
    await expect(contractText).toHaveValue(/\S{20}/, { timeout: 4_000 });
  }).toPass({ timeout: 30_000 });
  await highlight(page, contractText, 2000);
  await caption(page, `${SAMPLE_PDF}, uploaded. The app pulls the text out of the PDF.`, { ms: 2000, over: contractText, position: "bottom" });
  await page.getByTestId("read-contract").click();
  await clock.cut("contract read", () => page.waitForURL(/\/contracts\/ctr_/, { timeout: 90_000 }), 1200);
  await expect(page.getByTestId("confirm-terms")).toBeEnabled();
  const source = page.getByTestId("source-deposit");
  await scrollTo(page, page.getByTestId("term-deposit"), 150);
  await mark(source, 4200);
  await highlight(page, source, 4200);
  await caption(page, aiLive ? "Claude reads the payment terms. Each amount and date sits beside the sentence it came from." : "The payment terms, each amount and date beside the sentence it came from.", { ms: 2400, over: source, position: "top" });
  await caption(page, "Nothing reaches the timeline until the couple confirm it.", { ms: 1600, over: source, position: "top" });
  await page.getByTestId("confirm-terms").click();
  await check("pdf");

  // Beat 3: the caterer's contract gets its own sum wrong, and code catches it. Loading the sample
  // and reading it are cut.
  await clock.cut("caterer contract read", async () => {
    await page.waitForURL(/\/timeline/);
    await page.goto("/contracts");
    await expect(page.getByTestId("contracts-loaded")).toBeAttached();
    await page.getByTestId(`sample-${CATERER.vendorRole}`).click();
    await expect(page.getByTestId("contract-text")).toHaveValue(/\S{20}/, { timeout: 30_000 });
    await page.getByTestId("read-contract").click();
    await page.waitForURL(/\/contracts\/ctr_/, { timeout: 90_000 });
  }, 400);
  const flag = page.getByTestId("flag-balance");
  await expect(flag).toContainText(formatCents(CATERER_STATED_BALANCE_CENTS));
  await scrollTo(page, page.getByTestId("term-balance"), 150);
  const flagFrom = clock.raw;
  await mark(flag, 5400);
  clock.say(3, "The caterer's contract gets its own sum wrong. Code flags it.");
  await highlight(page, flag, 5400);
  await caption(page, `The contract says the balance is ${formatCents(CATERER_STATED_BALANCE_CENTS)}. Its own total minus deposit is ${formatCents(CATERER.balanceCents)}, so code flags it.`, { ms: 4800, over: flag, position: "top" });
  const flagShown = clock.onCamera(flagFrom, clock.raw);
  console.log(`[demo] caterer flag on camera ${flagShown.toFixed(1)}s`);
  expect(flagShown).toBeGreaterThanOrEqual(FLAG_ON_CAMERA_S);
  await page.getByTestId("confirm-terms").click();

  // Beat 2's result: with the other three (the labelled samples, read the same way), five contracts
  // are one timeline, held 5 s.
  await clock.cut("to the timeline", async () => {
    await page.waitForURL(/\/timeline/);
    await page.request.post("/api/contracts/samples");
    await page.goto("/timeline");
    await expect(page.getByTestId("timeline-item")).toHaveCount(10);
  });
  const list = page.getByTestId("timeline-list");
  await scrollTo(page, list, 120);
  const timelineFrom = clock.raw;
  clock.say(4, "Five contracts, one timeline: every deposit and balance, in date order.");
  await highlight(page, list, 5600);
  await caption(page, "Five contracts, one timeline, in date order.", { ms: 5200, over: list, position: "top" });
  const timelineShown = clock.onCamera(timelineFrom, clock.raw);
  console.log(`[demo] five-contract timeline on camera ${timelineShown.toFixed(1)}s`);
  expect(timelineShown, "the five-contract timeline holds on camera").toBeGreaterThanOrEqual(HOLD_ON_CAMERA_S);
  await check("contracts");

  // Beat 4: asked for more than the contract says, code checks the amount before any model runs,
  // and the Guard refuses it.
  const panel = page.getByTestId("agent-panel");
  await scrollTo(page, panel, 20);
  const goal = page.getByTestId("agent-goal");
  const realAsk = await goal.inputValue();
  await goal.fill("Pay the caterer $5,000.");
  await page.getByTestId("ask-agent").click();
  const refusal = panel.getByTestId("guard-refusal");
  await clock.cut("agent", () => expect(refusal).toBeVisible({ timeout: 90_000 }), 800);
  await scrollTo(page, refusal, 170);
  const refusalFrom = clock.raw;
  clock.say(5, "Asked for $5,000, code checks the contract before the model runs. The Guard refuses.");
  await highlight(page, refusal, 5200);
  await caption(page, "Asked to pay the caterer $5,000, code checks the signed contract before the model runs, and the Guard refuses. Nothing is sent.", { ms: 5000, over: refusal, position: "top" });
  const refusalShown = clock.onCamera(refusalFrom, clock.raw);
  console.log(`[demo] Guard refusal on camera ${refusalShown.toFixed(1)}s`);
  expect(refusalShown, "the Guard's refusal holds on camera").toBeGreaterThanOrEqual(HOLD_ON_CAMERA_S);
  await check("guard");

  // The real ask. Urgent first, with code's cash plan.
  await scrollTo(page, panel, 20);
  await goal.fill(realAsk);
  await page.getByTestId("ask-agent").click();
  const prompt = panel.getByTestId("approval-prompt").first();
  await clock.cut("agent", () => expect(prompt).toBeVisible({ timeout: 90_000 }), 1000);
  await page.screenshot({ path: "docs/screenshot.png" });
  const asked = dollars(await prompt.innerText())[0];
  const messages = panel.getByTestId("agent-messages");
  await scrollTo(page, messages, 170);
  clock.say(6, `The agent puts the overdue${asked ? ` ${asked}` : ""} deposit first, then a cash plan.`);
  await highlight(page, messages, 2000);
  await caption(page, "The agent puts the overdue deposit first, explains the cash clash and proposes a plan the contracts allow.", { ms: 3600, over: messages, position: "top" });
  await check("agent");

  // The cash plan asks the florist for a later date, through a link the couple
  // send. The florist answers on a phone; the date is read and checked; the couple approve the move.
  const ask = page.locator('[data-testid="cash-move"][data-item="florist.balance"]');
  await scrollTo(page, ask, 150);
  const may = page.locator('[data-testid="cash-chart-month"][data-month="2027-05"]');
  const mayBefore = Number(await may.getAttribute("data-total-cents"));
  clock.say(7, "The plan asks the florist for a later date, by link.");
  await highlight(page, ask, 1000);
  await ask.getByTestId("move-share").click();
  const link = await ask.getByTestId("move-link").inputValue();
  // The link box opens inside the card; bring the card back down under the top caption.
  await scrollTo(page, ask, 150);
  await caption(page, "The couple send the vendor a link themselves. The app doesn't email it.", { ms: 3200, over: ask, position: "top" });
  // The florist's phone comes up on the left once its page is drawn, beside the couple's card.
  const vendor = await phone(page, new URL(link).pathname, { side: "left", ready: "vendor-ask", clock, watch: live.watch });
  await phoneIsReal(page, vendor);
  clock.say(8, "The florist taps Another date, types the 8th, and adds a PayPal email.");
  await page.waitForTimeout(400);
  await vendor.getByTestId("vendor-answer-other").click();
  await page.waitForTimeout(400);
  await vendor.getByTestId("vendor-text").pressSequentially("The 5th is tight, the 8th is fine", { delay: 55 });
  await page.waitForTimeout(600);
  await vendor.getByTestId("vendor-paypal-email").fill(sandbox ? sandboxPayeeFor("florist") : "payments@bramble-vetch.example.com");
  await page.waitForTimeout(400);
  await vendor.getByTestId("vendor-send").click();
  await expect(vendor.getByTestId("vendor-sent")).toBeVisible();
  await page.waitForTimeout(500);
  await closePhone(page);
  const move = ask.getByTestId("approval-prompt");
  // The reply reaches the couple's page on its next poll, then is read: both waits are cut.
  await clock.cut("reply read", async () => {
    await expect(ask.getByTestId("vendor-reply-text")).toBeVisible({ timeout: 15_000 });
    await ask.getByTestId("move-read").click();
    // Claude's read on the hosted copy has taken over 90 s once; the wait is cut either way.
    await expect(move).toBeVisible({ timeout: 150_000 }).catch(async (e) => {
      // Say what the reply agent did, so a stalled read can be told from a refused one.
      const { runs } = await (await page.request.get("/api/agent/runs")).json();
      console.log(`[demo] reply read stalled; runs: ${JSON.stringify(runs.slice(0, 3).map((r: { goal?: string; status: string; error?: string; summary?: string; startedAt: string }) => ({ goal: r.goal, status: r.status, error: r.error, summary: r.summary, startedAt: r.startedAt })))}`);
      throw e;
    });
  }, 600);
  await scrollTo(page, move, 150);
  const moveTo = (await move.innerText()).match(/to (\w{3}, \w{3} \d{1,2}, \d{4})/)?.[1];
  clock.say(9, `${aiLive ? "Claude" : "The app"} reads the 8th, code checks it, and the couple approve the move.`);
  await highlight(page, move, 2600);
  await caption(page, `${aiLive ? "Claude read" : "The app read"} "the 8th"; code checked it's before the wedding.`, { ms: 2000, over: move, position: "top" });
  await move.getByTestId("approve-button").click();
  await clock.cut("move saved", () => expect(ask.getByTestId("move-done")).toBeVisible({ timeout: 30_000 }), 600);
  await expect(may).not.toHaveAttribute("data-total-cents", String(mayBefore));
  const card = page.getByTestId("cash-card");
  await scrollTo(page, card, 20);
  await highlight(page, card, 2200);
  await caption(page, `Moved${moveTo ? ` to ${moveTo}` : ""}. May drops by the florist's balance.`, { ms: 1700, over: card, position: "bottom" });
  await check("vendor link");

  // Beat 5: the one approval, then PayPal's checkout for exactly the deposit, 8 to 10 s of it on camera.
  await scrollTo(page, prompt, 170);
  clock.say(10, "One approval, then the couple pay it in PayPal.");
  await highlight(page, prompt, 2400);
  await caption(page, "Nothing moves without the couple. One approval, then they pay it in PayPal.", { ms: 3400, over: prompt, position: "top" });
  await prompt.getByTestId("approve-button").click();
  if (sandbox) {
    // PayPal's page loading and its spinners are cut; its checkout, with the amount, stays on screen briefly.
    const paypalFrom = clock.raw;
    await clock.cut("PayPal page loading", async () => {
      await page.waitForURL(/sandbox\.paypal\.com/, { timeout: 60_000 });
      await openCardForm(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(400);
    });
    clock.say(11, `In PayPal's own checkout, for exactly ${asked ?? "that amount"}, with the sandbox test card.`);
    await caption(page, `PayPal's own checkout, for exactly the confirmed ${formatCents(FLORIST.depositCents)} (sandbox).`, { ms: PAY_HOLD_S * 1000 + 400, position: "bottom" });
    await clock.cut("PayPal checkout", async () => {
      await payAsGuest(page, { typingDelay: 0 });
      await page.waitForURL(/\/timeline/, { timeout: 120_000 });
    });
    const shown = clock.onCamera(paypalFrom, clock.raw);
    console.log(`[demo] PayPal checkout on camera ${shown.toFixed(1)}s`);
    expect(shown, "PayPal's checkout holds on camera").toBeGreaterThanOrEqual(PAY_HOLD_S);
    expect(shown).toBeLessThanOrEqual(PAY_HOLD_MAX_S);
  } else {
    await expect(page.getByTestId("mock-order-id")).toHaveText(/\S/, { timeout: 60_000 });
    const checkoutFrom = clock.raw;
    clock.say(11, `Checkout, for exactly ${asked ?? "the confirmed amount"}.`);
    await caption(page, "Checkout, for exactly the confirmed amount.", { ms: PAY_HOLD_S * 1000 + 400, position: "bottom" });
    const shown = clock.onCamera(checkoutFrom, clock.raw);
    console.log(`[demo] checkout on camera ${shown.toFixed(1)}s`);
    expect(shown, "the checkout holds on camera").toBeGreaterThanOrEqual(PAY_HOLD_S);
    expect(shown).toBeLessThanOrEqual(PAY_HOLD_MAX_S);
    await page.getByTestId("mock-approve").click();
  }
  await check("checkout");

  // Beat 6: paid, from PayPal's own record and its webhook, with its receipt read back from PayPal
  // (capture, webhook event, debug_ids), held 8 s.
  const deposit = page.locator(`[data-testid="timeline-item"][data-role="florist"][data-kind="deposit"]`);
  await clock.cut("PayPal webhook on its way", () => expect(deposit.getByTestId("item-status")).toHaveText("Paid", { timeout: 200_000 }), 1200);
  // A webhook over a minute late (PayPal's sandbox has taken 58 s) shows first as the re-read; wait for it off camera.
  if (/hadn't come after a minute/.test(await deposit.getByTestId("paid-by").innerText())) {
    await clock.cut("PayPal webhook, late", () => expect(deposit.getByTestId("paid-by")).toContainText("Confirmed by PayPal webhook", { timeout: 150_000 }).catch(() => undefined), 800);
  }
  await deposit.getByTestId("receipt-open").click();
  const receipt = deposit.getByTestId("receipt");
  await clock.cut("receipt from PayPal", () => expect(receipt.getByTestId("receipt-capture-id")).toHaveText(/\S/, { timeout: 30_000 }), 600);
  await scrollTo(page, deposit, 150);
  await expect(receipt.getByTestId("receipt-webhook")).toBeVisible();
  await expect(receipt.getByTestId("receipt-debug-id").first()).toBeVisible();
  const receiptFrom = clock.raw;
  const confirmedBy = await deposit.getByTestId("paid-by").innerText();
  const byWebhook = confirmedBy.startsWith("Confirmed by PayPal webhook");
  clock.say(12, sandbox ? `Paid${byWebhook ? ", and PayPal's webhook confirmed it" : ""}. The receipt is read back from PayPal: capture, webhook, debug_id.` : "Paid. The receipt shows the capture, the webhook and each debug_id.");
  await highlight(page, receipt, PAY_HOLD_S * 1000 + 600);
  await caption(page, sandbox ? `Paid: capture COMPLETED${byWebhook ? ", PayPal's webhook event" : ""}, and each call's debug_id, read back from PayPal.` : "Paid. The capture reads COMPLETED, with its webhook and debug_ids.", { ms: PAY_HOLD_S * 1000 + 400, over: receipt, position: "top" });
  const receiptShown = clock.onCamera(receiptFrom, clock.raw);
  console.log(`[demo] receipt on camera ${receiptShown.toFixed(1)}s`);
  expect(receiptShown, "the receipt holds on camera").toBeGreaterThanOrEqual(PAY_HOLD_S);
  await receipt.getByTestId("receipt-close").click({ timeout: 5_000 }).catch(() => undefined);
  await check("paid");

  // A parent pays one vendor. "Assign" makes a link for Linda (Illustrative); her
  // phone asks to pay; the couple approve; she pays in her own PayPal checkout, off camera; the row
  // says who paid, and that it went to the account the florist gave on the reply link.
  const balance = page.locator(`[data-testid="timeline-item"][data-role="florist"][data-kind="balance"]`);
  await scrollTo(page, balance, 150);
  clock.say(13, `A parent can pay one vendor. Assign makes a link for ${PARENT} alone.`);
  await balance.getByTestId("assign-open").click({ timeout: 10_000 });
  await balance.getByTestId("assign-name").pressSequentially(PARENT, { delay: 60, timeout: 10_000 });
  await balance.getByTestId("assign-save").click({ timeout: 10_000 });
  const parentLink = await clock.cut("making Linda's link", () => balance.getByTestId("assign-link").inputValue({ timeout: 10_000 }), 400);
  await highlight(page, balance, 1800);
  await caption(page, `${PARENT} (an illustrative parent) gets a link for the florist's balance only.`, { ms: 1600, over: balance, position: "top" });
  const parentPhone = await phone(page, new URL(parentLink).pathname, { side: "left", ready: "contrib-ask", clock, watch: live.watch });
  await phoneIsReal(page, parentPhone);
  await page.waitForTimeout(500);
  await parentPhone.getByTestId("contrib-start").click({ timeout: 10_000 });
  await expect(parentPhone.getByTestId("contrib-waiting")).toBeVisible();
  await page.waitForTimeout(500);
  await closePhone(page);
  const parentPrompt = balance.getByTestId("approval-prompt");
  // The couple's page picks up her request on its next poll; the wait is cut.
  await clock.cut(`${PARENT}'s request arriving`, () => expect(parentPrompt).toBeVisible({ timeout: 30_000 }), 300);
  await scrollTo(page, balance, 150);
  await highlight(page, parentPrompt.getByTestId("approve-button"), 900);
  await parentPrompt.getByTestId("approve-button").click({ timeout: 10_000 });
  await clock.cut("approval saved", () => expect(balance.getByTestId("contributor-checkout")).toBeVisible({ timeout: 30_000 }), 600);
  await clock.cut(`${PARENT} pays in PayPal, off camera`, async () => {
    await parentPays(browser, parentLink, sandbox, test.info().project.use.baseURL);
    await expect(balance.getByTestId("item-status")).toHaveText("Paid", { timeout: 200_000 });
    if (/hadn't come after a minute/.test(await balance.getByTestId("paid-by").innerText())) {
      await expect(balance.getByTestId("paid-by")).toContainText("Confirmed by PayPal webhook", { timeout: 150_000 }).catch(() => undefined);
    }
    await scrollTo(page, balance, 150);
  });
  await expect(balance.getByTestId("item-payer")).toHaveText(`Paid by ${PARENT}'s PayPal`);
  // "Own" only when no other vendor is paid at that account; the shared sandbox stand-in is said as one.
  const paidTo = balance.getByTestId("paid-to-vendor");
  const own = (await paidTo.getAttribute("data-own")) === "true";
  await expect(paidTo).toContainText(own ? "Paid to the florist's own PayPal" : "Paid to the florist's PayPal (sandbox stand-in: ");
  clock.say(14, `${PARENT} pays in PayPal's checkout, to the account the florist gave.`);
  await highlight(page, balance, 5000);
  await caption(page, own ? `Paid by ${PARENT}'s PayPal, to the florist's own account, not the app's.` : `Paid by ${PARENT}'s PayPal, to the account the florist gave: a sandbox stand-in.`, { ms: 3600, over: balance, position: "top" });
  await check("parent");

  // The end card: what it does, and the live URL to try it.
  await clearOverlays(page);
  clock.say(15, `${aiLive ? "Claude" : "The app"} reads, code checks, you approve, PayPal pays. Try it live.`);
  await titleCard(page, "For couples paying wedding vendors", `One timeline, a cash plan the contracts allow, each vendor paid in PayPal.<br>Try it: ${LIVE_URL}`, 5200, { stay: true });
  clock.end();
  await check("end");
  if (live.requireLive) {
    expect(status.ai.mode, "DEMO_REQUIRE_LIVE=1 needs real AI").toBe("live");
    expect(status.paypal.mode, "DEMO_REQUIRE_LIVE=1 needs PayPal's sandbox").toBe("sandbox");
  }
  const edit = clock.writeCuts("test-results/demo/cuts.json");
  const voice = clock.writeVoiceover("test-results/demo/voiceover.json", VOICE_CHARS_PER_SECOND);
  console.log(`[demo] Voiceover: ${voice.lines.map((l) => `${l.shot}@${l.at}s`).join(" ")}`);
  if (voice.tooLong.length) console.log(`[demo] Voiceover lines to trim: ${voice.tooLong.join("; ")}`);
  const after = await (await page.request.get("/api/kit/status")).json();
  console.log(`[demo] PayPal ${after.paypal.mode}, AI ${after.ai.mode}, AI spend today: ${JSON.stringify(after.ai.budget)}`);
  console.log(`[demo] Paid: ${await deposit.getByTestId("paypal-proof").innerText()}`);
  console.log(`[demo] Paid by ${PARENT}: ${await balance.getByTestId("paypal-proof").innerText()}`);
  console.log(`[demo] Cut video ${edit.videoSeconds.toFixed(1)}s, raw ${Math.round(clock.raw)}s. Cuts: ${JSON.stringify(edit.cuts.map((c) => `${c.label} ${c.from.toFixed(1)}-${c.to.toFixed(1)}`))}`);
  expect(edit.videoSeconds).toBeLessThan(DEMO_LIMIT_SECONDS);
  expect(edit.videoSeconds, "long enough to breathe").toBeGreaterThanOrEqual(DEMO_MIN_SECONDS);
  expect(voice.lines[0].at, "the voiceover starts at 0 s").toBeLessThanOrEqual(0.1);
  expect(voice.tooLong, "every voiceover line fits at 15 characters a second").toEqual([]);
  expect(coveredCaptions, "captions covering what they describe").toEqual([]);
  expect(voice.short, "every narrated beat holds at least 4 s on screen").toEqual([]);
});
