/**
 * The vendor link. The cash plan's "ask for a later date" becomes a link the couple share; the
 * vendor answers on a phone ("the 5th is tight, the 8th is fine", plus their PayPal email); the
 * reply agent reads the date out of those words, code checks it is before the wedding and inside
 * the move range, and move_due_date waits for the couple's approval. Then the date moves, the May
 * bar drops by that balance, and the florist is paid at the account they gave.
 *
 * Runs on mock PayPal (couple on a desktop and on a phone), on the real sandbox (the florist's
 * balance paid to the vendor's sandbox account in PayPal's checkout, re-read from PayPal) and on
 * the hosted copy. With real AI (hosted, or E2E_AI_MODE=live) Claude Haiku reads the reply; the
 * date it must find is the same, because code bounds it and the test checks it.
 */
import { devices, expect, test, type Browser, type Page } from "@playwright/test";
import { approveAndPay } from "./pay-in-checkout";
import { readOrder, sandboxPayeeFor } from "./paypal-reread";
import { FLORIST } from "../../src/lib/wedding/samples";

const TODAY = "2026-11-20";
const REPLY = "The 5th is tight, the 8th is fine";
const month = (page: Page, m: string) => page.locator(`[data-testid="cash-chart-month"][data-month="${m}"]`);
const row = (page: Page, role: string, kind: string) => page.locator(`[data-testid="timeline-item"][data-role="${role}"][data-kind="${kind}"]`);

/** The vendor, on their own phone, with none of the couple's cookies. */
async function vendorAnswers(browser: Browser, link: string, email: string) {
  const { viewport, userAgent, deviceScaleFactor, isMobile, hasTouch } = devices["iPhone 13"];
  const phone = await browser.newContext({ viewport, userAgent, deviceScaleFactor, isMobile, hasTouch });
  const page = await phone.newPage();
  await page.goto(link);
  await expect(page.getByTestId("vendor-ask")).toHaveText(`Could the balance of $1,740.00 move from Sat, May 29, 2027 to Sat, Jun 5, 2027?`);
  await expect(page.getByTestId("vendor-page")).toContainText("Still before the wedding on Sat, Jun 12, 2027.");
  // One card that fits the phone: no sideways scroll, the answer buttons on screen.
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(viewport.width);
  await expect(page.getByTestId("vendor-answer-agreed")).toHaveText("Yes, Jun 5 works");
  await page.getByTestId("vendor-answer-other").click();
  await page.getByTestId("vendor-text").fill(REPLY);
  await page.getByTestId("vendor-paypal-email").fill(email);
  await page.screenshot({ path: "screenshots/vendor-link-phone.png" });
  await page.getByTestId("vendor-send").click();
  await expect(page.getByTestId("vendor-sent")).toContainText("Sent to the couple.");
  return { page, close: () => phone.close() };
}

for (const couple of ["desktop", "phone"] as const) {
  test(`the vendor answers the couple's link on a phone, and the move waits for the couple (couple on a ${couple})`, async ({ browser, request }) => {
    const status = await (await request.get("/api/kit/status")).json();
    const sandbox = status.paypal.mode === "sandbox";
    test.skip(sandbox && couple === "phone", "One sandbox payment is enough; the phone layout is checked on mock PayPal.");
    const device = couple === "phone" ? devices["iPhone 13"] : { viewport: { width: 1440, height: 1000 } };
    const context = await browser.newContext({ ...device, baseURL: test.info().project.use.baseURL });
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    const page = await context.newPage();
    await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
    await page.goto("/timeline");
    await expect(page.getByTestId("timeline-item")).toHaveCount(10);
    await page.getByTestId("ask-agent").click();
    const ask = page.locator('[data-testid="cash-move"][data-item="florist.balance"]');
    await expect(ask).toBeVisible({ timeout: 90_000 });
    await expect(ask.getByTestId("ask-stage")).toHaveText("Not shared yet");

    // Share: a link plus the drafted note, for the couple to send themselves.
    await ask.getByTestId("move-share").click();
    const linkBox = ask.getByTestId("move-link");
    await expect(linkBox).toHaveValue(/\/vendor\/[A-Za-z0-9_-]{24}$/);
    const link = await linkBox.inputValue();
    await expect(ask.getByTestId("move-share-note")).toContainText("You send this link yourself, by text or email. The app doesn't send it.");
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    expect(copied).toContain(`Hello ${FLORIST.vendorName},`);
    expect(copied).toContain(`Answer here: ${link}`);
    await expect(ask.getByTestId("ask-stage")).toHaveText("Shared, waiting for a reply");

    const vendorEmail = sandbox ? sandboxPayeeFor("florist") : "payments@bramble-vetch.example.com";
    // "Own" only if no other sample vendor is paid at that account. With one shared sandbox
    // vendor account (today's setup) it is a stand-in, and the screen says so.
    const own = !sandbox || ["photographer", "caterer", "venue", "band"].every((r) => sandboxPayeeFor(r).toLowerCase() !== vendorEmail.toLowerCase());
    const paidTo = own ? `${FLORIST.vendorName}'s own PayPal: ${vendorEmail}` : `${FLORIST.vendorName}'s PayPal (sandbox stand-in: ${vendorEmail})`;
    const vendor = await vendorAnswers(browser, link, vendorEmail);

    // The couple's card picks the reply up by itself.
    await expect(ask.getByTestId("vendor-reply-text")).toHaveText(`“${REPLY}”`, { timeout: 15_000 });
    await expect(ask.getByTestId("vendor-reply-email")).toHaveText(`Pay them at ${vendorEmail}`);
    const may = month(page, "2027-05");
    await expect(may).toHaveAttribute("data-total-cents", "1580000");
    await ask.getByTestId("move-read").click();

    // Claude (or the fixture) read "the 8th"; code checked it; the move waits for the couple.
    const prompt = ask.getByTestId("approval-prompt");
    await expect(prompt).toBeVisible({ timeout: 90_000 });
    await expect(prompt).toContainText(`Move the ${FLORIST.vendorName} balance ($1,740.00) from Sat, May 29, 2027 to Tue, Jun 8, 2027 and pay ${FLORIST.vendorName} at ${vendorEmail}`);
    await expect(row(page, "florist", "balance").getByTestId("item-due")).toHaveText("Sat, May 29, 2027");
    if (couple === "desktop") await page.screenshot({ path: "screenshots/vendor-link-approve.png", fullPage: true });
    await prompt.getByTestId("approve-button").click();

    await expect(ask.getByTestId("move-done")).toContainText(`Moved to Tue, Jun 8, 2027 on ${FLORIST.vendorName}'s reply. The contract said Sat, May 29, 2027.`, { timeout: 30_000 });
    await expect(ask.getByTestId("move-payee")).toHaveText(`Now paid to ${paidTo}`);
    await expect(row(page, "florist", "balance").getByTestId("item-due")).toHaveText("Tue, Jun 8, 2027");
    // The $1,740.00 leaves May, and the crowded week clears.
    await expect(may).toHaveAttribute("data-total-cents", "1406000");
    await expect(page.locator('[data-testid="cash-warning"][data-kind="same_week"]')).toHaveCount(0);
    await vendor.page.reload();
    await expect(vendor.page.getByTestId("vendor-moved")).toHaveText("The couple moved it to Tue, Jun 8, 2027. Thank you.");
    await vendor.close();

    // The florist's balance now pays the account the vendor gave, through the same approval and checkout.
    await row(page, "florist", "balance").getByTestId("pay-item").click();
    const pay = row(page, "florist", "balance").getByTestId("approval-prompt");
    await expect(pay).toBeVisible({ timeout: 30_000 });
    await expect(pay.getByTestId("approval-to")).toHaveText(FLORIST.vendorName);
    const orderId = await approveAndPay(page, pay, sandbox);
    await expect(row(page, "florist", "balance").getByTestId("item-status")).toHaveText("Paid", { timeout: 120_000 });
    const paid = row(page, "florist", "balance").getByTestId("paid-to-vendor");
    await expect(paid).toHaveText(own ? `Paid to the florist's own PayPal (${vendorEmail})` : `Paid to the florist's PayPal (sandbox stand-in: ${vendorEmail})`);
    await expect(paid).toHaveAttribute("data-own", String(own));
    // No two vendors paid at one account are both called "own".
    const owned = (await page.locator('[data-testid="paid-to-vendor"][data-own="true"] [data-testid="paypal-payee"]').allInnerTexts()).map((e) => e.toLowerCase());
    expect(new Set(owned).size).toBe(owned.length);
    if (!own) await expect(page.getByText(/own PayPal \(/)).toHaveCount(0);
    if (sandbox) {
      const order = await readOrder(orderId);
      const capture = order.purchase_units[0].payments?.captures?.[0];
      console.log(`Vendor link payment, re-read from PayPal: order ${order.id} ${order.status}, payee ${order.purchase_units[0].payee?.email_address}, capture ${capture?.id} ${capture?.status} ${capture?.amount.value} ${capture?.amount.currency_code}`);
      expect(order.status).toBe("COMPLETED");
      expect(order.purchase_units[0].payee?.email_address).toBe(vendorEmail);
      expect(capture).toMatchObject({ status: "COMPLETED", amount: { value: "1740.00", currency_code: "USD" } });
    }
    await context.close();
  });
}

test("a reply with a date after the wedding moves nothing, and says why", async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, baseURL: test.info().project.use.baseURL });
  const page = await context.newPage();
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/timeline");
  await page.getByTestId("ask-agent").click();
  const ask = page.locator('[data-testid="cash-move"][data-item="florist.balance"]');
  await expect(ask).toBeVisible({ timeout: 90_000 });
  await ask.getByTestId("move-share").click();
  await expect(ask.getByTestId("move-link")).toHaveValue(/\/vendor\//);
  const token = (await ask.getByTestId("move-link").inputValue()).split("/vendor/")[1];
  const res = await page.request.post(`/api/vendor/${token}/reply`, { data: { answer: "other", text: "Only after the wedding, say July 1st" } });
  expect(res.ok()).toBe(true);
  await ask.getByTestId("move-read").click({ timeout: 15_000 });
  await expect(ask.getByTestId("move-refused")).toContainText("isn't before the wedding on Sat, Jun 12, 2027, so nothing moves.", { timeout: 90_000 });
  await expect(ask.getByTestId("approval-prompt")).toHaveCount(0);
  await expect(row(page, "florist", "balance").getByTestId("item-due")).toHaveText("Sat, May 29, 2027");
  // A PayPal email the app could never pay is refused on the vendor's page, in plain words.
  const bad = await page.request.post(`/api/vendor/${token}/reply`, { data: { answer: "agreed", paypalEmail: "someone@gmail.com" } });
  expect(bad.status()).toBe(422);
  expect(JSON.stringify(await bad.json())).toMatch(/can only pay/);
  await context.close();
});
