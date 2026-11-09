/**
 * A deposit paid outside PayPal, by cheque, is recorded with its amount and date. The timeline and
 * the cash check update, the row says plainly it isn't a PayPal payment, and nothing can pay it
 * again: the Pay route is refused before any approval or PayPal order. Runs on mock PayPal, the
 * sandbox and the hosted copy, with no AI and no PayPal payment.
 */
import { expect, test, type Page } from "@playwright/test";
import { openCashCheck } from "./open-cash";
import { formatCents } from "../../src/lib/wedding/cents";
import { formatDay } from "../../src/lib/wedding/dates";
import { PHOTOGRAPHER, SAMPLES } from "../../src/lib/wedding/samples";

const TODAY = "2026-11-20";
const row = (page: Page, role: string, kind: string) => page.locator(`[data-testid="timeline-item"][data-role="${role}"][data-kind="${kind}"]`);

test("a cheque paid outside PayPal is recorded, labelled plainly, and never paid again", async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(SAMPLES.length * 2);
  const totalBefore = await page.getByTestId("stat-total").innerText();
  const deposit = row(page, PHOTOGRAPHER.vendorRole, "deposit");

  await deposit.getByTestId("paid-outside-open").click();
  const form = deposit.getByTestId("paid-outside-form");
  await expect(form).toContainText("This isn't a PayPal payment");
  await expect(form.getByTestId("paid-outside-amount")).toHaveValue("1,200.00");
  // The amount must be the confirmed term.
  await form.getByTestId("paid-outside-amount").fill("1,000");
  await form.getByTestId("paid-outside-save").click();
  await expect(form.getByTestId("paid-outside-error")).toHaveText(`The confirmed ${PHOTOGRAPHER.vendorName} deposit is ${formatCents(PHOTOGRAPHER.depositCents)}, not $1,000.00. Record the full amount you paid, or pay it through PayPal.`);
  await form.getByTestId("paid-outside-amount").fill("1,200.00");
  await form.getByTestId("paid-outside-date").fill("2026-11-18");
  await form.getByTestId("paid-outside-method").selectOption("cheque");
  await form.getByTestId("paid-outside-save").click();

  await expect(deposit.getByTestId("item-status")).toHaveText("Paid outside PayPal");
  await expect(deposit.getByTestId("paid-outside")).toHaveText(`Paid outside PayPal: ${formatCents(PHOTOGRAPHER.depositCents)} by cheque on ${formatDay("2026-11-18")}. Not a PayPal payment, so there's no PayPal record or receipt.`);
  await expect(deposit.getByTestId("pay-item")).toHaveCount(0);
  await expect(deposit.getByTestId("receipt-open")).toHaveCount(0);
  await expect(deposit.getByTestId("paypal-proof")).toHaveCount(0);
  await expect(page.getByTestId("stat-paid")).toContainText(formatCents(PHOTOGRAPHER.depositCents));
  await expect(page.getByTestId("stat-total")).not.toHaveText(totalBefore);

  // The cash check counts it in November, as already paid, on the day of the cheque.
  await openCashCheck(page);
  await page.getByTestId("cash-months").locator("summary").click();
  const november = page.locator('[data-testid="cash-month"][data-month="2026-11"]');
  await expect(november).toContainText(`${PHOTOGRAPHER.vendorName} deposit`);
  await expect(november).toContainText(`Paid ${formatDay("2026-11-18")}`);
  await expect(page.locator('[data-testid="cash-chart-month"][data-month="2026-11"]')).toHaveAttribute("data-total-cents", /\d+/);

  // Nothing can pay it again: the Pay route is refused, and no approval or order appears.
  const { items } = await (await page.request.get(`/api/timeline?today=${TODAY}`)).json();
  const item = (items as { id: string; contractId: string; kind: string; vendorRole: string; payment?: { paidBy?: string; orderId?: string } }[]).find((i) => i.vendorRole === PHOTOGRAPHER.vendorRole && i.kind === "deposit")!;
  expect(item.payment?.paidBy).toBe("outside");
  expect(item.payment?.orderId).toBeUndefined();
  const pay = await page.request.post(`/api/contracts/${item.contractId}/pay`, { data: { kind: "deposit" } });
  expect(pay.status()).toBe(409);
  expect((await pay.json()).error.message).toBe("The couple paid this deposit outside PayPal, so nothing can be sent for it.");
  await page.reload();
  await expect(deposit.getByTestId("item-status")).toHaveText("Paid outside PayPal");
  await expect(deposit.getByTestId("approval-prompt")).toHaveCount(0);

  // The calendar file leaves it out with the other paid ones.
  const ics = await (await page.request.get("/api/timeline.ics")).text();
  expect(ics).not.toContain(`Pay ${PHOTOGRAPHER.vendorName} deposit`);
  expect(ics).toContain(`Pay ${PHOTOGRAPHER.vendorName} balance`);
  await deposit.screenshot({ path: "screenshots/paid-outside-row.png" });

  // "What's happening" lists it, said plainly.
  await page.getByTestId("activity-panel").locator("summary").click();
  await expect(page.getByTestId("activity-panel")).toContainText(`Marked the ${PHOTOGRAPHER.vendorName} deposit paid outside PayPal`);
});
