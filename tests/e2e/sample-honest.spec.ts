/**
 * The sample plan says honestly how it was made, and its cash plan finishes the job.
 * - /api/contracts reports each sample's read as prepared ahead of time: never mocked, never live.
 * - The caterer's $10,460 balance is bigger than the $5,000 month on its own, so no date the
 *   contracts allow fits May. Code names the smallest monthly budget its own plan fits ($10,500),
 *   and one tap sets it; with the plan's moves made, every month is under budget.
 * - Each paid row carries one "Sandbox" chip; icon-only buttons say what they do on hover.
 * Screenshots at 1440x900 and 390x844. Runs on mock PayPal, the sandbox and the hosted copy
 * (where the pay-through is left to the cash-plan spec).
 */
import { expect, test, type Page } from "@playwright/test";
import { approveAndPay } from "./pay-in-checkout";
import { FLORIST, PHOTOGRAPHER, SAMPLES } from "../../src/lib/wedding/samples";

const TODAY = "2026-11-20";
const row = (page: Page, role: string, kind: string) => page.locator(`[data-testid="timeline-item"][data-role="${role}"][data-kind="${kind}"]`);

async function samplePlan(page: Page) {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/timeline");
  await expect(page.getByTestId("sample-plan")).toContainText("Sample plan");
  await expect(page.getByTestId("timeline-item")).toHaveCount(SAMPLES.length * 2);
}

test("the samples' reads are reported as prepared ahead of time, not mocked and not live", async ({ page }) => {
  await samplePlan(page);
  const { contracts } = await (await page.request.get("/api/contracts")).json();
  expect(contracts).toHaveLength(SAMPLES.length);
  for (const c of contracts) {
    expect(c.sample).toBe(true);
    expect(c.read).toEqual({ mocked: false, prepared: true, by: "Sample, prepared ahead of time, not read on this visit", costUsd: 0 });
    expect(c.read).not.toHaveProperty("model");
  }
});

test("the sample's cash plan names the budget that fits, sets it in one tap, and its moves bring every month under", async ({ page }) => {
  await samplePlan(page);
  const status = await (await page.request.get("/api/kit/status")).json();
  const sandbox = status.paypal.mode === "sandbox";
  await page.getByTestId("ask-agent").click();
  const plan = page.getByTestId("cash-plan");
  await expect(plan).toBeVisible({ timeout: 90_000 });
  const fit = plan.getByTestId("budget-to-fit");
  await expect(fit).toHaveAttribute("data-cents", "1050000");
  await expect(fit.getByTestId("budget-to-fit-set")).toHaveText("Set the budget to $10,500 a month");
  await expect(fit.getByTestId("budget-to-fit-why")).toHaveText(`$10,500.00 a month is the smallest budget that fits every month, once you pay the ${PHOTOGRAPHER.vendorName} balance ($3,600.00) now and pay the ${FLORIST.vendorName} balance ($1,740.00) now. Code works this out from the same rules as the plan.`);
  await expect(page.getByTestId("cash-chart-summary")).toHaveText("Over budget: April 2027 by $1,000.00, May 2027 by $10,800.00.");

  await fit.getByTestId("budget-to-fit-set").click();
  // The plan now fits: no "still over", no budget to suggest, and its two moves.
  await expect(plan.getByTestId("budget-to-fit")).toHaveCount(0);
  await expect(plan.getByTestId("cash-plan-still-over")).toHaveCount(0);
  await expect(page.getByTestId("cash-chart-summary")).toHaveText("Over budget: May 2027 by $5,300.00.");
  for (const role of ["photographer", "florist"]) await expect(plan.locator(`[data-testid="cash-move"][data-item="${role}.balance"]`)).toHaveAttribute("data-kind", "pay_now");
  await page.screenshot({ path: "screenshots/sample-honest-plan.png", fullPage: true });
  if (sandbox) return;

  // Mock PayPal: make both moves, and every month is under budget.
  for (const role of ["photographer", "florist"]) {
    const move = plan.locator(`[data-testid="cash-move"][data-item="${role}.balance"]`);
    await move.getByTestId("move-pay").click();
    await approveAndPay(page, move.getByTestId("approval-prompt"), false);
    await expect(row(page, role, "balance").getByTestId("item-status")).toHaveText("Paid", { timeout: 60_000 });
  }
  await expect(page.getByTestId("cash-chart-summary")).toHaveText("Every month fits your budget.");
  await expect(page.getByTestId("cash-warning")).toHaveCount(0);
  await expect(plan.getByTestId("cash-plan-fits")).toHaveText("Every month now fits your $10,500.00 monthly budget.");
});

for (const { name, width, height } of [
  { name: "laptop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`on a ${name}, icon buttons say what they do, and a paid row has one Sandbox chip at most`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await samplePlan(page);
    const status = await (await page.request.get("/api/kit/status")).json();
    const sandbox = status.paypal.mode === "sandbox";
    const balance = row(page, "venue", "balance");
    if (name === "phone") {
      await balance.getByTestId("row-more").click();
      await expect(balance.getByTestId("assign-open")).toContainText("Assign to someone else");
    } else {
      await balance.getByTestId("assign-open").hover();
      const tip = balance.getByTestId("icon-tip").filter({ hasText: "Assign to a parent or someone else to pay" });
      await expect(tip).toBeVisible();
    }
    for (const id of ["paid-outside-open", "assign-open", "move-date"]) await expect(balance.getByTestId(id)).toHaveAttribute("aria-label", /\S/);
    await page.screenshot({ path: `screenshots/sample-honest-${width}.png` });

    // Pay the overdue deposit; its row then carries one Sandbox chip (sandbox) or none (mock).
    const deposit = row(page, "florist", "deposit");
    await deposit.getByTestId("pay-item").click();
    await approveAndPay(page, deposit.getByTestId("approval-prompt").or(page.getByTestId("agent-panel").getByTestId("approval-prompt")).first(), sandbox);
    await expect(row(page, "florist", "deposit").getByTestId("item-status")).toHaveText("Paid", { timeout: 200_000 });
    const proof = row(page, "florist", "deposit").getByTestId("paypal-proof");
    await expect(proof.getByTestId("stand-in-chip")).toHaveCount(sandbox ? 1 : 0);
    if (sandbox) await expect(proof.getByTestId("stand-in-chip")).toHaveText("Sandbox");
    // The sandbox's webhook note is in that chip's tooltip, not a line of its own.
    if (sandbox) await expect(proof.getByTestId("paid-by")).not.toContainText("can't send webhooks");
    await proof.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `screenshots/sample-honest-paid-${width}.png` });
  });
}
