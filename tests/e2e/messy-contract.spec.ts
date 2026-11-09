/**
 * A messy contract: the venue states its fee two ways, asks for 30% of it, gives the balance a
 * moment instead of a day and no email to pay. The review screen leaves each of those blank and
 * flagged, and nothing can be confirmed until the couple fills them in. Runs on mock AI, the
 * sandbox and the hosted copy with real Claude (E2E_AI_MODE=live): whatever the model reads,
 * the price stated two ways is caught in code, and the blank terms must stay blank, not invented.
 */
import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";
import { amountText, formatCents, percentOfCents } from "../../src/lib/wedding/cents";
import { formatDay } from "../../src/lib/wedding/dates";
import { MESSY_VENUE, MESSY_VENUE_ANSWERS, MESSY_VENUE_FEES_CENTS } from "../../src/lib/wedding/samples";

const text = readFileSync(`public/sample-contracts/${MESSY_VENUE.file}`, "utf8");

test("a messy contract's unclear terms stay blank and flagged until the couple fills them in", async ({ page }) => {
  test.setTimeout(180_000);
  const status = await (await page.request.get("/api/kit/status")).json();
  const live = status.ai.mode === "live";

  await page.goto("/timeline");
  await page.getByTestId("start-own-plan").click();
  await expect(page.getByText("Nothing confirmed yet")).toBeVisible();

  await page.goto("/contracts");
  // A click in the first moments of a page does nothing, for a person too, so click again.
  await expect(async () => {
    await page.getByTestId("sample-messy").click();
    await expect(page.getByTestId("contract-text")).toHaveValue(text, { timeout: 2_000 });
  }).toPass({ timeout: 30_000 });
  await page.getByTestId("read-contract").click();
  await page.waitForURL(/\/contracts\/ctr_/, { timeout: 90_000 });
  await expect(page.getByTestId("read-by")).toContainText(live ? "Read by Claude" : "Read without AI");
  if (live) {
    const read = await (await page.request.get(`/api/contracts/${new URL(page.url()).pathname.split("/").pop()}`)).json();
    console.log(`Real AI read of the messy contract: ${JSON.stringify({ read: read.read, proposed: read.proposed })}`);
  }

  // The fee is stated two ways: no number is taken, and the flag says why.
  await expect(page.getByLabel("Total", { exact: true })).toHaveValue("");
  await expect(page.getByTestId("flag-total")).toBeVisible();
  if (!live) for (const fee of MESSY_VENUE_FEES_CENTS) await expect(page.getByTestId("flag-total")).toContainText(formatCents(fee).replace(".00", ""));
  // The deposit is a share of that fee, so it can't be known yet either.
  await expect(page.getByLabel("Deposit", { exact: true })).toHaveValue("");
  await expect(page.getByTestId("flag-deposit")).toBeVisible();
  // No email and no day for the balance: blank and flagged, never made up.
  await expect(page.getByLabel("PayPal email to pay")).toHaveValue("");
  await expect(page.getByTestId("flag-email")).toBeVisible();
  await expect(page.getByLabel("Balance due")).toHaveValue("");
  await expect(page.getByTestId("flag-balance-due")).toBeVisible();
  // What the contract does say plainly is still read, and its date is worked out in code.
  // The header names the site and the trust that runs it; real Claude may pick either, and both are right.
  await expect(page.getByLabel("Vendor name")).toHaveValue(live ? /^(Larkspur Point Pavilion|Alder Falls Parks Trust)$/i : MESSY_VENUE.vendorName);
  await expect(page.getByLabel("Deposit due")).toHaveValue(MESSY_VENUE.depositDue);
  await page.screenshot({ path: `screenshots/messy-review-${live ? "live-ai" : "mock-ai"}.png`, fullPage: true });

  // Nothing counts until it's confirmed, and it can't be confirmed with terms missing.
  await expect(page.getByTestId("confirm-terms")).toBeDisabled();
  for (const need of ["an email to pay", "a total", "the balance date"]) await expect(page.getByTestId("still-needed")).toContainText(need);
  const review = page.url();
  await page.goto("/timeline");
  await expect(page.getByText("Nothing confirmed yet")).toBeVisible();
  await page.goto(review);

  // The couple asks the venue and types the answers in. The 30% deposit follows the total.
  await page.getByLabel("Total", { exact: true }).fill(amountText(MESSY_VENUE_ANSWERS.totalCents));
  const deposit = page.getByLabel("Deposit", { exact: true });
  if (!live) {
    await expect(deposit).toHaveValue(amountText(MESSY_VENUE.depositCents));
    await expect(page.getByTestId("basis-deposit")).toHaveText(`30% of ${formatCents(MESSY_VENUE_ANSWERS.totalCents)}, worked out by the app`);
  } else if (!(await deposit.inputValue())) {
    await deposit.fill(amountText(percentOfCents(MESSY_VENUE_ANSWERS.totalCents, 30)));
  }
  await expect(page.getByTestId("balance-value")).toHaveText(formatCents(MESSY_VENUE.balanceCents));
  await page.getByLabel("PayPal email to pay").fill(MESSY_VENUE_ANSWERS.payeeEmail);
  await page.getByLabel("Balance due").fill(MESSY_VENUE_ANSWERS.balanceDue);
  await expect(page.getByTestId("still-needed")).toHaveText("Ready when you are.");
  await page.getByTestId("confirm-terms").click();
  await page.waitForURL(/\/timeline/);

  const row = (kind: string) => page.locator(`[data-testid="timeline-item"][data-role="venue"][data-kind="${kind}"]`);
  await expect(row("deposit").getByTestId("item-amount")).toHaveText(formatCents(MESSY_VENUE.depositCents));
  await expect(row("deposit").getByTestId("item-due")).toHaveText(formatDay(MESSY_VENUE.depositDue));
  await expect(row("balance").getByTestId("item-amount")).toHaveText(formatCents(MESSY_VENUE.balanceCents));
  await expect(row("balance").getByTestId("item-due")).toHaveText(formatDay(MESSY_VENUE_ANSWERS.balanceDue));
});
