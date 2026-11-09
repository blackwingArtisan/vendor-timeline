/**
 * "Assign to a parent". The couple hand the florist's deposit to Linda (Illustrative), who opens her
 * link on a phone and asks to pay. The couple approve it on their timeline, the same approval as any
 * payment; Linda pays in her own PayPal checkout; the row reads "Paid by Linda's PayPal". The payee
 * is still the contract's, and the amount the confirmed term.
 *
 * Runs on mock PayPal, on the real sandbox (Linda pays as a guest with PayPal's test card, and the
 * order is re-read from PayPal) and on the hosted copy. No AI is involved.
 */
import { devices, expect, test } from "@playwright/test";
import { payAsGuest } from "./pay-in-checkout";
import { readOrder } from "./paypal-reread";
import { FLORIST } from "../../src/lib/wedding/samples";

const NAME = "Linda";

test("a parent pays one vendor from their own link, after the couple approve it", async ({ browser, request }) => {
  const status = await (await request.get("/api/kit/status")).json();
  const sandbox = status.paypal.mode === "sandbox";
  const baseURL = test.info().project.use.baseURL;
  const couple = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL });
  await couple.grantPermissions(["clipboard-read", "clipboard-write"]);
  const page = await couple.newPage();
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
  const row = page.locator('[data-testid="timeline-item"][data-role="florist"][data-kind="deposit"]');

  // The couple make Linda's link, and send it themselves.
  await row.getByTestId("assign-open").click();
  await row.getByTestId("assign-name").fill(NAME);
  await row.getByTestId("assign-save").click();
  const link = row.getByTestId("assign-link");
  await expect(link).toHaveValue(/\/contribute\/[A-Za-z0-9_-]{24}$/);
  const url = await link.inputValue();
  await expect(row.getByTestId("assign-note")).toContainText("You send this link yourself, by text or email. The app doesn't send it.");
  await row.getByTestId("assign-copy").click();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`Hi ${NAME}, here's the link to pay the ${FLORIST.vendorName} deposit from your own PayPal: ${url}`);
  await expect(row.getByTestId("item-assignee")).toHaveText(`${NAME} pays this`);

  // Linda, on her own phone, with none of the couple's cookies.
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["iPhone 13"];
  const phone = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch, baseURL });
  const parent = await phone.newPage();
  await parent.goto(url);
  await expect(parent.getByTestId("contrib-ask")).toHaveText(`Pay the ${FLORIST.vendorName} deposit: $600.00`);
  expect(await parent.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await parent.getByTestId("contrib-start").click();
  await expect(parent.getByTestId("contrib-waiting")).toBeVisible();

  // Nothing is sent before the couple approve it, on their own timeline.
  const prompt = row.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 30_000 });
  await expect(prompt).toContainText(`Pay ${FLORIST.vendorName} $600.00 for the deposit, from ${NAME}'s PayPal`);
  await expect(prompt.getByTestId("approval-from")).toHaveText(`${NAME}'s PayPal, in their own checkout`);
  await expect(prompt.getByTestId("approval-to")).toHaveText(FLORIST.vendorName);
  await page.screenshot({ path: "screenshots/contributor-approve.png", fullPage: true });
  await expect(prompt.getByTestId("approve-button")).toHaveText(`Approve for ${NAME}`);
  await prompt.getByTestId("approve-button").click();
  await expect(row.getByTestId("contributor-checkout")).toContainText(`Approved. ${NAME} pays $600.00 to ${FLORIST.vendorName} in their own PayPal checkout, from their link.`, { timeout: 30_000 });
  expect(new URL(page.url()).pathname).toBe("/timeline");

  // Linda pays in PayPal's checkout, with her own account or card.
  const box = parent.getByTestId("contrib-checkout");
  await expect(box).toBeVisible({ timeout: 30_000 });
  let orderId: string;
  if (sandbox) {
    await box.getByTestId("paypal-checkout").click();
    await parent.waitForURL(/sandbox\.paypal\.com/, { timeout: 60_000 });
    orderId = new URL(parent.url()).searchParams.get("token")!;
    await payAsGuest(parent);
    // On a phone, PayPal can follow "Pay now" with a sheet offering an account: go on as a guest.
    const guest = parent.getByRole("button", { name: /^Continue as Guest$/i });
    await expect(async () => {
      if (await guest.isVisible()) await guest.click();
      expect(new URL(parent.url()).pathname).toMatch(/^\/contribute\//);
    }).toPass({ timeout: 120_000, intervals: [1_000] });
  } else {
    await box.getByTestId("simulate-paypal-approval").click();
    const shown = parent.getByTestId("mock-order-id");
    await expect(shown).toHaveText(/\S/);
    orderId = (await shown.textContent())!.trim();
    await parent.getByTestId("mock-approve").click();
  }
  await expect(parent.getByTestId("contrib-paid")).toBeVisible({ timeout: 60_000 });
  await parent.screenshot({ path: "screenshots/contributor-paid-phone.png" });

  // The couple's row: paid, and by whom.
  await expect(row.getByTestId("item-status")).toHaveText("Paid", { timeout: 120_000 });
  await expect(row.getByTestId("item-payer")).toHaveText(`Paid by ${NAME}'s PayPal`);
  await expect(row.getByTestId("paypal-order-id")).toHaveText(orderId);
  const payee = (await row.getByTestId("paypal-payee").textContent())!.trim();
  await expect(parent.getByTestId("contrib-paid")).toContainText(`Paid. ${FLORIST.vendorName} has your $600.00.`, { timeout: 30_000 });
  if (sandbox) {
    const order = await readOrder(orderId);
    const capture = order.purchase_units[0].payments?.captures?.[0];
    console.log(`Contributor payment, re-read from PayPal: order ${order.id} ${order.status}, payee ${order.purchase_units[0].payee?.email_address}, capture ${capture?.id} ${capture?.status} ${capture?.amount.value} ${capture?.amount.currency_code}`);
    expect(order.status).toBe("COMPLETED");
    expect(order.purchase_units[0].payee?.email_address).toBe(payee);
    expect(capture).toMatchObject({ status: "COMPLETED", amount: { value: "600.00", currency_code: "USD" } });
  }
  await phone.close();
  await couple.close();
});

test("a contributor link shows one payment only, and a name or a link it can't use is refused", async ({ browser }) => {
  const couple = await browser.newContext({ baseURL: test.info().project.use.baseURL });
  const page = await couple.newPage();
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
  const row = page.locator('[data-testid="timeline-item"][data-role="florist"][data-kind="balance"]');
  const id = await page.evaluate(async () => (await (await fetch("/api/timeline")).json()).items.find((i: { vendorRole: string; kind: string }) => i.vendorRole === "florist" && i.kind === "balance").contractId);
  const bad = await page.request.post(`/api/contracts/${id}/assign`, { data: { kind: "balance", name: "<script>" } });
  expect(bad.status()).toBe(422);
  await row.getByTestId("assign-open").click();
  await row.getByTestId("assign-name").fill(NAME);
  await row.getByTestId("assign-save").click();
  const url = await row.getByTestId("assign-link").inputValue();
  const token = url.split("/contribute/")[1];
  const view = await (await page.request.get(`/api/contribute/${token}`)).json();
  expect(Object.keys(view).sort()).toEqual(["amount", "captureId", "checkoutUrl", "due", "error", "kind", "name", "orderId", "payee", "sandbox", "state", "vendorName"]);
  expect(view).toMatchObject({ name: NAME, vendorName: FLORIST.vendorName, kind: "balance", amount: "$1,740.00", state: "open" });
  expect((await page.request.get(`/api/contribute/${"x".repeat(24)}`)).status()).toBe(404);
  // Taken back: the link stops working.
  await row.getByTestId("assign-remove").click();
  await expect(row.getByTestId("item-assignee")).toHaveCount(0);
  expect((await page.request.get(`/api/contribute/${token}`)).status()).toBe(404);
  await couple.close();
});
