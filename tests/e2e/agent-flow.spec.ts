/**
 * "Five contracts in, one timeline, pay the most overdue vendor first", with the agent doing the asking
 * and the couple paying in PayPal's checkout. `npm run test:e2e` runs it on mock PayPal and scripted AI.
 * `npm run test:e2e:sandbox` runs it on the real PayPal sandbox, pays on PayPal's own checkout page,
 * and reads the order and capture back from PayPal. E2E_AI_MODE=live uses real Claude.
 * Against the hosted copy (E2E_BASE_URL) a real PayPal webhook must be what marks the payment paid.
 */
import { expect, test, type Page } from "@playwright/test";
import { openCashCheck } from "./open-cash";
import { approveAndPay } from "./pay-in-checkout";
import { readCapture, readCaptureEvent, readOrder, sandboxSellerEmail, sandboxVendorEmail } from "./paypal-reread";
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
  // A new visitor starts on the labelled sample plan, already confirmed.
  await expect(page.getByTestId("sample-plan")).toContainText("Sample plan");
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
}

async function askAgent(page: Page, goal?: string) {
  if (goal) await page.getByTestId("agent-goal").fill(goal);
  await page.getByTestId("ask-agent").click();
}

test("five contracts, one timeline, and the agent puts the overdue florist first and stops before paying", async ({ page }) => {
  // On the hosted copy PayPal's webhook can be over a minute late (58 s seen in the sandbox).
  if (HOSTED) test.setTimeout(480_000);
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
  await expect(clash).toContainText(`${formatCents(clashTotal)} leaves in the week of Sat, May 29, 2027`);
  await expect(clash).toContainText(CATERER.vendorName);
  await expect(clash).toContainText(FLORIST.vendorName);
  await expect(clash).not.toContainText("monthly budget");

  // Each warning opens to the payments, their pay dates and the sum.
  await openCashCheck(page);
  await clash.getByText("Show the sums").click();
  const sums = clash.getByTestId("cash-sums");
  await expect(sums).toContainText("Pays Sat, May 29, 2027");
  await expect(sums).toContainText("Leaves in one week");
  await expect(sums).toContainText(formatCents(clashTotal));
  await expect(sums).not.toContainText("Monthly budget");
  await page.screenshot({ path: "screenshots/cash-sums.png", fullPage: true });

  // The agent puts the overdue florist deposit first, warns about the clash, and stops.
  await askAgent(page);
  const panel = page.getByTestId("agent-panel");
  const prompt = panel.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 90_000 });
  await expect(prompt).toContainText(`Pay ${FLORIST.vendorName} ${formatCents(FLORIST.depositCents)} for the deposit`);
  await expect(page.getByTestId("agent-phase")).toHaveText("Stopped for your approval");
  await expect(prompt).toContainText("This is your money");
  await expect(prompt.getByTestId("approval-from")).toHaveText("Your PayPal, in PayPal's checkout");
  await expect(prompt.getByTestId("approval-to")).toHaveText(FLORIST.vendorName);
  await expect(prompt.getByTestId("approval-budget")).toContainText("monthly budget");
  // In sandbox the florist is paid to a separate vendor test account, not the app's own, named here.
  if (sandbox) {
    await expect(prompt.getByTestId("stand-in")).toHaveAttribute("data-account", "vendor");
    await expect(prompt.getByTestId("stand-in")).toContainText(`separate vendor test business account (${sandboxVendorEmail()}), standing in for ${FLORIST.vendorName}`);
  } else await expect(prompt.getByTestId("stand-in")).toHaveCount(0);
  // Code, not the model, says what comes first, and its sentence leads the panel.
  const first = panel.getByTestId("agent-message").first();
  await expect(first).toHaveAttribute("data-from", "app");
  await expect(first).toContainText(`Pay first: the ${FLORIST.vendorName} deposit, ${formatCents(FLORIST.depositCents)}`);
  await expect(first).toContainText("Overdue comes first.");
  // What the agent did, as a chain code writes from the run, ending where it waits.
  await expect(panel.getByTestId("agent-chain-step")).toHaveText(["Read 5 contracts", "3 cash clashes", "Plan with 2 moves", "Florist deposit ready", "Waiting for you"]);
  // The model's own reply is cut to two sentences; the numbers sit behind "Details".
  const reply = (await panel.getByTestId("agent-reply").innerText()).trim();
  console.log(`Agent reply on show: ${reply}`);
  expect(reply.split(/(?<=[.!?])\s+(?=["'(A-Z0-9$])/).length).toBeLessThanOrEqual(2);
  await expect(panel.getByTestId("agent-details")).not.toHaveAttribute("open");
  // The cash plan is code's too, and comes after the warnings, before anything the model wrote.
  const appSaid = panel.locator('[data-testid="agent-message"][data-from="app"]');
  await expect(appSaid.last()).toContainText("Cash plan: No plan fits every month in your $5,000.00 monthly budget");
  await expect(page.getByTestId("cash-plan").getByTestId("cash-move")).toHaveCount(2);
  await panel.getByTestId("agent-details").locator("summary").click();
  const said = await panel.getByTestId("agent-messages").innerText();
  console.log(`Agent said: ${said}`);
  expect(said).toContain(FLORIST.vendorName);
  // Agent text is shown as plain words: no Markdown marks on screen, in the panel or the approval card.
  expect(said).not.toMatch(/\*\*|^#{1,6}\s|`/m);
  expect(await prompt.innerText()).not.toContain("**");
  expect(said).toContain(formatCents(FLORIST.depositCents));
  expect(said).toContain(formatCents(clashTotal));
  expect(said.indexOf(FLORIST.vendorName)).toBeLessThan(said.indexOf(PHOTOGRAPHER.vendorName));
  if (realAi) {
    // The AI only explains: every dollar figure it wrote must be one the code gave it.
    const view = await (await page.request.get(`/api/timeline?today=${TODAY}`)).json();
    const fromCode = `${JSON.stringify(view.cash.warnings.map((w: { message: string }) => w.message))} ${view.items.map((i: { cents: number }) => formatCents(i.cents)).join(" ")} ${formatCents(view.totalDueCents)} ${view.cashFix?.summary ?? ""} ${view.cashFix?.stillOver ?? ""} ${formatCents(view.cash.monthlyBudgetCents)}`;
    for (const figure of said.match(/\$[\d,]+(\.\d{2})?/g) ?? []) expect(fromCode).toContain(figure.includes(".") ? figure : `${figure}.00`);
  }
  await page.screenshot({ path: `screenshots/agent-approval-${sandbox ? "sandbox" : "mock"}.png`, fullPage: true });

  // Nothing has moved, and the item waits for the same person.
  const deposit = row(page, "florist", "deposit");
  await expect(deposit.getByTestId("item-status")).toHaveText("Waiting for your approval");
  await expect(deposit.getByTestId("paypal-proof")).toHaveCount(0);
  await expect(page.getByTestId("stat-paid")).toContainText("$0.00");

  // Yes: one approval, and PayPal's checkout opens straight from the agent panel.
  const orderId = await approveAndPay(page, prompt, sandbox);

  // Paid, and the status is PayPal's own record of the capture.
  await expect(deposit.getByTestId("item-status")).toHaveText("Paid", { timeout: 200_000 });
  await expect(deposit.getByTestId("paypal-status")).toHaveText("COMPLETED");
  await expect(page.getByTestId("stat-paid")).toContainText(formatCents(FLORIST.depositCents));
  await expect(page.getByTestId("stat-overdue")).toContainText("$0.00");
  const proof = await deposit.getByTestId("paypal-proof").innerText();
  console.log(`Proof on screen: ${proof}`);

  const captureId = (await deposit.getByTestId("paypal-capture-id").textContent())!;
  const expectWebhook = !sandbox || HOSTED;
  // A late webhook shows first as the re-read, then as the webhook once PayPal sends it.
  if (expectWebhook) await expect(deposit.getByTestId("paid-by")).toContainText("Confirmed by PayPal webhook", { timeout: HOSTED ? 150_000 : 15_000 });
  else await expect(deposit.getByTestId("paid-by")).toContainText("Confirmed by re-reading the capture");

  // Its receipt is read back from PayPal when opened: the same order and capture, the webhook
  // event that marked it paid, and PayPal's debug_id for each re-read.
  await deposit.getByTestId("receipt-open").click();
  const receipt = deposit.getByTestId("receipt");
  await expect(receipt.getByTestId("receipt-order-id")).toHaveText(orderId, { timeout: 30_000 });
  await expect(receipt.getByTestId("receipt-order")).toContainText("COMPLETED");
  await expect(receipt.getByTestId("receipt-capture-id")).toHaveText(captureId);
  await expect(receipt.getByTestId("receipt-capture")).toContainText(`COMPLETED ${(FLORIST.depositCents / 100).toFixed(2)} USD`);
  const debugIds = receipt.getByTestId("receipt-debug-id");
  await expect(debugIds).toHaveCount(2);
  for (const op of ["orders.get", "payments.getCapture"]) await expect(debugIds.and(page.locator(`[data-operation="${op}"]`))).toHaveText(/^[0-9a-f]{8,}$/);
  if (expectWebhook) await expect(receipt.getByTestId("receipt-webhook-event")).toHaveText((await deposit.getByTestId("paid-by-event").textContent())!);
  else await expect(receipt.getByTestId("receipt-webhook")).toContainText("None reached this copy of the app");
  console.log(`Receipt on screen: ${(await receipt.innerText()).replace(/\s+/g, " ")}`);
  await page.screenshot({ path: `screenshots/receipt-${sandbox ? "sandbox" : "mock"}.png`, fullPage: true });
  await receipt.getByTestId("receipt-close").click();
  await expect(receipt).toHaveCount(0);

  // It stays paid and can't go twice, whoever asks.
  await page.reload();
  await expect(row(page, "florist", "deposit").getByTestId("item-status")).toHaveText("Paid");
  await expect(row(page, "florist", "deposit").getByTestId("pay-item")).toHaveCount(0);
  await page.screenshot({ path: `screenshots/agent-paid-${sandbox ? "sandbox" : "mock"}.png`, fullPage: true });

  const audit = await (await page.request.get("/api/audit")).json();
  expect(audit.integrity.ok).toBe(true);

  if (sandbox) {
    const term = { currency_code: "USD", value: (FLORIST.depositCents / 100).toFixed(2) };
    const order = await readOrder(orderId);
    const capture = await readCapture(captureId);
    console.log(`PayPal re-read: order ${order.id} ${order.status}, payee ${order.purchase_units[0].payee.email_address}, capture ${capture.id} ${capture.status} ${capture.amount.value} ${capture.amount.currency_code}`);
    expect(order.status).toBe("COMPLETED");
    expect(order.purchase_units[0].amount).toMatchObject(term);
    // Paid to the vendor's stand-in account, a different business account from the app's own.
    expect(order.purchase_units[0].payee.email_address?.toLowerCase()).toBe(sandboxVendorEmail().toLowerCase());
    expect(sandboxVendorEmail().toLowerCase()).not.toBe(sandboxSellerEmail().toLowerCase());
    expect(capture.status).toBe("COMPLETED");
    expect(capture.amount).toEqual(term);
    expect(capture.supplementary_data?.related_ids?.order_id).toBe(orderId);
    if (HOSTED) {
      const eventId = (await row(page, "florist", "deposit").getByTestId("paid-by-event").textContent())!;
      const event = await readCaptureEvent(captureId);
      console.log(`PayPal webhook event: ${event?.id} ${event?.event_type} for capture ${event?.resource.id}`);
      expect(event?.id).toBe(eventId);
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
  const deposit = row(page, "florist", "deposit");
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
  await openCashCheck(page);
  await page.getByTestId("monthly-budget").fill("20,000");
  await page.getByTestId("save-budget").click();
  await expect(page.getByTestId("cash-clear")).toBeVisible();
  await expect(page.getByTestId("cash-warning")).toHaveCount(0);
  // A clear month still shows its working.
  await page.getByTestId("cash-months").getByText("Month by month").click();
  await expect(page.getByTestId("cash-month").filter({ hasText: "June 2027" })).toContainText("Left");
  await page.reload();
  await openCashCheck(page);
  await expect(page.getByTestId("cash-clear")).toBeVisible();
});
