import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { PHOTOGRAPHER } from "../../src/lib/wedding/samples";

const FAKE_AI = `http://127.0.0.1:${Number(process.env.E2E_PORT ?? 3100) + 1000}`;

const aiCalls = async (request: import("@playwright/test").APIRequestContext) => ((await (await request.get(`${FAKE_AI}/calls`)).json()) as { calls: number }).calls;

test("when AI credit runs out, reads and the agent say so, a contract can still go in by hand, and no money moves", async ({ page, request }) => {
  await page.goto("/contracts");
  const text = readFileSync(`public/sample-contracts/${PHOTOGRAPHER.file}`, "utf8");
  await page.getByTestId("contract-text").fill(text);
  await page.getByTestId("read-contract").click();

  const blocked = page.getByTestId("read-blocked");
  await expect(blocked).toContainText("run out of credit");
  expect(await aiCalls(request)).toBeGreaterThan(0);
  await page.screenshot({ path: "test-results-limits/read-blocked.png" });

  // There's still a way forward, with no AI.
  await page.getByTestId("enter-terms").click();
  await page.waitForURL(/\/contracts\/ctr_/);
  await expect(page.getByTestId("read-by")).toHaveText("Not read by AI");
  await page.getByLabel("Vendor name").fill(PHOTOGRAPHER.vendorName);
  await page.getByLabel("PayPal email to pay").fill(PHOTOGRAPHER.payeeEmail!);
  await page.getByLabel("Total", { exact: true }).fill((PHOTOGRAPHER.totalCents / 100).toFixed(2));
  await page.getByLabel("Deposit", { exact: true }).fill((PHOTOGRAPHER.depositCents / 100).toFixed(2));
  await page.getByLabel("Deposit due").fill(PHOTOGRAPHER.depositDue);
  await page.getByLabel("Balance due").fill(PHOTOGRAPHER.balanceDue!);
  await page.screenshot({ path: "test-results-limits/by-hand.png", fullPage: true });
  await page.getByTestId("confirm-terms").click();
  await page.waitForURL(/\/timeline/);
  await expect(page.getByTestId("timeline-item")).toHaveCount(2);

  // The agent stops with the same plain reason.
  const before = await aiCalls(request);
  await page.getByTestId("ask-agent").click();
  const error = page.getByTestId("agent-error");
  await expect(error).toContainText("run out of credit", { timeout: 30_000 });
  await expect(error).toContainText("can't pay anyone without your approval");
  await expect(page.getByTestId("agent-phase")).toHaveText("Stopped");
  expect(await aiCalls(request)).toBeGreaterThan(before);
  await page.screenshot({ path: "test-results-limits/agent-blocked.png" });

  await expect(page.getByTestId("approval-prompt")).toHaveCount(0);
  await expect(page.getByTestId("stat-paid")).toContainText("$0.00");
  const { entries } = await (await page.request.get("/api/paypal/ledger")).json();
  expect(entries).toEqual([]);
});
