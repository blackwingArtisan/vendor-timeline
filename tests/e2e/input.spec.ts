/**
 * Bad input is refused in plain words, the words stay until dismissed, and no screen goes blank.
 * Runs on mock PayPal (npm run test:e2e), on the sandbox, and against the hosted copy. It needs no
 * AI: every contract here is refused before any read, or entered by hand.
 */
import { expect, test, type Page } from "@playwright/test";
import { openCashCheck } from "./open-cash";
import { formatDay } from "../../src/lib/wedding/dates";
import { CATERER } from "../../src/lib/wedding/samples";

const TODAY = "2026-11-20";
const JARGON = /Invalid request|PAYER_ACTION_REQUIRED|ORDER_NOT_APPROVED|Expected|Too big|Request failed/;
const row = (page: Page, role: string, kind: string) => page.locator(`[data-testid="timeline-item"][data-role="${role}"][data-kind="${kind}"]`);

async function fiveContracts(page: Page) {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/timeline");
  // A new visitor starts on the labelled sample plan, already confirmed.
  await expect(page.getByTestId("sample-plan")).toContainText("Sample plan");
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
}

test("a huge or zero budget is refused beside the box, and the server refuses it too", async ({ page }) => {
  await fiveContracts(page);
  await openCashCheck(page);
  const budget = page.getByTestId("monthly-budget");
  await budget.fill("99,999,999,999");
  await page.getByTestId("save-budget").click();
  await expect(page.getByTestId("budget-problem")).toHaveText("Monthly budget is too large. The most it can be is $1,000,000.00.");
  await budget.fill("0");
  await page.getByTestId("save-budget").click();
  await expect(page.getByTestId("budget-problem")).toHaveText("Monthly budget must be more than $0.00.");
  await budget.fill("-50");
  await page.getByTestId("save-budget").click();
  await expect(page.getByTestId("budget-problem")).toHaveText("Monthly budget can't be below zero.");
  await expect(page.getByTestId("page-error")).toHaveCount(0);

  for (const monthlyBudgetCents of [1e18, -100, 0]) {
    const res = await page.request.post("/api/timeline/budget", { data: { monthlyBudgetCents } });
    expect(res.status()).toBe(422);
    const { error } = await res.json();
    expect(error.message).toMatch(/^Monthly budget (is too large|must be more than|must be an amount)/);
    expect(error.message).not.toMatch(JARGON);
  }
});

test("a date years away is refused when moving a payment, and nothing moves", async ({ page }) => {
  test.skip(process.env.NEXT_PUBLIC_SPONSOR_UI === "1", "The Gantt drag can't reach a date off its chart.");
  await fiveContracts(page);
  const balance = row(page, "caterer", "balance");
  await balance.getByTestId("move-date").click();
  await balance.getByTestId("move-date-input").fill("2999-01-01");
  await balance.getByTestId("move-date-save").click();
  await expect(balance.getByTestId("move-date-error")).toContainText("The new date must be from");
  await expect(balance.getByTestId("move-date-error")).toContainText(formatDay(TODAY));
  await balance.getByTestId("move-date-input").fill("2026-01-01");
  await balance.getByTestId("move-date-save").click();
  await expect(balance.getByTestId("move-date-error")).toContainText("The new date must be from");
  await page.reload();
  await expect(row(page, "caterer", "balance").getByTestId("item-due")).toHaveText(formatDay(CATERER.balanceDue!));

  const { items } = await (await page.request.get(`/api/timeline?today=${TODAY}`)).json();
  const item = items.find((i: { vendorRole: string; kind: string }) => i.vendorRole === "caterer" && i.kind === "balance");
  const res = await page.request.post(`/api/contracts/${item.contractId}/move`, { data: { kind: "balance", due: "2999-01-01", today: TODAY } });
  expect(res.status()).toBe(422);
  expect((await res.json()).error.message).toMatch(/^The new date must be from /);
});

test("a huge, negative or too-big amount and a far-off date are named on the form, with no white screen", async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/contracts");
  // Entered by hand, so no AI reads it.
  const res = await page.request.post("/api/contracts/manual", { data: { text: "Typed in by hand.", fileName: "typed.txt" } });
  expect(res.ok()).toBe(true);
  const { id } = await res.json();
  await page.goto(`/contracts/${id}`);

  const total = page.getByLabel("Total", { exact: true });
  await total.fill("99999999999999999999");
  await expect(page.getByTestId("problem-total")).toHaveText("Total is too large. The most it can be is $1,000,000.00.");
  await expect(page.getByTestId("page-error")).toHaveCount(0);
  await total.fill("-100");
  await expect(page.getByTestId("problem-total")).toHaveText("Total can't be below zero.");
  await total.fill("0");
  await expect(page.getByTestId("problem-total")).toHaveText("Total must be more than $0.00.");
  await total.fill("4800.999");
  await expect(page.getByTestId("problem-total")).toHaveText("Total can't have more than two digits after the point.");
  await total.fill("4,800");
  await expect(page.getByTestId("problem-total")).toHaveCount(0);

  await page.getByLabel("Deposit", { exact: true }).fill("5,000");
  await expect(page.getByTestId("problem-deposit")).toHaveText("The deposit can't be more than the total of $4,800.00.");
  await page.getByLabel("Deposit due").fill("2999-01-01");
  await expect(page.getByTestId("problem-deposit-due")).toContainText("The deposit date must be from");
  await expect(page.getByText(/terms? needs? a look/)).toBeVisible();
  await expect(page.getByTestId("confirm-terms")).toBeDisabled();

  // The server refuses the same things even if the form is skipped.
  const bad = { vendorName: "Typed Vendor", vendorRole: "venue", payeeEmail: "typed@example.com", depositDue: "2027-01-10", balanceDue: "2027-05-01" };
  for (const [change, message] of [
    [{ totalCents: 99_999_999_900, depositCents: 100_00 }, /^Total is too large/],
    [{ totalCents: 4_800_00, depositCents: 0 }, /^Deposit must be more than \$0\.00/],
    [{ totalCents: 4_800_00, depositCents: 100_00, balanceDue: "2999-01-01" }, /^The balance date must be from /],
  ] as const) {
    const r = await page.request.post(`/api/contracts/${id}/confirm`, { data: { ...bad, ...change } });
    expect(r.status()).toBe(422);
    const msg = (await r.json()).error.message;
    expect(msg).toMatch(message);
    expect(msg).not.toMatch(JARGON);
  }
});

test("too long a contract, or a picture, is refused in plain words before any AI reads it", async ({ page }) => {
  await page.goto("/contracts");
  const box = page.getByTestId("contract-text");
  await expect(box).toBeEditable();
  await expect(async () => {
    await box.fill("Payment terms. ".repeat(1_400)); // 21,000 characters
    await expect(page.getByText("That contract is too long. The most the app reads is 20,000 characters")).toBeVisible({ timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await expect(page.getByTestId("read-contract")).toBeDisabled();

  const res = await page.request.post("/api/contracts", { data: { text: "Payment terms. ".repeat(1_400) } });
  expect(res.status()).toBe(400);
  expect((await res.json()).error.message).toBe("That contract is too long. The most the app reads is 20,000 characters, so paste just the payment terms.");

  await box.fill("");
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  await page.getByTestId("upload-contract").setInputFiles({ name: "photo.png", mimeType: "image/png", buffer: png });
  await expect(page.getByTestId("file-problem")).toHaveText("photo.png isn't a .txt or .pdf file, so nothing was added. Upload the contract as text or a PDF.");
  await expect(box).toHaveValue("");
  await page.getByTestId("upload-contract").setInputFiles({ name: "renamed.txt", mimeType: "text/plain", buffer: Buffer.concat([png, Buffer.alloc(64)]) });
  await expect(page.getByTestId("file-problem")).toHaveText("renamed.txt doesn't contain readable text, so nothing was added.");
  await expect(box).toHaveValue("");

  // A good file afterwards clears the old message.
  await page.getByTestId("upload-contract").setInputFiles(`public/sample-contracts/${CATERER.file}`);
  await expect(page.getByTestId("file-problem")).toHaveCount(0);
  await expect(box).not.toHaveValue("");
});

test("an error stays on screen until it is dismissed, in plain words", async ({ page }) => {
  await page.goto("/timeline?checkout=missing.deposit");
  const toast = page.getByTestId("toast-error");
  await expect(toast).toContainText("Nothing was paid");
  await expect(toast).not.toContainText(JARGON);
  await page.waitForTimeout(9_000);
  await expect(toast).toBeVisible();
  // The same message again shows once.
  await page.goto("/timeline?checkout=missing.deposit");
  await expect(page.getByTestId("toast-error")).toHaveCount(1);
  await toast.getByRole("button", { name: "Dismiss" }).click();
  await expect(page.getByTestId("toast-error")).toHaveCount(0);
});
