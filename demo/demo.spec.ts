/**
 * DEMO VIDEO (npm run demo:record). Tells the product's story in a real browser and saves a .webm
 * to videos/, with its edit list beside it (.cuts.json): the waits to cut (PayPal's page loading, the
 * webhook on its way) and every moment a spinner, skeleton or page load was on screen.
 * `npm run demo:mp4` applies the cuts, so the video has none of those frames and stays under 2:00.
 * Result first: the problem on the sample timeline (the overdue $600, May over budget). Then the
 * couple's contracts go in (a PDF uploaded and read on camera); the caterer's sum caught; a question
 * about that contract answered with its own clause, which code finds in the text; five contracts as
 * one timeline (held 5 s); the Guard refusing $5,000; the agent's plan; the florist's reply in three
 * steps (her phone, the date read, the couple approve: 18 s at least); PayPal's checkout for exactly
 * $600 (held 8 s); the receipt read back from PayPal (held 8 s); every PayPal call behind it, with
 * PayPal's debug_id. It ends on the live URL, between 100 s and 2:00. Every voiceover line starts with
 * its beat, the first at 0 s, and fits at 15 characters a second; every narrated beat holds at least
 * 4 s; no caption covers what it describes. Captions, highlights and cards appear and go in one
 * frame, so none fades over the next scene. No pinned clock: every date on screen is the recording date.
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
import { caption, clearOverlays, closePhone, coveredCaptions, DemoClock, highlight, mark, phone, PHONE_VIEWPORT, titleCard, watchMockText } from "./captions";
import { openCardForm, payAsGuest } from "../tests/e2e/pay-in-checkout";
import { sandboxPayeeFor } from "../tests/e2e/paypal-reread";
import { formatCents } from "../src/lib/wedding/cents";
import { CATERER, CATERER_STATED_BALANCE_CENTS, FLORIST, SAMPLE_PDF } from "../src/lib/wedding/samples";
import { SAMPLE_QUESTION } from "../src/lib/wedding/question-result";

/** The cut video stays under 2:00, and long enough to breathe. */
const DEMO_LIMIT_SECONDS = 120;
const DEMO_MIN_SECONDS = 100;
/** Where a judge can try it. */
const LIVE_URL = "vendor-timeline.onrender.com";
/** The caterer's "the contract says X, but total minus deposit is Y" flag is on camera at least this long. */
const FLAG_ON_CAMERA_S = 5;
/** The answer to a question about the contract, with its quoted clause, is on camera at least this long. */
const ANSWER_ON_CAMERA_S = 5;
/** The Guard's refusal and the five-contract timeline each hold at least this long in the cut, or the take fails. */
const HOLD_ON_CAMERA_S = 5;
/** The florist's reply, in its three steps (her phone, the date read, the couple approve), holds at least this long. */
const VENDOR_BEAT_S = 18;
/** PayPal's checkout and the receipt read back from PayPal each hold at least this long, and the checkout at most PAY_HOLD_MAX_S. */
const PAY_HOLD_S = 8;
const PAY_HOLD_MAX_S = 10;
/** A voiceover line is read at 15 characters a second, and must fit before the next one starts. */
const VOICE_CHARS_PER_SECOND = 15;

/** The dollar amounts in a piece of on-screen text, cents dropped when they're zero: "$2,500". */
const dollars = (text: string) => [...text.matchAll(/\$\d[\d,]*(?:\.\d\d)?/g)].map((m) => m[0].replace(/\.00$/, ""));
/** Spacing and curly quotes aside, as the app compares them. */
const flat = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** Scrolls `target` to `offset` px below the top of the frame (clear of a caption at the top). */
const scrollTo = async (page: Page, target: ReturnType<Page["getByTestId"]>, offset = 84) => {
  await target.evaluate((el, offset) => window.scrollBy({ top: el.getBoundingClientRect().top - offset, behavior: "smooth" }), offset);
  await page.waitForTimeout(600);
};

/** The app's own "Approved" toast would sit over the next caption: put it away, as the couple would. */
async function dismissToasts(page: Page) {
  for (const close of await page.locator('[data-testid^="toast-"] button[aria-label="Dismiss"]').all()) await close.click({ timeout: 2_000 }).catch(() => undefined);
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

test("demo", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const clock = new DemoClock(DEMO_LIMIT_SECONDS);
  await clock.watchBusy(page);
  const live = await watchMockText(page);
  // The captions follow what the app really runs: they name Claude and PayPal only when it's them.
  const status = await (await page.request.get("/api/kit/status")).json();
  const sandbox = status.paypal.mode === "sandbox";
  const aiLive = status.ai.mode === "live";
  const reader = aiLive ? "Claude" : "The app";
  console.log(`[demo] PayPal ${status.paypal.mode}, AI ${status.ai.mode}${live.requireLive ? ", DEMO_REQUIRE_LIVE=1" : ""}`);
  const check = async (label: string) => {
    clock.check(label);
    await live.check(label);
  };

  // Opening, cut from the video: a title card the edit lines its cuts up on (a white page going
  // dark), then a new visitor's first screen: the sample wedding's timeline.
  await clock.cut("opening", async () => {
    await page.goto("/timeline");
    await expect(page.getByTestId("timeline-item")).toHaveCount(10);
    await expect(page.getByTestId("cash-chart")).toBeVisible();
    clock.sync();
    await titleCard(page, "Wedding Vendor Timeline", "", 1200, { fade: true });
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
  await highlight(page, chart, 3600);
  await caption(page, "For couples paying about 13 wedding vendors (The Knot 2026): one timeline, a cash plan, each vendor paid in PayPal.", { ms: 3400, over: chart, position: "bottom", side: "left" });
  await scrollTo(page, firstRow, 150);
  await highlight(page, firstRow, 3600);
  await caption(page, `The florist's ${formatCents(FLORIST.depositCents)} deposit is overdue, and ${overMonth} is ${worst?.by ?? "far"} over the monthly budget.`, { ms: 3400, over: firstRow, position: "top" });
  await check("problem");

  // Beat 2: the couple's own contracts go in. The paste screen is captioned, then the photographer's
  // PDF is uploaded: the screen names the file and says its text came from the PDF.
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
  await scrollTo(page, contractText, 130);
  clock.say(2, "The couple paste each contract, or upload it. Here, the photographer's PDF.");
  await highlight(page, uploadButton, 1800);
  await caption(page, "Paste each contract here, or upload it as a PDF.", { ms: 1800, over: contractText, position: "top" });
  await expect(async () => {
    await page.getByTestId("upload-contract").setInputFiles(`public/sample-contracts/${SAMPLE_PDF}`);
    await expect(contractText).toHaveValue(/\S{20}/, { timeout: 4_000 });
  }).toPass({ timeout: 30_000 });
  const pdfChip = page.getByTestId("pdf-loaded");
  await expect(pdfChip).toHaveAttribute("data-file", SAMPLE_PDF);
  await scrollTo(page, pdfChip, 130);
  await highlight(page, pdfChip, 2000);
  await caption(page, `${SAMPLE_PDF} uploaded: its text, taken from the PDF.`, { ms: 2000, over: pdfChip, position: "top" });
  await page.getByTestId("read-contract").click();
  await clock.cut("contract read", () => page.waitForURL(/\/contracts\/ctr_/, { timeout: 90_000 }));
  await expect(page.getByTestId("confirm-terms")).toBeEnabled();
  const source = page.getByTestId("source-deposit");
  await scrollTo(page, page.getByTestId("term-deposit"), 150);
  clock.say(3, `${reader} reads the terms, each beside its sentence. The couple confirm.`);
  await mark(source, 4200);
  await highlight(page, source, 4200);
  await caption(page, aiLive ? "Claude reads the payment terms. Each amount and date sits beside the sentence it came from." : "The payment terms, each amount and date beside the sentence it came from.", { ms: 2200, over: source, position: "top" });
  await caption(page, "Nothing reaches the timeline until the couple confirm it.", { ms: 1400, over: source, position: "top" });
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
  clock.say(4, "The caterer's contract gets its own sum wrong. Code flags it.");
  await highlight(page, flag, 5400);
  await caption(page, `The contract says the balance is ${formatCents(CATERER_STATED_BALANCE_CENTS)}. Its own total minus deposit is ${formatCents(CATERER.balanceCents)}, so code flags it.`, { ms: 4400, over: flag, position: "top" });
  const flagShown = clock.onCamera(flagFrom, clock.raw);
  console.log(`[demo] caterer flag on camera ${flagShown.toFixed(1)}s`);
  expect(flagShown).toBeGreaterThanOrEqual(FLAG_ON_CAMERA_S);

  // Beat 4: a question about this contract, answered from its own words. The quote is the
  // contract's, found in its stored text by code, with the section it sits in.
  const askBox = page.getByTestId("ask-contract");
  await scrollTo(page, askBox, 150);
  clock.say(5, "Ask about the contract. The answer quotes its clause, and code finds those words in it.");
  await highlight(page, askBox.getByTestId("contract-question"), 1800);
  await askBox.getByTestId("contract-question").pressSequentially(SAMPLE_QUESTION, { delay: 12 });
  await page.waitForTimeout(300);
  await askBox.getByTestId("contract-ask").click();
  const answer = askBox.getByTestId("contract-answer");
  await clock.cut("contract question answered", () => expect(answer).toBeVisible({ timeout: 110_000 }), 300);
  const { text: catererText } = await (await page.request.get(`/api/contracts/${page.url().split("/").pop()}`)).json();
  const quote = await answer.getByTestId("contract-quote").innerText();
  expect(flat(catererText), "the quote on screen is the contract's own words").toContain(flat(quote));
  const section = await answer.getByTestId("contract-section").innerText();
  await scrollTo(page, answer, 150);
  const answerFrom = clock.raw;
  await highlight(page, answer, 4800);
  await caption(page, `${section}: "${quote}" Code found these exact words in the contract.`, { ms: 4400, over: answer, position: "top" });
  const answerShown = clock.onCamera(answerFrom, clock.raw);
  console.log(`[demo] contract answer on camera ${answerShown.toFixed(1)}s`);
  expect(answerShown, "the quoted clause holds on camera").toBeGreaterThanOrEqual(ANSWER_ON_CAMERA_S);
  await scrollTo(page, page.getByTestId("confirm-terms"), 200);
  await page.getByTestId("confirm-terms").click();
  await check("ask");

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
  clock.say(6, "Five contracts, one timeline: every deposit and balance, in date order.");
  await highlight(page, list, 5600);
  await caption(page, "Five contracts, one timeline, in date order.", { ms: 4400, over: list, position: "top" });
  const timelineShown = clock.onCamera(timelineFrom, clock.raw);
  console.log(`[demo] five-contract timeline on camera ${timelineShown.toFixed(1)}s`);
  expect(timelineShown, "the five-contract timeline holds on camera").toBeGreaterThanOrEqual(HOLD_ON_CAMERA_S);
  await check("contracts");

  // Beat 5: asked for more than the contract says, code checks the amount before any model runs,
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
  clock.say(7, "Asked for $5,000, code checks the contract before the model runs. The Guard refuses.");
  await highlight(page, refusal, 5200);
  await caption(page, "Asked to pay the caterer $5,000, code checks the signed contract before the model runs, and the Guard refuses. Nothing is sent.", { ms: 4400, over: refusal, position: "top" });
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
  clock.say(8, `The agent puts the overdue${asked ? ` ${asked}` : ""} deposit first, then a cash plan.`);
  await highlight(page, messages, 3400);
  await caption(page, "The agent puts the overdue deposit first, explains the cash clash and proposes a plan the contracts allow.", { ms: 3400, over: messages, position: "top" });
  await check("agent");

  // Beat 6, the florist's reply, in three steps of its own, 18 s at least: (1) her phone, from the
  // link the couple send; (2) the date read from her words, and checked by code; (3) the couple approve.
  const ask = page.locator('[data-testid="cash-move"][data-item="florist.balance"]');
  await scrollTo(page, ask, 150);
  const may = page.locator('[data-testid="cash-chart-month"][data-month="2027-05"]');
  const mayBefore = Number(await may.getAttribute("data-total-cents"));
  const vendorFrom = clock.raw;
  clock.say(9, "Step one: the plan asks the florist for a later date. She answers on her phone.");
  await highlight(page, ask, 1400);
  await ask.getByTestId("move-share").click();
  const link = await ask.getByTestId("move-link").inputValue();
  // The link box opens inside the card; bring the card back down under the top caption.
  await scrollTo(page, ask, 150);
  await caption(page, "1 · The couple send the florist a link themselves. The app doesn't email it.", { ms: 1600, over: ask, position: "top" });
  // The florist's phone comes up on the left once its page is drawn; the caption keeps to the right half.
  const vendor = await phone(page, new URL(link).pathname, { side: "left", ready: "vendor-ask", clock, watch: live.watch });
  await phoneIsReal(page, vendor);
  const phoneShell = page.locator("#__demo_phone");
  await caption(page, "1 · On her phone, the florist taps Another date, writes the 8th, and gives her PayPal email.", { ms: 6000, wait: false, over: phoneShell, position: "top", side: "right" });
  await page.waitForTimeout(500);
  await vendor.getByTestId("vendor-answer-other").click();
  await page.waitForTimeout(400);
  await vendor.getByTestId("vendor-text").pressSequentially("The 5th is tight, the 8th is fine", { delay: 45 });
  await page.waitForTimeout(500);
  await vendor.getByTestId("vendor-paypal-email").fill(sandbox ? sandboxPayeeFor("florist") : "payments@bramble-vetch.example.com");
  await page.waitForTimeout(500);
  await vendor.getByTestId("vendor-send").click();
  await expect(vendor.getByTestId("vendor-sent")).toBeVisible();
  await page.waitForTimeout(900);
  await closePhone(page);
  await clearOverlays(page);
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
  }, 300);
  await scrollTo(page, move, 150);
  const moveTo = (await move.innerText()).match(/to (\w{3}, \w{3} \d{1,2}, \d{4})/)?.[1];
  expect(moveTo, "the move names the date read").toBeTruthy();
  clock.say(10, `Step two: ${reader} reads ${moveTo}, and code checks it.`);
  await highlight(page, move, 4000);
  await caption(page, `2 · ${reader} read: ${moveTo}. Code checked it's before the wedding.`, { ms: 4000, over: move, position: "top" });
  clock.say(11, "Step three: the couple approve, and May drops by the florist's balance.");
  await highlight(page, move.getByTestId("approve-button"), 1600);
  await caption(page, "3 · The couple approve the new date.", { ms: 1600, over: move, position: "top" });
  await move.getByTestId("approve-button").click();
  await clock.cut("move saved", () => expect(ask.getByTestId("move-done")).toBeVisible({ timeout: 30_000 }), 600);
  await dismissToasts(page);
  await expect(may).not.toHaveAttribute("data-total-cents", String(mayBefore));
  const card = page.getByTestId("cash-card");
  await scrollTo(page, card, 20);
  await highlight(page, card, 2200);
  await caption(page, `3 · Approved: moved to ${moveTo}. May drops by the florist's balance.`, { ms: 2200, over: card, position: "bottom" });
  const vendorShown = clock.onCamera(vendorFrom, clock.raw);
  console.log(`[demo] vendor reply, three steps, on camera ${vendorShown.toFixed(1)}s`);
  expect(vendorShown, "the vendor's reply holds on camera").toBeGreaterThanOrEqual(VENDOR_BEAT_S);
  await check("vendor link");

  // Beat 7: the one approval, then PayPal's checkout for exactly the deposit, 8 to 10 s of it on camera.
  await scrollTo(page, prompt, 170);
  clock.say(12, "One approval, then the couple pay it in PayPal.");
  await highlight(page, prompt, 2400);
  await caption(page, "Nothing moves without the couple. One approval, then they pay it in PayPal.", { ms: 3200, over: prompt, position: "top" });
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
    clock.say(13, `In PayPal's own checkout, for exactly ${asked ?? "that amount"}, with the sandbox test card.`);
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
    clock.say(13, `Checkout, for exactly ${asked ?? "the confirmed amount"}.`);
    await caption(page, "Checkout, for exactly the confirmed amount.", { ms: PAY_HOLD_S * 1000 + 400, position: "bottom" });
    const shown = clock.onCamera(checkoutFrom, clock.raw);
    console.log(`[demo] checkout on camera ${shown.toFixed(1)}s`);
    expect(shown, "the checkout holds on camera").toBeGreaterThanOrEqual(PAY_HOLD_S);
    expect(shown).toBeLessThanOrEqual(PAY_HOLD_MAX_S);
    await page.getByTestId("mock-approve").click();
  }
  await check("checkout");

  // Beat 8: paid, from PayPal's own record and its webhook, with its receipt read back from PayPal
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
  clock.say(14, sandbox ? `Paid${byWebhook ? ", and PayPal's webhook confirmed it" : ""}. The receipt is read back from PayPal: capture, webhook, debug_id.` : "Paid. The receipt shows the capture, the webhook and each debug_id.");
  await highlight(page, receipt, PAY_HOLD_S * 1000);
  await caption(page, sandbox ? `Paid: capture COMPLETED${byWebhook ? ", PayPal's webhook event" : ""}, and each call's debug_id, read back from PayPal.` : "Paid. The capture reads COMPLETED, with its webhook and debug_ids.", { ms: PAY_HOLD_S * 1000 - 400, over: receipt, position: "top" });
  const receiptShown = clock.onCamera(receiptFrom, clock.raw);
  console.log(`[demo] receipt on camera ${receiptShown.toFixed(1)}s`);
  expect(receiptShown, "the receipt holds on camera").toBeGreaterThanOrEqual(PAY_HOLD_S);
  await clearOverlays(page);
  await receipt.getByTestId("receipt-close").click({ timeout: 5_000 }).catch(() => undefined);
  await check("paid");

  // Beat 9: the activity behind it, every PayPal call the app made (create order, capture, the
  // re-reads), each with its HTTP status and PayPal's debug_id.
  const activity = page.getByTestId("activity-panel");
  await activity.locator("summary").click();
  const calls = activity.locator('[data-testid="tool-call-timeline"] [data-testid="timeline-step"][data-kind="paypal"]');
  await expect(calls.first()).toBeVisible({ timeout: 10_000 });
  await expect(calls.first()).toContainText("debug_id");
  await scrollTo(page, activity, 150);
  clock.say(15, "And the activity: every PayPal call behind it, with PayPal's own debug_id.");
  await highlight(page, activity, 4800);
  await caption(page, "Every PayPal call behind it, with PayPal's debug_id.", { ms: 4400, over: activity, position: "top" });
  await check("activity");

  // The end card: what it does, and the live URL to try it.
  await clearOverlays(page);
  clock.say(16, `${reader} reads, code checks, you approve, PayPal pays. Try it live.`);
  await titleCard(page, "For couples paying wedding vendors", `One timeline, a cash plan the contracts allow, each vendor paid in PayPal.<br>Try it: ${LIVE_URL}`, 4800, { stay: true });
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
  if (voice.short.length) console.log(`[demo] Beats too short: ${voice.short.join("; ")}`);
  const after = await (await page.request.get("/api/kit/status")).json();
  console.log(`[demo] PayPal ${after.paypal.mode}, AI ${after.ai.mode}, AI spend today: ${JSON.stringify(after.ai.budget)}`);
  console.log(`[demo] Paid: ${await deposit.getByTestId("paypal-proof").innerText()}`);
  console.log(`[demo] Answer: ${section}: ${quote}`);
  console.log(`[demo] Cut video ${edit.videoSeconds.toFixed(1)}s, raw ${Math.round(clock.raw)}s. Cuts: ${JSON.stringify(edit.cuts.map((c) => `${c.label} ${c.from.toFixed(1)}-${c.to.toFixed(1)}`))}`);
  expect(edit.videoSeconds).toBeLessThanOrEqual(DEMO_LIMIT_SECONDS);
  expect(edit.videoSeconds, "long enough to breathe").toBeGreaterThanOrEqual(DEMO_MIN_SECONDS);
  expect(voice.lines[0].at, "the voiceover starts at 0 s").toBeLessThanOrEqual(0.1);
  expect(voice.tooLong, "every voiceover line fits at 15 characters a second").toEqual([]);
  expect(coveredCaptions, "captions covering what they describe").toEqual([]);
  expect(voice.short, "every narrated beat holds at least 4 s on screen").toEqual([]);
});
