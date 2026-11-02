/**
 * The sponsor switch, both ways. Off is the public site: the free bars and no sponsor code in the
 * browser. On is local and the video: the Gantt, with a dragged date saved across a reload and
 * across leaving the page, which is where cacheComponents would otherwise lose it.
 */
import { expect, test, type Page } from "@playwright/test";
import { formatDay } from "../../src/lib/wedding/dates";
import { PHOTOGRAPHER } from "../../src/lib/wedding/samples";

const SPONSOR = process.env.NEXT_PUBLIC_SPONSOR_UI === "1";
const BARS = ".b-gantt-task-wrap:not(.b-released)";

async function sampleWedding(page: Page) {
  await page.goto("/timeline");
  await page.getByTestId("load-samples").click();
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
}

const row = (page: Page) => page.locator('[data-testid="timeline-item"][data-role="photographer"][data-kind="deposit"]');

test.describe("switch off", () => {
  test.skip(SPONSOR, "Only for a build with the sponsor switch off.");

  test("shows the free bars and sends no sponsor code to the browser", async ({ page }) => {
    const urls: string[] = [];
    const bodies: Promise<string>[] = [];
    page.on("response", (r) => {
      urls.push(r.url());
      if (/\.(js|css)(\?|$)/.test(r.url())) bodies.push(r.text().catch(() => ""));
    });
    await sampleWedding(page);
    await expect(page.getByTestId("free-bars")).toBeVisible();
    await expect(page.getByTestId("vendor-bar")).toHaveCount(10);
    await expect(page.getByTestId("sponsor-gantt")).toHaveCount(0);
    await expect(page.locator(".b-gantt")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText("Bryntum");
    expect(urls.filter((u) => /bryntum/i.test(u))).toEqual([]);
    expect((await Promise.all(bodies)).filter((b) => /bryntum/i.test(b))).toEqual([]);
  });
});

test.describe("switch on", () => {
  test.skip(!SPONSOR, "Only for a build with NEXT_PUBLIC_SPONSOR_UI=1.");
  test.setTimeout(240_000);

  test("a dragged date is saved, survives a reload and survives leaving the page", async ({ page }) => {
    await sampleWedding(page);
    await expect(page.getByTestId("sponsor-gantt")).toBeVisible({ timeout: 120_000 });
    await expect(page.locator(BARS).first()).toBeVisible({ timeout: 120_000 });
    await expect(page.getByTestId("sponsor-notice")).toContainText("Portions of this software are copyright 2015-");
    await expect(page.getByTestId("sponsor-notice")).toContainText("by Bryntum AB");
    await expect(page.getByTestId("free-bars")).toHaveCount(0);
    await page.getByTestId("sponsor-gantt").scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);

    const { items } = await (await page.request.get("/api/timeline")).json();
    const deposit = items.find((i: { vendorRole: string; kind: string }) => i.vendorRole === "photographer" && i.kind === "deposit");
    const bar = page.locator(`.b-gantt-task-wrap[data-task-id="${deposit.id}"] .b-gantt-task`).first();
    await expect(bar).toBeVisible();
    await expect(page.locator(`.b-gantt-task-wrap[data-task-id="${deposit.contractId}"]`)).toHaveCount(1); // the vendor's row
    await page.screenshot({ path: "screenshots/gantt-before-drag.png", fullPage: true });
    const before = (await bar.boundingBox())!;

    // Drag about four weeks to the right.
    const [x, y] = [before.x + before.width / 2, before.y + before.height / 2];
    await page.mouse.move(x, y);
    await page.waitForTimeout(150);
    await page.mouse.down();
    for (let i = 1; i <= 14; i++) {
      await page.mouse.move(x + i * 8, y);
      await page.waitForTimeout(25);
    }
    await page.waitForTimeout(150);
    const saved = page.waitForResponse((r) => r.url().includes("/move") && r.request().method() === "POST");
    await page.mouse.up();
    expect((await saved).status()).toBe(200);
    await expect(page.getByTestId("gantt-last-move")).toContainText(`${PHOTOGRAPHER.vendorName} deposit moved to`);
    const due = (await page.getByTestId("gantt-last-move").innerText()).match(/\d{4}-\d{2}-\d{2}/)![0];
    expect(due > PHOTOGRAPHER.depositDue).toBe(true);
    await expect(row(page).getByTestId("item-due")).toHaveText(formatDay(due));
    await expect(row(page).getByTestId("item-moved")).toContainText(formatDay(PHOTOGRAPHER.depositDue));
    await page.screenshot({ path: "screenshots/gantt-after-drag.png", fullPage: true });
    const moved = (await bar.boundingBox())!;
    expect(moved.x).toBeGreaterThan(before.x + 20);

    // Off to another page and back: the widget is rebuilt from the server's dates.
    await page.getByRole("link", { name: "Contracts", exact: true }).click();
    await page.waitForURL("**/contracts");
    await page.getByRole("link", { name: "Timeline", exact: true }).click();
    await page.waitForURL("**/timeline");
    await expect(row(page).getByTestId("item-due")).toHaveText(formatDay(due));
    await expect(bar).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => Math.abs((await bar.boundingBox())!.x - moved.x)).toBeLessThan(3);

    // A full reload reads it back from the server.
    await page.reload();
    await expect(row(page).getByTestId("item-due")).toHaveText(formatDay(due));
    await expect(page.locator(BARS).first()).toBeVisible({ timeout: 120_000 });
    await expect(bar).toBeVisible();
    const state = await (await page.request.get("/api/timeline")).json();
    expect(state.items.find((i: { id: string }) => i.id === deposit.id).due).toBe(due);
  });

  test("a vendor's summary bar stays put when dragged", async ({ page }) => {
    await sampleWedding(page);
    await expect(page.locator(BARS).first()).toBeVisible({ timeout: 120_000 });
    await page.getByTestId("sponsor-gantt").scrollIntoViewIfNeeded();
    await page.waitForTimeout(800);
    const { items } = await (await page.request.get("/api/timeline")).json();
    const deposit = items.find((i: { vendorRole: string; kind: string }) => i.vendorRole === "photographer" && i.kind === "deposit");
    const parent = page.locator(`.b-gantt-task-wrap[data-task-id="${deposit.contractId}"]`).first();
    const box = (await parent.boundingBox())!;
    const moves: string[] = [];
    page.on("request", (r) => r.url().includes("/move") && moves.push(r.url()));

    const [x, y] = [box.x + box.width / 2, box.y + box.height / 2];
    await page.mouse.move(x, y);
    await page.mouse.down();
    for (let i = 1; i <= 10; i++) {
      await page.mouse.move(x + i * 8, y);
      await page.waitForTimeout(25);
    }
    await page.mouse.up();
    await page.waitForTimeout(500);
    expect(moves).toEqual([]);
    // The widget folds the vendor's row on this gesture, which is harmless. No date may change.
    await expect(parent).toBeVisible();
    expect(Math.abs((await parent.boundingBox())!.x - box.x)).toBeLessThan(2);
    await expect(row(page).getByTestId("item-due")).toHaveText(formatDay(PHOTOGRAPHER.depositDue));
  });

  test("a bar for a payment that has gone to approval can't be dragged", async ({ page }) => {
    await sampleWedding(page);
    await expect(page.locator(BARS).first()).toBeVisible({ timeout: 120_000 });
    await row(page).getByTestId("pay-item").click();
    await expect(row(page).getByTestId("approval-prompt")).toBeVisible({ timeout: 30_000 });
    const moved = await page.request.get("/api/timeline").then((r) => r.json());
    const deposit = moved.items.find((i: { vendorRole: string; kind: string }) => i.vendorRole === "photographer" && i.kind === "deposit");
    const refused = await page.request.post(`/api/contracts/${deposit.contractId}/move`, { data: { kind: "deposit", due: "2027-01-05" } });
    expect(refused.status()).toBe(409);
    await row(page).getByRole("button", { name: "Decline" }).click();
    await expect(row(page).getByTestId("pay-item")).toBeVisible({ timeout: 30_000 });
  });
});
