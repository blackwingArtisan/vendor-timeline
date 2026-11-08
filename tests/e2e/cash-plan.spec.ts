/**
 * Over budget, the agent shows code's cash plan: only moves the contracts allow, each approved by
 * the couple. Runs on mock PayPal, on the real sandbox (paying in PayPal's own checkout) and against
 * the hosted copy. With real AI (hosted, or E2E_AI_MODE=live) the agent's own words change, but the
 * plan, its sums and its cards are code's, so the same checks hold.
 */
import { expect, test, type Page } from "@playwright/test";
import { approveAndPay } from "./pay-in-checkout";
import { readOrder, sandboxVendorEmail } from "./paypal-reread";
import { formatCents } from "../../src/lib/wedding/cents";
import { CATERER, FLORIST, PHOTOGRAPHER, VENUE } from "../../src/lib/wedding/samples";

const TODAY = "2026-11-20";
const row = (page: Page, role: string, kind: string) => page.locator(`[data-testid="timeline-item"][data-role="${role}"][data-kind="${kind}"]`);

async function fiveContracts(page: Page) {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/timeline");
  await expect(page.getByTestId("sample-plan")).toContainText("Sample plan");
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
}

test("the agent shows a cash plan the contracts allow, and a date the vendor agreed to clears the clash", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await fiveContracts(page);
  const clash = page.locator('[data-testid="cash-warning"][data-kind="same_week"]');
  await expect(clash).toContainText("leaves in the week of Sat, May 29, 2027");

  await page.getByTestId("ask-agent").click();
  const panel = page.getByTestId("agent-panel");
  const plan = panel.getByTestId("cash-plan");
  await expect(plan).toBeVisible({ timeout: 90_000 });
  // Honest about what can't fit: two balances are each bigger than the whole $5,000 month.
  // The plan is the app's own message, marked as the app's, not the model's.
  const said = panel.locator('[data-testid="agent-message"][data-from="app"]').filter({ hasText: "Cash plan:" });
  await expect(said).toHaveCount(1);
  await expect(said).toContainText("Cash plan: No plan fits every month in your $5,000.00 monthly budget, but two moves your contracts allow bring it closer");
  const stillOver = `The ${VENUE.vendorName} balance ($6,000.00) and the ${CATERER.vendorName} balance ($10,460.00) are each more than your monthly budget on their own.`;
  await expect(said).toContainText(stillOver);
  await expect(plan.getByTestId("cash-plan-still-over")).toHaveText(`Still over: April 2027 by $1,000.00 and May 2027 by $5,460.00. ${stillOver}`);

  const payNow = plan.locator('[data-testid="cash-move"][data-item="photographer.balance"]');
  await expect(payNow).toHaveAttribute("data-kind", "pay_now");
  await expect(payNow.getByTestId("move-title")).toHaveText(`Pay the ${PHOTOGRAPHER.vendorName} balance ($3,600.00) now`);
  await expect(payNow.getByTestId("move-why")).toContainText('The contract says: "The remaining balance of $3,600.00 is due thirty (30) days before the Event Date."');
  await expect(payNow.getByTestId("move-pay")).toHaveText("Pay early");

  const ask = plan.locator('[data-testid="cash-move"][data-item="florist.balance"]');
  await expect(ask).toHaveAttribute("data-kind", "ask_vendor");
  await expect(ask.getByTestId("move-title")).toHaveText(`Ask ${FLORIST.vendorName} to move the balance ($1,740.00) to Sat, Jun 5, 2027`);
  await expect(ask.getByTestId("move-why")).toContainText(`A later date needs ${FLORIST.vendorName}'s agreement.`);
  const message = await ask.getByTestId("move-message").inputValue();
  expect(message).toContain(`Hello ${FLORIST.vendorName},`);
  expect(message).toContain("Our contract has the balance of $1,740.00 due Sat, May 29, 2027. Could we move it to Sat, Jun 5, 2027, still before the wedding on Sat, Jun 12, 2027?");
  await ask.getByTestId("move-copy").click();
  await expect(ask.getByTestId("move-copy")).toHaveText("Copied");
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(message);
  await page.screenshot({ path: "screenshots/cash-plan.png", fullPage: true });

  // Copying asks nothing of anyone. Only "they agreed" moves the date, and the clash clears.
  await expect(clash).toHaveCount(1);
  await ask.getByTestId("move-approve").click();
  await expect(ask.getByTestId("move-done")).toHaveText("Moved to Sat, Jun 5, 2027. The contract said Sat, May 29, 2027.");
  await expect(clash).toHaveCount(0);
  await expect(row(page, "florist", "balance").getByTestId("item-due")).toHaveText("Sat, Jun 5, 2027");
  await expect(row(page, "florist", "balance").getByTestId("item-moved")).toHaveText("Contract says Sat, May 29, 2027");
  // The rest of the plan still stands, and nothing was paid.
  await expect(payNow.getByTestId("move-pay")).toBeVisible();
  await expect(page.getByTestId("stat-paid")).toContainText("$0.00");

  await page.reload();
  await expect(row(page, "florist", "balance").getByTestId("item-due")).toHaveText("Sat, Jun 5, 2027");
  await expect(page.locator('[data-testid="cash-warning"][data-kind="same_week"]')).toHaveCount(0);
});

test("paying a balance early from the plan goes through the same approval and PayPal checkout, and the warning clears", async ({ page }) => {
  await fiveContracts(page);
  const status = await (await page.request.get("/api/kit/status")).json();
  const sandbox = status.paypal.mode === "sandbox";
  await page.getByTestId("monthly-budget").fill("15,000");
  await page.getByTestId("save-budget").click();
  const warning = page.getByTestId("cash-warning");
  await expect(warning).toHaveCount(1);
  await expect(warning).toContainText("May 2027 needs $15,800.00 across 3 payments, $800.00 over your $15,000.00 monthly budget.");

  await page.getByTestId("ask-agent").click();
  const panel = page.getByTestId("agent-panel");
  const plan = panel.getByTestId("cash-plan");
  await expect(panel.locator('[data-testid="agent-message"][data-from="app"]').filter({ hasText: "Cash plan:" })).toHaveText(`Cash plan: One move would fit every month in your $15,000.00 monthly budget: pay the ${FLORIST.vendorName} balance ($1,740.00) now. Approve each one below.`, { timeout: 90_000 });
  await expect(plan.getByTestId("cash-plan-still-over")).toHaveCount(0);
  const move = plan.getByTestId("cash-move");
  await expect(move).toHaveCount(1);
  await expect(move).toHaveAttribute("data-item", "florist.balance");

  // "Pay early" is the usual guarded payment: one approval, then PayPal's checkout.
  await move.getByTestId("move-pay").click();
  const prompt = move.getByTestId("approval-prompt");
  await expect(prompt).toContainText(`Pay ${FLORIST.vendorName} ${formatCents(FLORIST.balanceCents)} for the balance`);
  await expect(prompt.getByTestId("approval-budget")).toContainText("November 2026 comes to");
  await expect(row(page, "florist", "balance").getByTestId("item-status")).toHaveText("Waiting for your approval");
  await expect(row(page, "florist", "balance").getByTestId("approval-prompt")).toHaveCount(0);
  await expect(page.getByTestId("stat-paid")).toContainText("$0.00");
  const orderId = await approveAndPay(page, prompt, sandbox);

  const balance = row(page, "florist", "balance");
  await expect(balance.getByTestId("item-status")).toHaveText("Paid", { timeout: 200_000 });
  await expect(balance.getByTestId("paypal-status")).toHaveText("COMPLETED");
  // The warning clears on screen: May now fits.
  await expect(page.getByTestId("cash-warning")).toHaveCount(0);
  await expect(page.getByTestId("cash-clear")).toBeVisible();
  if (!sandbox) {
    // Mock PayPal never leaves the page, so the plan card is still there to say so.
    await expect(move.getByTestId("move-done")).toHaveText("Paid early through PayPal.");
    await expect(plan.getByTestId("cash-plan-fits")).toHaveText("Every month now fits your $15,000.00 monthly budget.");
  } else {
    const order = await readOrder(orderId);
    console.log(`Cash plan pay early: order ${order.id} ${order.status}, ${order.purchase_units[0].amount.value} ${order.purchase_units[0].amount.currency_code} to ${order.purchase_units[0].payee.email_address}`);
    expect(order.status).toBe("COMPLETED");
    expect(order.purchase_units[0].amount).toMatchObject({ currency_code: "USD", value: (FLORIST.balanceCents / 100).toFixed(2) });
    expect(order.purchase_units[0].payee.email_address?.toLowerCase()).toBe(sandboxVendorEmail().toLowerCase());
  }
  await page.screenshot({ path: `screenshots/cash-plan-paid-${sandbox ? "sandbox" : "mock"}.png`, fullPage: true });
});
