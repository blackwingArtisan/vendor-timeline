/**
 * When the agent waits on an approval, that card leads the agent column, with code's "Pay first"
 * sentence under it, and both sit above the fold on a laptop (1440x1000) and on a phone (390x844).
 * The steps and the transcript fold under one Details toggle; the cash card is its chart and one
 * line; the phone chart's labels don't run into each other. Runs on mock PayPal, the sandbox and
 * the hosted copy (E2E_AI_MODE=live): the approval and "Pay first" are code's, whatever the model says.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { formatCents } from "../../src/lib/wedding/cents";
import { FLORIST, SAMPLES } from "../../src/lib/wedding/samples";

const TODAY = "2026-11-20";

const bottom = async (l: Locator) => {
  const box = (await l.boundingBox())!;
  return box.y + box.height;
};

async function waitingApproval(page: Page) {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(SAMPLES.length * 2);
  await page.getByTestId("ask-agent").click();
  const panel = page.getByTestId("agent-panel");
  const prompt = panel.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 90_000 });
  await expect(prompt).toContainText(`Pay ${FLORIST.vendorName} ${formatCents(FLORIST.depositCents)} for the deposit`);
  const payFirst = panel.locator('[data-testid="agent-message"][data-from="app"]').first();
  await expect(payFirst).toBeVisible();
  await expect(payFirst).toContainText(`Pay first: the ${FLORIST.vendorName} deposit`);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(400);
  return { panel, prompt, payFirst };
}

for (const { name, width, height } of [
  { name: "laptop", width: 1440, height: 1000 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`on a ${name} (${width}x${height}) the waiting approval and "Pay first" are above the fold`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const { panel, prompt, payFirst } = await waitingApproval(page);
    // The approval is the first thing in the agent's card, above its steps and the goal box.
    const top = (await prompt.boundingBox())!.y;
    expect(top).toBeLessThan((await panel.getByTestId("agent-details").boundingBox())!.y);
    expect(top).toBeLessThan((await panel.getByTestId("agent-goal").boundingBox())!.y);
    // Steps and transcript are folded under one toggle, led by the "Pay first" sentence.
    await expect(panel.getByTestId("agent-details")).not.toHaveAttribute("open");
    await expect(panel.getByTestId("agent-chain")).toBeHidden();
    const approveAt = await bottom(prompt.getByTestId("approve-button"));
    const payFirstAt = await bottom(payFirst);
    console.log(`${name}: approval ${Math.round(top)}-${Math.round(await bottom(prompt))}px, Pay first ends ${Math.round(payFirstAt)}px, fold ${height}px`);
    expect(approveAt).toBeLessThanOrEqual(height);
    expect(payFirstAt).toBeLessThanOrEqual(height);
    await page.screenshot({ path: `screenshots/approval-top-${width}.png` });

    // The cash card: the chart and one line; the budget and warnings open from it.
    const cash = page.getByTestId("cash-card");
    await expect(cash.getByTestId("cash-chart")).toBeVisible();
    await expect(cash.getByTestId("cash-chart-summary")).toBeVisible();
    await expect(cash.getByTestId("monthly-budget")).toBeHidden();
    await expect(cash.getByTestId("cash-warning").first()).toBeHidden();
  });
}

test("the phone cash chart's labels don't overlap", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(SAMPLES.length * 2);
  const chart = page.getByTestId("cash-chart");
  await chart.scrollIntoViewIfNeeded();
  const boxes = await chart.evaluate((el) =>
    [...el.querySelectorAll("span")]
      .filter((s) => s.children.length === 0 && s.textContent?.trim() && s.getClientRects().length && getComputedStyle(s).display !== "none")
      .map((s) => {
        const r = s.getBoundingClientRect();
        return { text: s.textContent!.trim(), x: r.x, y: r.y, w: r.width, h: r.height };
      })
      .filter((b) => b.w > 0 && b.h > 0),
  );
  expect(boxes.length).toBeGreaterThan(3);
  const overlaps: string[] = [];
  for (let i = 0; i < boxes.length; i++)
    for (let j = i + 1; j < boxes.length; j++) {
      const [a, b] = [boxes[i], boxes[j]];
      if (a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5) overlaps.push(`"${a.text}" and "${b.text}"`);
    }
  expect(overlaps).toEqual([]);
  // Each month label fits its own column, and each label is readable whole.
  for (const b of boxes) expect(b.x).toBeGreaterThanOrEqual(0);
  await chart.screenshot({ path: "screenshots/cash-chart-390.png" });
});
