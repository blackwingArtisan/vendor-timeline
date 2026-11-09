/**
 * The sample banner says only what is true of the plan on screen. The demo reads contracts on the
 * visit and then fills in the rest with the samples, so the banner must name the contracts read on
 * this visit, count the samples, and sit in the page's flow, never over a timeline row. Runs on
 * mock PayPal, the sandbox and the hosted copy, where the read is Claude's own.
 */
import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { FLORIST, PHOTOGRAPHER, SAMPLES } from "../../src/lib/wedding/samples";

const sampleText = readFileSync(`public/sample-contracts/${PHOTOGRAPHER.file}`, "utf8");

async function expectNoRowCovered(page: Page) {
  const banner = (await page.getByTestId("sample-plan").boundingBox())!;
  const rows = page.getByTestId("timeline-item");
  for (let i = 0; i < (await rows.count()); i++) {
    const box = await rows.nth(i).boundingBox();
    if (!box) continue;
    const overlaps = box.x < banner.x + banner.width && banner.x < box.x + box.width && box.y < banner.y + banner.height && banner.y < box.y + box.height;
    expect(overlaps, `the banner overlaps timeline row ${i}`).toBe(false);
  }
}

test("the banner names the contract read on this visit, counts the samples, and covers no row", async ({ page }) => {
  await page.goto("/timeline");
  await expect(page.getByTestId("sample-plan")).toContainText("Sample plan");
  await expect(page.getByTestId("sample-plan-text")).toHaveText(/^Five fictional vendor contracts, read ahead of time and already confirmed/);

  // As in the demo: a fresh plan, one contract read on this visit, then the samples for the rest.
  await page.getByTestId("start-own-plan").click();
  await page.waitForURL(/\/timeline$/);
  await expect(page.getByText("Nothing confirmed yet")).toBeVisible();
  await page.goto("/contracts");
  await expect(page.getByTestId("contracts-loaded")).toBeAttached();
  await expect(async () => {
    await page.getByTestId(`sample-${PHOTOGRAPHER.vendorRole}`).click();
    await expect(page.getByTestId("contract-text")).toHaveValue(sampleText, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByTestId("read-contract").click();
  await page.waitForURL(/\/contracts\/ctr_/, { timeout: 90_000 });
  await expect(page.getByTestId("confirm-terms")).toBeEnabled();
  await page.getByTestId("confirm-terms").click();
  await page.waitForURL(/\/timeline/);
  expect((await page.request.post("/api/contracts/samples")).ok()).toBe(true);
  await page.reload();
  await expect(page.getByTestId("timeline-item")).toHaveCount(SAMPLES.length * 2);

  const { contracts, planMix } = await (await page.request.get("/api/contracts")).json();
  const read = contracts.find((c: { sample?: boolean }) => !c.sample);
  expect(contracts.filter((c: { sample?: boolean }) => c.sample)).toHaveLength(SAMPLES.length - 1);
  const live = !read.read.mocked && !read.read.skipped;
  expect(planMix.readLive).toEqual(live ? [PHOTOGRAPHER.vendorName] : []);

  const said = live ? `${PHOTOGRAPHER.vendorName} was read by Claude on this visit.` : `${PHOTOGRAPHER.vendorName} was added on this visit without an AI read.`;
  const text = `${said} The other four are fictional samples, read ahead of time.`;
  const banner = page.getByTestId("sample-plan");
  await expect(banner).toContainText("Part sample");
  await expect(page.getByTestId("sample-plan-text")).toHaveText(text);
  await expect(banner).not.toContainText(/five fictional/i);
  await expectNoRowCovered(page);

  // The florist's row, where the demo shows "Paid", is the topmost thing at its own centre.
  const florist = page.locator(`[data-testid="timeline-item"][data-role="${FLORIST.vendorRole}"][data-kind="deposit"]`);
  await florist.scrollIntoViewIfNeeded();
  const box = (await florist.boundingBox())!;
  const onTop = await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('[data-testid="timeline-item"]'), { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  expect(onTop).toBe(true);

  await page.goto("/contracts");
  await expect(page.getByTestId("sample-plan-text")).toHaveText(text);
});
