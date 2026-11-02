import { expect, test } from "@playwright/test";

const CONTRACT = "This is a fictional contract between the couple and Tuesday Test Photo for a total of $1,000.00.";

test("text pasted before the page is ready still reaches the Read button", async ({ page }) => {
  // Hold the page's scripts so the box is on screen before React is running.
  let release = () => {};
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/_next\/static\/.*\.js/, async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/contracts", { waitUntil: "commit" });
  const box = page.getByTestId("contract-text");
  await box.fill(CONTRACT);
  release();

  await expect(page.getByTestId("read-contract")).toBeEnabled({ timeout: 30_000 });
  await expect(box).toHaveValue(CONTRACT);
});

test("a first visit gets one plan, even with requests racing", async ({ page, context }) => {
  const setCookies: string[] = [];
  page.on("response", async (response) => {
    const header = await response.headerValue("set-cookie").catch(() => null);
    if (header?.includes("vt_plan=")) setCookies.push(header);
  });

  await page.goto("/contracts");
  await expect(page.getByTestId("contract-text")).toBeVisible();
  const plan = (await context.cookies()).find((cookie) => cookie.name === "vt_plan")?.value;
  expect(plan).toMatch(/^plan_/);

  // Every later page and read keeps the same plan.
  await page.goto("/timeline");
  await page.request.get("/api/contracts");
  expect((await context.cookies()).find((cookie) => cookie.name === "vt_plan")?.value).toBe(plan);
  expect(setCookies).toHaveLength(1);
});
