/**
 * The first screen on a laptop (1440×900): the stats, the agent with its approval card and the
 * month-by-month cash chart sit above the fold, the payments are one compact table with their bars,
 * and moving between pages never shows a bare grey skeleton. Runs on mock PayPal, the sandbox and
 * the hosted copy. The agent run is the only AI it uses.
 */
import { expect, test, type Page } from "@playwright/test";
import { SAMPLES } from "../../src/lib/wedding/samples";

test.use({ viewport: { width: 1440, height: 900 } });

const FOLD = 900;

/** Counts every bare skeleton block that appears in this document, however briefly. */
const watchSkeletons = () => {
  const w = window as unknown as { __skeletons: number };
  w.__skeletons = 0;
  const bare = (el: Element) => el.classList.contains("animate-pulse") && /bg-zinc-200/.test(el.className);
  new MutationObserver((records) => {
    for (const r of records) for (const n of r.addedNodes) if (n instanceof Element && (bare(n) || [...n.querySelectorAll(".animate-pulse")].some(bare))) w.__skeletons += 1;
  }).observe(document, { childList: true, subtree: true });
};
const skeletons = (page: Page) => page.evaluate(() => (window as unknown as { __skeletons: number }).__skeletons);

const bottomOf = async (page: Page, id: string) => {
  const box = (await page.getByTestId(id).first().boundingBox())!;
  return box.y + box.height;
};

test("stats, the agent's approval and the cash chart fit the first screen", async ({ page }) => {
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(SAMPLES.length * 2);
  if (process.env.NEXT_PUBLIC_SPONSOR_UI === "1") await expect(page.getByTestId("sponsor-gantt")).toBeVisible({ timeout: 120_000 });
  const before = await page.evaluate(() => document.documentElement.scrollHeight);
  console.log(`Page height before the agent: ${before}px, ${(before / FOLD).toFixed(2)} screens`);
  // The sponsor's Gantt, when switched on, is an extra card of its own below the table.
  const gantt = (await page.getByTestId("sponsor-gantt").count()) ? (await page.getByTestId("sponsor-gantt").boundingBox())!.height + 24 : 0;
  expect(before - gantt).toBeLessThanOrEqual(FOLD * 1.6);

  expect(await bottomOf(page, "stat-paid")).toBeLessThanOrEqual(FOLD);
  expect(await bottomOf(page, "cash-chart")).toBeLessThanOrEqual(FOLD);

  // The chart's bars are the cash check's own months, gaps included.
  const { cash } = await (await page.request.get("/api/timeline")).json();
  const bars = page.getByTestId("cash-chart-month");
  for (const m of cash.months as { month: string; totalCents: number }[]) {
    await expect(bars.and(page.locator(`[data-month="${m.month}"]`))).toHaveAttribute("data-total-cents", String(m.totalCents));
  }

  // The payment table: one row per payment, each with its bar beside it.
  await expect(page.getByTestId("vendor-timeline").getByTestId("vendor-bar")).toHaveCount(process.env.NEXT_PUBLIC_SPONSOR_UI === "1" ? 0 : SAMPLES.length * 2);

  await page.getByTestId("ask-agent").click();
  const prompt = page.getByTestId("agent-panel").getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 90_000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
  const approveAt = await bottomOf(page, "approve-button");
  console.log(`Approve and pay ends at ${Math.round(approveAt)}px; page ${await page.evaluate(() => document.documentElement.scrollHeight)}px with the plan open`);
  expect(approveAt).toBeLessThanOrEqual(FOLD);
  expect(await bottomOf(page, "cash-chart")).toBeLessThanOrEqual(FOLD);
  await page.screenshot({ path: "screenshots/first-screen.png" });
});

test("moving between pages never shows a bare skeleton or an error", async ({ page }) => {
  await page.addInitScript(watchSkeletons);
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(SAMPLES.length * 2);
  const nav = page.getByRole("navigation").first();
  const ready = {
    Contracts: page.getByTestId("contracts-loaded"),
    Activity: page.getByRole("heading", { name: "Activity", level: 1 }),
    Timeline: page.getByTestId("timeline-item").first(),
  };
  for (const link of ["Contracts", "Activity", "Timeline", "Contracts"] as const) {
    await nav.getByRole("link", { name: link }).click();
    await expect(ready[link]).toBeAttached({ timeout: 30_000 });
    await expect(page.getByTestId("page-error")).toHaveCount(0);
  }
  await page.getByTestId("contract-list").getByRole("link").first().click();
  await expect(page.getByRole("heading", { name: "Confirmed", exact: true })).toBeVisible({ timeout: 30_000 });
  await nav.getByRole("link", { name: "Timeline" }).click();
  await expect(page.getByTestId("timeline-item")).toHaveCount(SAMPLES.length * 2);
  expect(await skeletons(page)).toBe(0);
});
