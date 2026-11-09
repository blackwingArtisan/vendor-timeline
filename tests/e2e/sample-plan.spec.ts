/**
 * A first visit lands on a working, labelled sample plan, and "Start your own plan" gives an empty
 * one. Runs on mock PayPal, the sandbox and the hosted copy. It costs no AI: the samples are the
 * labelled fixtures.
 */
import { devices, expect, test } from "@playwright/test";
import { openCashCheck } from "./open-cash";
import { SAMPLES } from "../../src/lib/wedding/samples";

const planCookie = async (context: import("@playwright/test").BrowserContext) => (await context.cookies()).find((c) => c.name === "vt_plan")?.value;

test("a new visitor lands on the labelled sample plan, and can start their own", async ({ page, context }) => {
  await page.goto("/timeline");
  await expect(page.getByTestId("sample-plan")).toContainText("Sample plan");
  await expect(page.getByTestId("timeline-item")).toHaveCount(SAMPLES.length * 2);
  await expect(page.getByTestId("agent-panel")).toBeVisible();
  await expect(page.getByTestId("cash-chart")).toBeVisible();
  await openCashCheck(page);
  await expect(page.getByTestId("cash-warning").first()).toBeVisible();

  const { contracts, samplePlan } = await (await page.request.get("/api/contracts")).json();
  expect(samplePlan).toBe(true);
  expect(contracts.map((c: { confirmed?: { vendorName: string } }) => c.confirmed?.vendorName).sort()).toEqual(SAMPLES.map((s) => s.vendorName).sort());

  await page.goto("/contracts");
  await expect(page.getByTestId("sample-plan")).toBeVisible();
  const samplePlanId = await planCookie(context);

  await page.getByTestId("start-own-plan").click();
  await page.waitForURL(/\/timeline$/);
  await expect(page.getByText("Nothing confirmed yet")).toBeVisible();
  await expect(page.getByTestId("sample-plan")).toHaveCount(0);
  expect(await planCookie(context)).not.toBe(samplePlanId);

  // It stays the couple's own: a reload doesn't bring the samples back.
  await page.reload();
  await expect(page.getByText("Nothing confirmed yet")).toBeVisible();
  const own = await (await page.request.get("/api/contracts")).json();
  expect(own).toEqual({ contracts: [], samplePlan: false });

  // The samples are still one click away, and labelled again.
  await page.getByTestId("load-samples").click();
  await expect(page.getByTestId("timeline-item")).toHaveCount(SAMPLES.length * 2);
  await expect(page.getByTestId("sample-plan")).toBeVisible();
});

test.describe("on a phone", () => {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["iPhone 13"];
  test.use({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });

  test("the agent card and cash check fit, and the header never covers them", async ({ page }) => {
    await page.goto("/timeline");
    await expect(page.getByTestId("timeline-item")).toHaveCount(SAMPLES.length * 2);
    const width = page.viewportSize()!.width;
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
    const header = (await page.locator("header").first().boundingBox())!;

    for (const id of ["sample-plan", "agent-panel", "cash-card"]) {
      const card = page.getByTestId(id);
      await card.evaluate((el) => el.scrollIntoView({ block: "start" }));
      const box = (await card.boundingBox())!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(width);
      // Scrolled to, the card starts below the sticky header, not under it.
      expect(box.y).toBeGreaterThanOrEqual(header.y + header.height);
      if (id === "agent-panel") await expect(page.getByTestId("ask-agent")).toBeInViewport();
    }
  });
});
