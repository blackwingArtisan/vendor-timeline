/**
 * "Five contracts in, one timeline, pay the photographer", with the agent doing the asking.
 * `npm run test:e2e` runs it on mock PayPal and scripted AI. `npm run test:e2e:sandbox` runs it on
 * the real PayPal sandbox and reads the money back from PayPal. E2E_AI_MODE=live uses real Claude.
 * Against the hosted copy (E2E_BASE_URL) a real PayPal webhook must be what marks the payment paid.
 */
import { expect, test, type Page } from "@playwright/test";
import { readFinishedPayout, readPayoutEvent } from "./paypal-reread";
import { formatCents, sumCents } from "../../src/lib/wedding/cents";
import { formatDay } from "../../src/lib/wedding/dates";
import { CATERER, FLORIST, PHOTOGRAPHER, SAMPLES } from "../../src/lib/wedding/samples";

const TODAY = "2026-11-20";
const HOSTED = !!process.env.E2E_BASE_URL;
const clashTotal = CATERER.balanceCents + FLORIST.balanceCents;
const row = (page: Page, role: string, kind: string) => page.locator(`[data-testid="timeline-item"][data-role="${role}"][data-kind="${kind}"]`);

async function fiveContracts(page: Page) {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/timeline");
  await page.getByTestId("load-samples").click();
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
}

async function askAgent(page: Page, goal?: string) {
  if (goal) await page.getByTestId("agent-goal").fill(goal);
  await page.getByTestId("ask-agent").click();
}

test("five contracts, one timeline, and the agent stops before paying the photographer", async ({ page }) => {
  await fiveContracts(page);
  const status = await (await page.request.get("/api/kit/status")).json();
  const sandbox = status.paypal.mode === "sandbox";
  const realAi = status.ai.mode === "live";

  // Every vendor has a deposit and a balance on one timeline, as rows and as bars.
  const allCents = sumCents(SAMPLES.flatMap((s) => [s.depositCents, s.balanceCents]));
  await expect(page.getByTestId("stat-total")).toContainText(formatCents(allCents));
  const sponsor = process.env.NEXT_PUBLIC_SPONSOR_UI === "1";
  if (sponsor) {
    await expect(page.locator(".b-gantt-task-wrap:not(.b-released)").first()).toBeVisible({ timeout: 90_000 });
  } else {
    await expect(page.getByTestId("vendor-bar")).toHaveCount(10);
  }
  for (const s of SAMPLES) {
    await expect(row(page, s.vendorRole, "deposit").getByTestId("item-amount")).toHaveText(formatCents(s.depositCents));
    await expect(row(page, s.vendorRole, "balance").getByTestId("item-amount")).toHaveText(formatCents(s.balanceCents));
    if (!sponsor) {
      await expect(page.locator(`[data-testid="vendor-bar"][data-role="${s.vendorRole}"]`)).toHaveCount(2);
    }
  }

  // The cash check is code, so it's on the page before any AI runs.
  const clash = page.locator('[data-testid="cash-warning"][data-kind="same_week"]');
  await expect(clash).toContainText(`${formatCents(clashTotal)} in one week`);
  await expect(clash).toContainText(CATERER.vendorName);
  await expect(clash).toContainText(FLORIST.vendorName);
  await expect(clash).toContainText("$7,200.00 over your $5,000.00 monthly budget");

  // The agent names the next payment, warns about the clash, and stops.
  await askAgent(page);
  const panel = page.getByTestId("agent-panel");
  const prompt = panel.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 90_000 });
  await expect(prompt).toContainText(`Pay ${PHOTOGRAPHER.vendorName} ${formatCents(PHOTOGRAPHER.depositCents)} for the deposit`);
  await expect(page.getByTestId("agent-phase")).toHaveText("Stopped for your approval");
  const said = await panel.getByTestId("agent-messages").innerText();
  console.log(`Agent said: ${said}`);
  expect(said).toContain(PHOTOGRAPHER.vendorName);
  expect(said).toContain(formatCents(PHOTOGRAPHER.depositCents));
  expect(said).toContain(formatCents(clashTotal));
  if (realAi) {
    // The AI only explains: every dollar figure it wrote must be one the code gave it.
    const view = await (await page.request.get(`/api/timeline?today=${TODAY}`)).json();
    const fromCode = `${JSON.stringify(view.cash.warnings.map((w: { message: string }) => w.message))} ${view.items.map((i: { cents: number }) => formatCents(i.cents)).join(" ")} ${formatCents(view.totalDueCents)}`;
    for (const figure of said.match(/\$[\d,]+(\.\d{2})?/g) ?? []) expect(fromCode).toContain(figure.includes(".") ? figure : `${figure}.00`);
  }
  await page.screenshot({ path: `screenshots/agent-approval-${sandbox ? "sandbox" : "mock"}.png`, fullPage: true });

  // Nothing has moved, and the item waits for the same person.
  const deposit = row(page, "photographer", "deposit");
  await expect(deposit.getByTestId("item-status")).toHaveText("Waiting for your approval");
  await expect(deposit.getByTestId("paypal-proof")).toHaveCount(0);
  await expect(page.getByTestId("stat-paid")).toContainText("$0.00");

  // Yes: the payment goes, and the status is PayPal's.
  await prompt.getByTestId("approve-button").click();
  await expect(deposit.getByTestId("item-status")).toHaveText("Paid", { timeout: 200_000 });
  await expect(deposit.getByTestId("paypal-status")).toHaveText("SUCCESS");
  await expect(page.getByTestId("stat-paid")).toContainText(formatCents(PHOTOGRAPHER.depositCents));
  await expect(page.getByTestId("agent-phase")).toHaveText("Finished", { timeout: 60_000 });
  const proof = await deposit.getByTestId("paypal-proof").innerText();
  console.log(`Proof on screen: ${proof}`);

  const batchId = (await deposit.getByTestId("paypal-batch-id").textContent())!;
  const transactionId = (await deposit.getByTestId("paypal-transaction-id").textContent())!;
  const expectWebhook = !sandbox || HOSTED;
  if (expectWebhook) await expect(deposit.getByTestId("paid-by")).toContainText("Confirmed by PayPal webhook");
  else await expect(deposit.getByTestId("paid-by")).toContainText("Confirmed by");

  // It stays paid and can't go twice, whoever asks.
  await page.reload();
  await expect(row(page, "photographer", "deposit").getByTestId("item-status")).toHaveText("Paid");
  await expect(row(page, "photographer", "deposit").getByTestId("pay-item")).toHaveCount(0);
  await page.screenshot({ path: `screenshots/agent-paid-${sandbox ? "sandbox" : "mock"}.png`, fullPage: true });

  const audit = await (await page.request.get("/api/audit")).json();
  expect(audit.integrity.ok).toBe(true);

  if (sandbox) {
    const payout = await readFinishedPayout(batchId);
    const paid = payout.items[0];
    console.log(`PayPal re-read: batch ${batchId} ${payout.batch_header.batch_status}, item ${paid.transaction_status}, transaction ${paid.transaction_id}, ${paid.payout_item.amount.value} ${paid.payout_item.amount.currency}`);
    expect(payout.items).toHaveLength(1);
    expect(paid.transaction_status).toBe("SUCCESS");
    expect(paid.transaction_id).toBe(transactionId);
    expect(paid.payout_item.amount).toEqual({ currency: "USD", value: (PHOTOGRAPHER.depositCents / 100).toFixed(2) });
    expect(paid.payout_item.receiver).toMatch(/@personal\.example\.com$/);
    if (HOSTED) {
      const eventId = (await row(page, "photographer", "deposit").getByTestId("paid-by-event").textContent())!;
      const event = await readPayoutEvent(batchId);
      console.log(`PayPal webhook event: ${event?.id} ${event?.event_type} for ${event?.resource.payout_batch_id}`);
      expect(event?.id).toBe(eventId);
      expect(event?.resource.payout_item.sender_item_id).toBe(paid.payout_item.sender_item_id);
    }
  }
});

test("a request for too much is refused by code, with no approval and no money", async ({ page }) => {
  await fiveContracts(page);
  const { ai } = await (await page.request.get("/api/kit/status")).json();
  test.skip(ai.mode === "live", "The real-AI run covers the happy path; the unit tests cover every refusal.");

  await askAgent(page, "Pay the photographer $9,000.00 right now.");
  const panel = page.getByTestId("agent-panel");
  await expect(page.getByTestId("agent-phase")).toHaveText("Finished", { timeout: 60_000 });
  await expect(panel).toContainText("$9,000.00 is more than the confirmed deposit of $1,200.00");
  await expect(panel.getByTestId("approval-prompt")).toHaveCount(0);
  await expect(page.getByTestId("approval-prompt")).toHaveCount(0);
  const deposit = row(page, "photographer", "deposit");
  await expect(deposit.getByTestId("paypal-proof")).toHaveCount(0);
  await expect(deposit.getByTestId("pay-item")).toBeVisible();
  await expect(page.getByTestId("stat-paid")).toContainText("$0.00");
  const audit = await (await page.request.get("/api/audit")).json();
  expect(audit.integrity.ok).toBe(true);
});

test("declining the agent's payment moves no money and leaves it payable", async ({ page }) => {
  await fiveContracts(page);
  const { ai } = await (await page.request.get("/api/kit/status")).json();
  test.skip(ai.mode === "live", "Each real run costs money, and the first test already proved the stop.");

  await askAgent(page);
  const prompt = page.getByTestId("agent-panel").getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 60_000 });
  await prompt.getByRole("button", { name: "Decline" }).click();
  await expect(page.getByTestId("agent-phase")).toHaveText("Finished", { timeout: 60_000 });
  const deposit = row(page, "photographer", "deposit");
  await expect(deposit.getByTestId("pay-item")).toBeVisible();
  await expect(deposit.getByTestId("paypal-proof")).toHaveCount(0);
  await expect(page.getByTestId("stat-paid")).toContainText("$0.00");
});

test("a moved date is saved, changes the cash check and survives a reload", async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_SPONSOR_UI === "1", "gantt.spec.ts drags the same thing.");
  await fiveContracts(page);
  const clash = page.locator('[data-testid="cash-warning"][data-kind="same_week"]');
  await expect(clash).toHaveCount(1);

  const balance = row(page, "caterer", "balance");
  await balance.getByTestId("move-date").click();
  await balance.getByTestId("move-date-input").fill("2027-05-20");
  await balance.getByTestId("move-date-save").click();
  await expect(balance.getByTestId("item-due")).toHaveText(formatDay("2027-05-20"));
  await expect(balance.getByTestId("item-moved")).toContainText(formatDay(CATERER.balanceDue!));
  await expect(clash).toHaveCount(0);

  await page.reload();
  await expect(row(page, "caterer", "balance").getByTestId("item-due")).toHaveText(formatDay("2027-05-20"));
  await expect(row(page, "caterer", "balance").getByTestId("item-amount")).toHaveText(formatCents(CATERER.balanceCents));
});

test("a new budget changes the warnings and is saved", async ({ page }) => {
  await fiveContracts(page);
  await page.getByTestId("monthly-budget").fill("20,000");
  await page.getByTestId("save-budget").click();
  await expect(page.getByTestId("cash-clear")).toBeVisible();
  await expect(page.getByTestId("cash-warning")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("cash-clear")).toBeVisible();
});
