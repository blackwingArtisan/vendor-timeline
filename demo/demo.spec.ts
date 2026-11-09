/**
 * DEMO VIDEO (npm run demo:record). Tells the product's story in a real browser and saves a .webm
 * to videos/, with its edit list beside it (.cuts.json): the waits to cut (PayPal's page loading, the
 * webhook on its way) and every moment a spinner, skeleton or page load was on screen.
 * `npm run demo:mp4` applies the cuts, so the video has none of those frames and stays under 2:00.
 * It opens on the couple's problem (the landing headline and the cash check), then the photographer's
 * PDF uploaded on camera. Every narrated line holds at least 4 s on screen, PayPal's checkout 5 to 8 s,
 * and a caption that would cover what it describes moves to the top. A phone is only filmed once its
 * page is drawn. No pinned clock: every date on screen is the recording date.
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
import { caption, clearOverlays, closePhone, coveredCaptions, DemoClock, highlight, mark, phone, titleCard, watchMockText } from "./captions";
import { openCardForm, payAsGuest } from "../tests/e2e/pay-in-checkout";
import { sandboxPayeeFor } from "../tests/e2e/paypal-reread";
import { amountText, formatCents } from "../src/lib/wedding/cents";
import { CATERER, CATERER_STATED_BALANCE_CENTS, FLORIST, MESSY_VENUE_ANSWERS, MESSY_VENUE_FEES_CENTS, SAMPLE_PDF } from "../src/lib/wedding/samples";

/** The cut video stays under 2:00. */
const DEMO_LIMIT_SECONDS = 118;
/** The caterer's "the contract says X, but total minus deposit is Y" flag is on camera at least this long. */
const FLAG_ON_CAMERA_S = 5;

/** PayPal's checkout gets at most this long on camera. */
const CHECKOUT_ON_CAMERA_MS = 8_000;
/** The Guard's refusal and PayPal's checkout each hold at least this long in the cut, or the take fails. */
const HOLD_ON_CAMERA_S = 5;
/** The illustrative parent who pays one vendor. */
const PARENT = "Linda";

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
  // dark), which fades to the landing page.
  await clock.cut("opening", async () => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    clock.sync();
    await titleCard(page, "Wedding Vendor Timeline", "", 1200);
  });

  // Shot 1: the couple's problem, in the landing page's own headline.
  const headline = page.getByRole("heading", { level: 1 });
  clock.say(1, "Couples pay about 13 vendors, each on its own dates.");
  await highlight(page, headline, 4200);
  await caption(page, "For couples paying about 13 wedding vendors (The Knot 2026).", { ms: 2400, over: headline, position: "top" });

  // Shot 2: the cash check, worked out in code from the five sample contracts.
  const cash = page.getByTestId("landing-cash");
  await scrollTo(page, cash, 70);
  const pileText = await page.getByTestId("landing-cash-warning").innerText();
  const pile = dollars(pileText)[0];
  const budget = dollars(await cash.innerText()).at(-1);
  clock.say(2, `Code finds ${pile ?? "too much"} due in one month.`);
  await highlight(page, cash, 5000);
  await caption(page, `Code's cash check: ${pile ?? "too much"} due in one month, against a ${budget ?? "monthly"} budget.`, { ms: 3100, over: cash, side: "left", position: "bottom" });
  await check("problem");

  // Shot 3: the photographer's contract, uploaded as a PDF on camera; the app pulls its text out.
  await clock.cut("to the contracts", async () => {
    await page.goto("/timeline");
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
  clock.say(3, "The couple upload each contract. Here, the photographer's PDF.");
  await highlight(page, uploadButton, 1400);
  await expect(async () => {
    await page.getByTestId("upload-contract").setInputFiles(`public/sample-contracts/${SAMPLE_PDF}`);
    await expect(contractText).toHaveValue(/\S{20}/, { timeout: 4_000 });
  }).toPass({ timeout: 30_000 });
  await highlight(page, contractText, 2600);
  await caption(page, `${SAMPLE_PDF}, uploaded. The app pulls the text out of the PDF.`, { ms: 2600, over: contractText, position: "bottom" });
  await check("contract");

  // Shot 4: read, each term beside its sentence.
  await page.getByTestId("read-contract").click();
  await clock.cut("contract read", () => page.waitForURL(/\/contracts\/ctr_/, { timeout: 90_000 }), 1200);
  await expect(page.getByTestId("confirm-terms")).toBeEnabled();
  const source = page.getByTestId("source-deposit");
  await scrollTo(page, page.getByTestId("term-deposit"), 150);
  await mark(source, 5600);
  clock.say(4, `${aiLive ? "Claude reads the terms. " : ""}Each amount sits beside its sentence; nothing counts until confirmed.`);
  await highlight(page, source, 5600);
  await caption(page, aiLive ? "Claude reads the payment terms. Each amount and date sits beside the sentence it came from." : "The payment terms, each amount and date beside the sentence it came from.", { ms: 2600, over: source, position: "top" });
  await caption(page, "Nothing reaches the timeline until you confirm it.", { ms: 1800, over: source, position: "top" });
  await page.getByTestId("confirm-terms").click();
  await check("pdf");

  // Shot 5: the caterer's contract gets its own sum wrong, and code catches it. Loading the sample
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
  await mark(flag, 5000);
  clock.say(5, "The caterer's contract gets its own sum wrong. Code flags it.");
  await highlight(page, flag, 5000);
  await caption(page, `The contract says the balance is ${formatCents(CATERER_STATED_BALANCE_CENTS)}. Its own total minus deposit is ${formatCents(CATERER.balanceCents)}, so code flags it.`, { ms: 4400, over: flag, position: "top" });
  const flagShown = clock.onCamera(flagFrom, clock.raw);
  console.log(`[demo] caterer flag on camera ${flagShown.toFixed(1)}s`);
  expect(flagShown).toBeGreaterThanOrEqual(FLAG_ON_CAMERA_S);
  await page.getByTestId("confirm-terms").click();

  // Shot 6: a messy contract. The fee is stated two ways, so it's left blank and flagged; the couple
  // type the figure the venue confirms, and the 30% deposit follows. It isn't confirmed here.
  await clock.cut("messy contract read", async () => {
    await page.waitForURL(/\/timeline/);
    // The other three are the labelled samples (added before the messy venue, which stays unconfirmed).
    await page.request.post("/api/contracts/samples");
    await page.goto("/contracts");
    await expect(page.getByTestId("contracts-loaded")).toBeAttached();
    await page.getByTestId("sample-messy").click();
    await expect(page.getByTestId("contract-text")).toHaveValue(/LARKSPUR/, { timeout: 30_000 });
    await page.getByTestId("read-contract").click();
    await page.waitForURL(/\/contracts\/ctr_/, { timeout: 90_000 });
  }, 400);
  const totalTerm = page.getByTestId("term-total");
  await expect(page.getByTestId("flag-total")).toBeVisible();
  await scrollTo(page, totalTerm, 160);
  clock.say(6, "A messy contract states its fee two ways. Code leaves it blank until the couple fill it in.");
  await highlight(page, page.getByTestId("flag-total"), 3200);
  await caption(page, `A messy venue contract gives its fee two ways, ${MESSY_VENUE_FEES_CENTS.map((c) => formatCents(c).replace(".00", "")).join(" and ")}, so it stays blank.`, { ms: 2400, over: totalTerm, position: "top" });
  await page.getByLabel("Total", { exact: true }).pressSequentially(amountText(MESSY_VENUE_ANSWERS.totalCents), { delay: 70 });
  const depositTerm = page.getByTestId("term-deposit");
  await highlight(page, depositTerm, 2800);
  await caption(page, "The couple type the fee the venue confirms. The 30% deposit follows; nothing counts until they confirm.", { ms: 2400, over: depositTerm, position: "top" });
  await check("messy");

  // Shot 7: the other three are the labelled samples, already read the same way.
  await clock.cut("to the timeline", async () => {
    await page.goto("/timeline");
    await expect(page.getByTestId("timeline-item")).toHaveCount(10);
  });
  const overdue = page.locator('[data-testid="timeline-item"][data-role="florist"][data-kind="deposit"]');
  await scrollTo(page, overdue, 160);
  clock.say(7, "Now one timeline for all five vendors. The florist's deposit is overdue.");
  await highlight(page, overdue, 4000);
  await caption(page, `With the other three, one timeline for all five. The florist's ${formatCents(FLORIST.depositCents)} deposit is already overdue.`, { ms: 3200, over: overdue, position: "top" });
  await check("contracts");

  // Shot 8: asked for more than the contract says, code checks the amount before any model runs,
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
  clock.say(8, "Asked for $5,000, code checks the contract before the model runs. The Guard refuses.");
  await highlight(page, refusal, 5200);
  await caption(page, "Asked to pay the caterer $5,000, code checks the signed contract before the model runs, and the Guard refuses. Nothing is sent.", { ms: 5000, over: refusal, position: "top" });
  const refusalShown = clock.onCamera(refusalFrom, clock.raw);
  console.log(`[demo] Guard refusal on camera ${refusalShown.toFixed(1)}s`);
  expect(refusalShown, "the Guard's refusal holds on camera").toBeGreaterThanOrEqual(HOLD_ON_CAMERA_S);
  await check("guard");

  // Shot 9: the real ask. Urgent first, with code's cash plan.
  await scrollTo(page, panel, 20);
  await goal.fill(realAsk);
  await page.getByTestId("ask-agent").click();
  const prompt = panel.getByTestId("approval-prompt").first();
  await clock.cut("agent", () => expect(prompt).toBeVisible({ timeout: 90_000 }), 1000);
  await page.screenshot({ path: "docs/screenshot.png" });
  const asked = dollars(await prompt.innerText())[0];
  const messages = panel.getByTestId("agent-messages");
  await scrollTo(page, messages, 170);
  clock.say(9, `The agent puts the overdue${asked ? ` ${asked}` : ""} deposit first, then a cash plan.`);
  await highlight(page, messages, 2000);
  await caption(page, "The agent puts the overdue deposit first, explains the cash clash and proposes a plan the contracts allow.", { ms: 3600, over: messages, position: "top" });
  await check("agent");

  // Shots 10 to 12: the cash plan asks the florist for a later date, through a link the couple
  // send. The florist answers on a phone; the date is read and checked; the couple approve the move.
  const ask = page.locator('[data-testid="cash-move"][data-item="florist.balance"]');
  await scrollTo(page, ask, 150);
  const may = page.locator('[data-testid="cash-chart-month"][data-month="2027-05"]');
  const mayBefore = Number(await may.getAttribute("data-total-cents"));
  clock.say(10, "The plan asks the florist for a later date, by link.");
  await highlight(page, ask, 1000);
  await ask.getByTestId("move-share").click();
  const link = await ask.getByTestId("move-link").inputValue();
  // The link box opens inside the card; bring the card back down under the top caption.
  await scrollTo(page, ask, 150);
  await caption(page, "The couple send the vendor a link themselves. The app doesn't email it.", { ms: 2600, over: ask, position: "top" });
  // The florist's phone comes up on the left once its page is drawn, beside the couple's card.
  const vendor = await phone(page, new URL(link).pathname, { side: "left", ready: "vendor-ask", clock });
  clock.say(11, "The florist taps Another date, types the 8th, and adds a PayPal email.");
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
  clock.say(12, `${aiLive ? "Claude" : "The app"} reads the 8th, code checks it, and the couple approve the move.`);
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

  // Shot 13: the one approval, then PayPal's checkout, 5 to 8 s of it on camera.
  await scrollTo(page, prompt, 170);
  clock.say(13, "One approval, then the couple pay it in PayPal.");
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
    clock.say(14, `In PayPal's own checkout, for exactly ${asked ?? "that amount"}, with the sandbox test card.`);
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
    clock.say(14, `Checkout, for exactly ${asked ?? "the confirmed amount"}.`);
    await caption(page, "Checkout, for exactly the confirmed amount.", { ms: 5400, position: "bottom" });
    const shown = clock.onCamera(checkoutFrom, clock.raw);
    console.log(`[demo] checkout on camera ${shown.toFixed(1)}s`);
    expect(shown, "the checkout holds on camera").toBeGreaterThanOrEqual(HOLD_ON_CAMERA_S);
    await page.getByTestId("mock-approve").click();
  }
  await check("checkout");

  // Shot 15: paid, from PayPal's own record and its webhook, with its receipt.
  const deposit = page.locator(`[data-testid="timeline-item"][data-role="florist"][data-kind="deposit"]`);
  await clock.cut("PayPal webhook on its way", () => expect(deposit.getByTestId("item-status")).toHaveText("Paid", { timeout: 200_000 }), 1200);
  // A webhook over a minute late (PayPal's sandbox has taken 58 s) shows first as the re-read; wait for it off camera.
  if (/hadn't come after a minute/.test(await deposit.getByTestId("paid-by").innerText())) {
    await clock.cut("PayPal webhook, late", () => expect(deposit.getByTestId("paid-by")).toContainText("Confirmed by PayPal webhook", { timeout: 150_000 }).catch(() => undefined), 800);
  }
  await deposit.getByTestId("receipt-open").click();
  const receipt = deposit.getByTestId("receipt");
  await clock.cut("receipt from PayPal", () => expect(receipt.getByTestId("receipt-capture-id")).toHaveText(/\S/, { timeout: 30_000 }), 600);
  await scrollTo(page, deposit, 190);
  const confirmedBy = await deposit.getByTestId("paid-by").innerText();
  const byWebhook = confirmedBy.startsWith("Confirmed by PayPal webhook");
  clock.say(15, sandbox ? `Paid${byWebhook ? ", and PayPal's webhook confirmed it" : ""}. The receipt is read back from PayPal.` : "Paid, with its receipt.");
  await highlight(page, deposit, 5400);
  await caption(page, sandbox ? `Paid: COMPLETED${byWebhook ? ", and PayPal's webhook arrived" : ""}. The receipt is read back from PayPal.` : "Paid. The capture reads COMPLETED, with its receipt.", { ms: 4000, over: deposit, position: "top" });
  await receipt.getByTestId("receipt-close").click({ timeout: 5_000 }).catch(() => undefined);
  await check("paid");

  // Shots 16 and 17: a parent pays one vendor. "Assign" makes a link for Linda (Illustrative); her
  // phone asks to pay; the couple approve; she pays in her own PayPal checkout, off camera; the row
  // says who paid, and that it went to the account the florist gave on the reply link.
  const balance = page.locator(`[data-testid="timeline-item"][data-role="florist"][data-kind="balance"]`);
  await scrollTo(page, balance, 150);
  clock.say(16, `A parent can pay one vendor. Assign makes a link for ${PARENT} alone.`);
  await balance.getByTestId("assign-open").click({ timeout: 10_000 });
  await balance.getByTestId("assign-name").pressSequentially(PARENT, { delay: 60, timeout: 10_000 });
  await balance.getByTestId("assign-save").click({ timeout: 10_000 });
  const parentLink = await clock.cut("making Linda's link", () => balance.getByTestId("assign-link").inputValue({ timeout: 10_000 }), 400);
  await highlight(page, balance, 1800);
  await caption(page, `${PARENT} (an illustrative parent) gets a link for the florist's balance only.`, { ms: 1600, over: balance, position: "top" });
  const parentPhone = await phone(page, new URL(parentLink).pathname, { side: "left", ready: "contrib-ask", clock });
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
  await expect(balance.getByTestId("paid-to-own")).toContainText("Paid to the florist's own PayPal");
  clock.say(17, `${PARENT} pays in her own PayPal, to the florist's own account.`);
  await highlight(page, balance, 5000);
  await caption(page, `Paid by ${PARENT}'s PayPal, to the florist's own account, not the app's.`, { ms: 3600, over: balance, position: "top" });
  await check("parent");

  // The end card: who it's for and what happened, on a clear screen.
  await clearOverlays(page);
  clock.say(18, `For couples paying vendors: ${aiLive ? "Claude" : "the app"} reads, code checks, you approve, PayPal pays.`);
  await titleCard(page, "For couples paying wedding vendors", `One timeline, a cash plan the contracts allow, each vendor paid in PayPal.<br>On the sample wedding: the overdue ${asked ? `${asked} ` : ""}deposit paid, the florist's balance moved, then paid by ${PARENT}.`, 5200, { stay: true });
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
  console.log(`[demo] Paid by ${PARENT}: ${await balance.getByTestId("paypal-proof").innerText()}`);
  console.log(`[demo] Cut video ${edit.videoSeconds.toFixed(1)}s, raw ${Math.round(clock.raw)}s. Cuts: ${JSON.stringify(edit.cuts.map((c) => `${c.label} ${c.from.toFixed(1)}-${c.to.toFixed(1)}`))}`);
  expect(edit.videoSeconds).toBeLessThan(DEMO_LIMIT_SECONDS);
  expect(coveredCaptions, "captions covering what they describe").toEqual([]);
  expect(voice.short, "every narrated beat holds at least 4 s on screen").toEqual([]);
});
