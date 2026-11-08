/**
 * The red-team's smaller findings, fixed: one tag per row with the most urgent tagged, the deposit or
 * balance never cut off on a phone, amounts in boxes written like every other amount, an approval
 * that says which month it counts in, the checkout naming the vendor, and an Activity log in plain
 * words. Runs on mock PayPal, the sandbox and the hosted copy. No AI, and nothing is paid.
 */
import { devices, expect, test, type Page } from "@playwright/test";
import { FLORIST, PHOTOGRAPHER } from "../../src/lib/wedding/samples";

const TODAY = "2026-11-20";
const row = (page: Page, role: string, kind: string) => page.locator(`[data-testid="timeline-item"][data-role="${role}"][data-kind="${kind}"]`);

async function samplePlan(page: Page) {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/timeline");
  await expect(page.getByTestId("sample-plan")).toContainText("Sample plan");
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
}

test("the overdue deposit is tagged pay first, each row has one tag, and boxes read like amounts", async ({ page }) => {
  await samplePlan(page);
  await expect(row(page, "florist", "deposit").getByTestId("item-tag")).toHaveText("Pay first");
  await expect(row(page, "photographer", "deposit").getByTestId("item-tag")).toHaveText("Due next");
  await expect(page.getByTestId("item-tag")).toHaveCount(2);
  // A tagged upcoming row shows its tag alone, not "Due next" and "Upcoming" side by side.
  await expect(row(page, "photographer", "deposit").getByTestId("item-status")).toHaveClass(/sr-only/);
  await expect(row(page, "florist", "deposit").getByTestId("item-status")).toBeVisible();
  await expect(page.getByTestId("monthly-budget")).toHaveValue("5,000.00");

});

test("an approval says which month it counts in, and Activity reads in plain words", async ({ page }) => {
  await samplePlan(page);
  const status = await (await page.request.get("/api/kit/status")).json();
  const sandbox = status.paypal.mode === "sandbox";
  const deposit = row(page, "photographer", "deposit");
  await deposit.getByTestId("pay-item").click();
  const prompt = deposit.getByTestId("approval-prompt");
  await expect(prompt.getByTestId("approval-budget")).toHaveText(/^Paid now, it counts in November 2026, not December 2026 when it's due\. With this, November 2026 comes to \$1,800\.00 of your \$5,000\.00 monthly budget, \$3,200\.00 left\.$/);
  await expect(prompt.getByTestId("approval-to")).toHaveText(PHOTOGRAPHER.vendorName);

  if (!sandbox) {
    // The checkout box names the vendor as "To", and the PayPal account that stands in on its own line.
    await prompt.getByTestId("approve-button").click();
    await expect(page.getByTestId("mock-order-id")).toHaveText(/\S/, { timeout: 60_000 });
    await page.keyboard.press("Escape");
    const box = deposit.getByTestId("checkout-box");
    await expect(box.getByTestId("checkout-to")).toHaveText(PHOTOGRAPHER.vendorName);
    await expect(box.getByTestId("checkout-payee")).toHaveText(/@/);
  } else {
    await prompt.getByRole("button", { name: "Decline" }).click();
    await expect(deposit.getByTestId("pay-item")).toBeVisible();
  }

  await page.goto("/activity");
  const actions = page.getByTestId("audit-action");
  await expect(actions.first()).toBeVisible();
  const words = await actions.allInnerTexts();
  expect(words).toContain("Waiting for your approval");
  expect(words.join(" ")).not.toMatch(/tool\.|approval\./);
  const tools = await page.getByTestId("audit-tool").allInnerTexts();
  expect(tools).toContain("Pay a vendor");
  expect(tools.join(" ")).not.toContain("create_vendor_order");
});

test.describe("on a phone", () => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["iPhone 13"];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test("a long vendor name gives way, and deposit or balance is never cut off", async ({ page }) => {
    await samplePlan(page);
    for (const kind of ["deposit", "balance"]) {
      const name = row(page, "florist", kind).getByTestId("item-name");
      await expect(name).toContainText(kind === "deposit" ? "Deposit" : "Balance");
      const word = name.locator("span.shrink-0");
      const [box, line] = [(await word.boundingBox())!, (await name.boundingBox())!];
      expect(box.x + box.width).toBeLessThanOrEqual(line.x + line.width + 1);
      expect(await word.evaluate((el) => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
    }
    expect(FLORIST.vendorName.length).toBeGreaterThan(10);
  });
});
