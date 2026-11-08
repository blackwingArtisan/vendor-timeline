/**
 * The whole story in a real browser: contracts in, terms checked, one timeline out, then a real
 * vendor payment after a person approves it, paid by the couple in PayPal's checkout. `npm run test:e2e`
 * runs it on mock PayPal; `npm run test:e2e:sandbox` runs it on the PayPal sandbox, pays on PayPal's own
 * checkout page with the test card, and re-reads the order and capture straight from PayPal. AI is mocked unless E2E_AI_MODE=live, which then reads only the photographer's contract.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { payInCheckout } from "./pay-in-checkout";
import { readCapture, readCaptureEvent, readOrder, sandboxSellerEmail } from "./paypal-reread";
import { formatCents, sumCents } from "../../src/lib/wedding/cents";
import { formatDay } from "../../src/lib/wedding/dates";
import { BAND, BAND_ANSWERS, CATERER, CATERER_STATED_BALANCE_CENTS, FLORIST, PHOTOGRAPHER, SAMPLES, VENUE, type SampleFacts } from "../../src/lib/wedding/samples";

/** Pinned so the florist's deposit is overdue and the photographer's comes next, whatever the real date. */
const TODAY = "2026-11-20";
const HOSTED = !!process.env.E2E_BASE_URL;
const REMOVED_KIT_PAGES = ["/example", "/dashboard"];
/** The kit's routes that moved money with no Guard. Payments here only go through the approval gate. */
const OPEN_PAYPAL_ROUTES = ["/api/paypal/orders", "/api/paypal/captures/X/refund", "/api/paypal/authorizations/X/capture", "/api/paypal/authorizations/X/void"];
/** The band's contract gives no usable date, so the couple types this one in. */
const BAND_BALANCE_DUE = BAND_ANSWERS.balanceDue;

const sampleText = (s: SampleFacts) => readFileSync(`public/sample-contracts/${s.file}`, "utf8");
const item = (page: Page, s: SampleFacts, kind: "deposit" | "balance") => page.locator(`[data-testid="timeline-item"][data-role="${s.vendorRole}"][data-kind="${kind}"]`);

async function pickSample(page: Page, s: SampleFacts) {
  await page.goto("/contracts");
  // A click in the first moments of a page does nothing, for a person too, so click again.
  await expect(async () => {
    await page.getByTestId(`sample-${s.vendorRole}`).click();
    await expect(page.getByTestId("contract-text")).toHaveValue(sampleText(s), { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
}

async function read(page: Page) {
  await page.getByTestId("read-contract").click();
  await page.waitForURL(/\/contracts\/ctr_/, { timeout: 90_000 });
}

async function confirm(page: Page) {
  await expect(page.getByTestId("confirm-terms")).toBeEnabled();
  await page.getByTestId("confirm-terms").click();
  await page.waitForURL(/\/timeline/);
}

function expectSource(term: Locator, words: string) {
  return expect(term).toContainText(words);
}

async function expectCheckedTerms(page: Page, s: SampleFacts) {
  await expect(page.getByLabel("Vendor name")).toHaveValue(s.vendorName);
  await expect(page.getByLabel("Total", { exact: true })).toHaveValue((s.totalCents / 100).toFixed(2));
  await expect(page.getByLabel("Deposit", { exact: true })).toHaveValue((s.depositCents / 100).toFixed(2));
  await expect(page.getByLabel("Deposit due")).toHaveValue(s.depositDue);
  await expect(page.getByTestId("balance-value")).toHaveText(formatCents(s.balanceCents));
  for (const name of ["total", "deposit", "deposit-due"]) {
    await expect(page.getByTestId(`source-${name}`)).not.toContainText("No sentence in the contract");
  }
}

test("contracts in, one timeline out, and a vendor paid only after a person approves", async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  const api = page.request;
  const status = await (await api.get("/api/kit/status")).json();
  const sandbox = status.paypal.mode === "sandbox";
  const live = status.ai.mode === "live";
  const confirmedSamples = live ? [PHOTOGRAPHER] : SAMPLES;

  // The front door describes this product, and nothing from the starter kit is left to reach.
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Never lose a vendor to a missed deposit.");
  await expect(page.getByTestId("landing-preview")).toContainText(PHOTOGRAPHER.vendorName);
  await expect(page.getByTestId("landing-preview")).toContainText(formatCents(PHOTOGRAPHER.depositCents));
  await expect(page.locator("body")).not.toContainText("$80.00");
  await page.screenshot({ path: "screenshots/landing.png" });
  for (const path of REMOVED_KIT_PAGES) expect((await api.get(path)).status()).toBe(404);
  for (const path of OPEN_PAYPAL_ROUTES) expect((await api.post(path, { data: {} })).status()).toBe(404);
  await expect(page.locator(`a[href="/example"], a[href="/dashboard"]`)).toHaveCount(0);

  // A new visitor starts on the sample plan. Their own plan starts empty.
  await page.goto("/timeline");
  await expect(page.getByTestId("sample-plan")).toBeVisible();
  await page.getByTestId("start-own-plan").click();
  await expect(page.getByText("Nothing confirmed yet")).toBeVisible();
  await expect(page.getByTestId("sample-plan")).toHaveCount(0);

  // Photographer: sample text in the box, terms beside their sentences.
  await pickSample(page, PHOTOGRAPHER);
  await read(page);
  await expectCheckedTerms(page, PHOTOGRAPHER);
  await expectSource(page.getByTestId("source-deposit"), "non-refundable");
  await expect(page.getByTestId("read-by")).toContainText(live ? "Read by Claude" : "Simulated read");
  await page.screenshot({ path: `screenshots/review-${live ? "live-ai" : "mock-ai"}.png`, fullPage: true });
  if (live) {
    const read = await (await api.get(`/api/contracts/${new URL(page.url()).pathname.split("/").pop()}`)).json();
    console.log(`Real AI read: ${JSON.stringify({ read: read.read, proposed: read.proposed })}`);
  }

  // Not on the timeline until confirmed.
  const unconfirmed = page.url();
  await page.goto("/timeline");
  await expect(page.getByText("Nothing confirmed yet")).toBeVisible();
  await page.goto(unconfirmed);
  await confirm(page);
  await expect(item(page, PHOTOGRAPHER, "deposit")).toBeVisible();

  if (!live) {
    // Caterer: uploaded as a file. The contract's own balance is wrong, so it's flagged, and the app's sum wins.
    await page.goto("/contracts");
    await expect(async () => {
      await page.getByTestId("upload-contract").setInputFiles(`public/sample-contracts/${CATERER.file}`);
      await expect(page.getByTestId("contract-text")).toHaveValue(sampleText(CATERER), { timeout: 2_000 });
    }).toPass({ timeout: 30_000 });
    await read(page);
    await expectCheckedTerms(page, CATERER);
    await expect(page.getByTestId("flag-balance")).toContainText(formatCents(CATERER_STATED_BALANCE_CENTS));
    await confirm(page);

    // Venue: pasted in by hand.
    await page.goto("/contracts");
    await page.getByTestId("contract-text").fill(sampleText(VENUE));
    await read(page);
    await expectCheckedTerms(page, VENUE);
    await confirm(page);

    // Florist: deposit date already passed.
    await pickSample(page, FLORIST);
    await read(page);
    await expectCheckedTerms(page, FLORIST);
    await confirm(page);

    // Band: two terms are missing or unclear, so they're flagged and blank, and block confirming.
    await pickSample(page, BAND);
    await read(page);
    await expect(page.getByLabel("PayPal email to pay")).toHaveValue("");
    await expect(page.getByLabel("Balance due")).toHaveValue("");
    await expect(page.getByTestId("flag-email")).toBeVisible();
    await expect(page.getByTestId("flag-balance-due")).toBeVisible();
    await expect(page.getByTestId("confirm-terms")).toBeDisabled();
    await expect(page.getByTestId("still-needed")).toContainText("an email to pay");
    await expect(page.getByTestId("still-needed")).toContainText("the balance date");
    await page.getByLabel("PayPal email to pay").fill(BAND_ANSWERS.payeeEmail);
    await page.getByLabel("Balance due").fill(BAND_BALANCE_DUE);
    await confirm(page);
  }

  // One timeline: every date, every amount, the next one due and a total worked out in code.
  await page.goto("/timeline");
  const unpaidCents = sumCents(confirmedSamples.flatMap((s) => [s.depositCents, s.balanceCents]));
  await expect(page.getByTestId("stat-total")).toContainText(formatCents(unpaidCents));
  for (const s of confirmedSamples) {
    await expect(item(page, s, "deposit").getByTestId("item-amount")).toHaveText(formatCents(s.depositCents));
    await expect(item(page, s, "deposit").getByTestId("item-due")).toHaveText(formatDay(s.depositDue));
    await expect(item(page, s, "balance").getByTestId("item-amount")).toHaveText(formatCents(s.balanceCents));
    await expect(item(page, s, "balance").getByTestId("item-due")).toHaveText(formatDay(s.balanceDue ?? BAND_BALANCE_DUE));
  }
  await expect(page.getByTestId("stat-next")).toContainText(formatCents(PHOTOGRAPHER.depositCents));
  await expect(page.getByTestId("stat-next")).toContainText(PHOTOGRAPHER.vendorName);
  if (!live) {
    await expect(page.getByTestId("stat-overdue")).toContainText(formatCents(FLORIST.depositCents));
    await expect(item(page, FLORIST, "deposit").getByTestId("item-status")).toHaveText("Overdue");
    await expect(item(page, FLORIST, "deposit")).toContainText("28 days overdue");
    await expect(page.getByTestId("today-marker")).toContainText(formatDay(TODAY));
  }

  // "Pay photographer" stops at a person. Nothing has moved.
  const deposit = item(page, PHOTOGRAPHER, "deposit");
  await deposit.getByTestId("pay-item").click();
  await expect(deposit.getByTestId("pay-item")).toHaveCount(0);
  const prompt = deposit.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await expect(prompt).toContainText(`Pay ${PHOTOGRAPHER.vendorName} ${formatCents(PHOTOGRAPHER.depositCents)} for the deposit`);
  await expect(prompt.getByTestId("approval-from")).toHaveText("Your PayPal, in PayPal's checkout");
  await expect(prompt.getByTestId("approval-to")).toHaveText(PHOTOGRAPHER.vendorName);
  await expect(prompt).not.toContainText("balance");
  await expect(prompt.getByTestId("stand-in")).toHaveCount(sandbox ? 1 : 0);
  await expect(deposit.getByTestId("item-status")).toHaveText("Waiting for your approval");
  await expect(deposit.getByTestId("paypal-proof")).toHaveCount(0);
  await expect(page.getByTestId("stat-paid")).toContainText("$0.00");
  await page.screenshot({ path: `screenshots/approval-${sandbox ? "sandbox" : "mock"}.png`, fullPage: true });

  // Approved in the app. Nothing has moved: the couple now pay it themselves in PayPal's checkout.
  await prompt.getByTestId("approve-button").click();
  const box = deposit.getByTestId("checkout-box");
  await expect(box).toBeVisible({ timeout: 60_000 });
  await expect(deposit.getByTestId("item-status")).toHaveText("Approved: pay in PayPal");
  await expect(page.getByTestId("stat-paid")).toContainText("$0.00");
  const orderId = (await box.getByTestId("checkout-order-id").textContent())!;
  const payee = sandbox ? sandboxSellerEmail() : PHOTOGRAPHER.payeeEmail!;
  await expect(box.getByTestId("checkout-payee")).toHaveText(payee);
  if (sandbox) await expect(box.getByTestId("stand-in")).toHaveText(`In the sandbox, this test business account (${payee}) stands in for ${PHOTOGRAPHER.vendorName}.`);
  await payInCheckout(page, box, sandbox);

  // Back from PayPal: captured, then Paid only once PayPal's own record of the capture says so.
  await expect(deposit.getByTestId("item-status")).toHaveText("Paid", { timeout: 200_000 });
  await expect(deposit.getByTestId("paypal-status")).toHaveText("COMPLETED");
  await expect(deposit.getByTestId("paypal-order-id")).toHaveText(orderId);
  await expect(page.getByTestId("stat-paid")).toContainText(formatCents(PHOTOGRAPHER.depositCents));
  await expect(page.getByTestId("stat-total")).toContainText(formatCents(unpaidCents - PHOTOGRAPHER.depositCents));
  if (sandbox) await expect(deposit.getByTestId("paypal-proof").getByTestId("stand-in")).toContainText(`stands in for ${PHOTOGRAPHER.vendorName}`);

  // On mock and on the hosted copy a PayPal webhook for the capture is what marks it paid. A local
  // sandbox run has no public address for PayPal to call, so there the re-read stands in.
  await expect(deposit.getByTestId("paid-by")).toContainText(!sandbox || HOSTED ? "Confirmed by PayPal webhook" : "Confirmed by re-reading the capture");
  const webhookEventId = HOSTED ? await deposit.getByTestId("paid-by-event").textContent() : null;

  // The next one due moves on. A real-AI run has only the photographer, so it's their balance.
  await expect(page.getByTestId("stat-next")).toContainText(formatCents(live ? PHOTOGRAPHER.balanceCents : CATERER.depositCents));

  const captureId = (await deposit.getByTestId("paypal-capture-id").textContent())!;
  expect(captureId).toBeTruthy();
  await deposit.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `screenshots/timeline-after-payment-${sandbox ? "sandbox" : "mock"}.png`, fullPage: true });

  // A paid item stays paid after a reload, and can't be paid twice.
  await page.reload();
  await expect(item(page, PHOTOGRAPHER, "deposit").getByTestId("item-status")).toHaveText("Paid");
  await expect(item(page, PHOTOGRAPHER, "deposit").getByTestId("pay-item")).toHaveCount(0);

  // Audit trail: unbroken, and the payment is in it.
  const audit = await (await api.get("/api/audit")).json();
  expect(audit.integrity.ok).toBe(true);
  await page.goto("/activity");
  await expect(page.getByTestId("audit-row").first()).toBeVisible();
  // The couple's ledger is their own payment and nothing else: this order and its capture.
  const ledger = (await (await api.get("/api/paypal/ledger")).json()).entries as { paypalId: string }[];
  expect(ledger.map((e) => e.paypalId).sort()).toEqual([orderId, captureId].sort());
  if (!sandbox || HOSTED) await expect(page.getByTestId("webhook-row")).toContainText(captureId);

  if (sandbox) {
    // Straight from PayPal: the couple's order, paid to the app's sandbox business account, for exactly the confirmed term.
    const term = { currency_code: "USD", value: (PHOTOGRAPHER.depositCents / 100).toFixed(2) };
    const order = await readOrder(orderId);
    const capture = await readCapture(captureId);
    console.log(`PayPal re-read: order ${order.id} ${order.status}, payee ${order.purchase_units[0].payee.email_address}, capture ${capture.id} ${capture.status} ${capture.amount.value} ${capture.amount.currency_code}`);
    expect(order.status).toBe("COMPLETED");
    expect(order.intent).toBe("CAPTURE");
    expect(order.purchase_units).toHaveLength(1);
    expect(order.purchase_units[0].amount).toMatchObject(term);
    expect(order.purchase_units[0].payee.email_address?.toLowerCase()).toBe(sandboxSellerEmail().toLowerCase());
    expect(order.purchase_units[0].payments?.captures?.map((c) => c.id)).toEqual([captureId]);
    expect(capture.status).toBe("COMPLETED");
    expect(capture.amount).toEqual(term);
    expect(capture.supplementary_data?.related_ids?.order_id).toBe(orderId);
    if (HOSTED) {
      const event = await readCaptureEvent(captureId);
      console.log(`PayPal webhook event: ${event?.id} ${event?.event_type} for capture ${event?.resource.id}`);
      expect(event?.id).toBe(webhookEventId);
    }
  }
});

test("declining a payment moves no money and leaves the item payable", async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  const { ai } = await (await page.request.get("/api/kit/status")).json();
  test.skip(ai.mode === "live", "Each real read costs money, and the first test already proved it.");

  await page.goto("/timeline");
  await page.getByTestId("start-own-plan").click();
  await expect(page.getByText("Nothing confirmed yet")).toBeVisible();
  await pickSample(page, VENUE);
  await read(page);
  await confirm(page);
  const deposit = item(page, VENUE, "deposit");
  await deposit.getByTestId("pay-item").click();
  const prompt = deposit.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await prompt.getByRole("button", { name: "Decline" }).click();
  await expect(deposit.getByTestId("approval-prompt")).toHaveCount(0, { timeout: 30_000 });
  await expect(deposit.getByTestId("pay-item")).toBeVisible();
  await expect(deposit.getByTestId("paypal-proof")).toHaveCount(0);
  await expect(page.getByTestId("stat-paid")).toContainText("$0.00");
});
