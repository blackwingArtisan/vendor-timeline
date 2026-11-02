import { readFileSync } from "node:fs";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";
import { BAND, BAND_ANSWERS, CATERER, FLORIST, PHOTOGRAPHER, VENUE, type SampleFacts } from "../../src/lib/wedding/samples";

test.describe.configure({ mode: "serial" });

const sampleText = (s: SampleFacts) => readFileSync(`public/sample-contracts/${s.file}`, "utf8");

/** Use up this minute's reads, the way a busy judge would. */
async function spendReads(api: APIRequestContext, count: number) {
  for (let i = 0; i < count; i += 1) {
    const res = await api.post("/api/contracts", { data: { text: sampleText(PHOTOGRAPHER) } });
    if (!res.ok()) return;
  }
}

async function addContract(page: Page, s: SampleFacts, seen: { waited: number }) {
  await page.goto("/contracts");
  await expect(async () => {
    await page.getByTestId(`sample-${s.vendorRole}`).click();
    await expect(page.getByTestId("contract-text")).toHaveValue(sampleText(s), { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByTestId("read-contract").click();

  const wait = page.getByTestId("read-wait");
  const landed = page.waitForURL(/\/contracts\/ctr_/, { timeout: 90_000 }).then(() => "read" as const);
  const paused = wait.waitFor({ timeout: 90_000 }).then(() => "wait" as const);
  if ((await Promise.race([landed, paused])) === "wait") {
    seen.waited += 1;
    await expect(wait).toContainText("start by itself");
    await page.screenshot({ path: "test-results-limits/read-wait.png" });
    await expect(page.getByText("Could not read that contract")).toHaveCount(0);
  }
  await landed;

  if (s === BAND) {
    await page.getByLabel("PayPal email to pay").fill(BAND_ANSWERS.payeeEmail);
    await page.getByLabel("Balance due").fill(BAND_ANSWERS.balanceDue);
  }
  await expect(page.getByTestId("confirm-terms")).toBeEnabled();
  await page.getByTestId("confirm-terms").click();
  await page.waitForURL(/\/timeline/);
}

test("five contracts in a row at the real 6 a minute limit finish without a dead end", async ({ page, request }) => {
  await spendReads(request, 6);
  const seen = { waited: 0 };
  for (const sample of [PHOTOGRAPHER, CATERER, VENUE, FLORIST, BAND]) await addContract(page, sample, seen);

  expect(seen.waited).toBeGreaterThan(0);
  await page.goto("/timeline");
  await expect(page.locator('[data-testid="timeline-item"]')).toHaveCount(10);
});

test("the agent waits its turn the same way, and stopping leaves it ready to ask again", async ({ page, request }) => {
  await page.goto("/timeline");
  await page.getByRole("button", { name: "Load the five sample contracts" }).click();
  await expect(page.locator('[data-testid="timeline-item"]')).toHaveCount(10);
  await spendReads(request, 7);

  await page.getByTestId("ask-agent").click();
  await expect(page.getByTestId("agent-wait")).toContainText("start by itself");
  await page.screenshot({ path: "test-results-limits/agent-wait.png" });
  await page.getByTestId("agent-wait").getByRole("button", { name: "Stop waiting" }).click();
  await expect(page.getByTestId("agent-wait")).toHaveCount(0);
  await expect(page.getByTestId("ask-agent")).toBeEnabled();

  await page.getByTestId("ask-agent").click();
  await expect(page.getByTestId("agent-phase")).toContainText("Stopped for your approval", { timeout: 90_000 });
});
