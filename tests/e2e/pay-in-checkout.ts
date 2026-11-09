/**
 * The couple pay an approved payment. In sandbox that's PayPal's own checkout page: they pay as a
 * guest with PayPal's test card, and PayPal sends them back to the timeline. With mock PayPal it's
 * the kit's simulated approval. Used by the tests and the demo.
 */
import { expect, type Locator, type Page } from "@playwright/test";

export async function payInCheckout(page: Page, box: Locator, sandbox: boolean, opts: { typingDelay?: number; beforePay?: () => Promise<void> } = {}) {
  if (!sandbox) {
    await box.getByTestId("simulate-paypal-approval").click();
    await page.getByTestId("mock-approve").click();
    return;
  }
  await box.getByTestId("paypal-checkout").click();
  await page.waitForURL(/sandbox\.paypal\.com/, { timeout: 60_000 });
  await payAsGuest(page, opts);
  await page.waitForURL(/\/timeline/, { timeout: 120_000 });
}

/**
 * "Approve and pay" on an approval card: the one approval, then straight into checkout. In sandbox
 * the browser lands on PayPal's own page; with mock PayPal the simulated checkout opens. Returns the
 * PayPal order id.
 */
export async function approveAndPay(page: Page, prompt: Locator, sandbox: boolean, opts: { typingDelay?: number; beforePay?: () => Promise<void> } = {}): Promise<string> {
  await expect(prompt.getByTestId("approve-button")).toHaveText("Approve and pay");
  await prompt.getByTestId("approve-button").click();
  if (!sandbox) {
    // The simulated checkout can open a moment before its order id fills in.
    const shown = page.getByTestId("mock-order-id");
    await expect(shown).toHaveText(/\S/, { timeout: 60_000 });
    const orderId = (await shown.textContent())!.trim();
    await page.getByTestId("mock-approve").click();
    return orderId;
  }
  await page.waitForURL(/sandbox\.paypal\.com/, { timeout: 60_000 });
  const orderId = new URL(page.url()).searchParams.get("token")!;
  await payAsGuest(page, opts);
  await page.waitForURL(/\/timeline/, { timeout: 120_000 });
  return orderId;
}

/**
 * PayPal opens one of three screens: its card form; its login page, which links to the card form; or a
 * guest page that asks for an email first. Step through whichever it shows until the card form is up.
 * The sandbox login page sometimes never finishes loading its card link; a reload brings it back.
 */
export async function openCardForm(page: Page) {
  const card = page.locator("#cardNumber");
  const cardLink = page.getByRole("button", { name: "Pay with Debit or Credit Card" });
  const guestEmail = page.getByRole("button", { name: "Continue to Payment" });
  const anyStep = card.or(cardLink).or(guestEmail).first();
  for (let step = 0, reloads = 0; step < 4; step++) {
    while (!(await anyStep.waitFor({ timeout: 25_000 }).then(() => true, () => false))) {
      if (++reloads > 2) await expect(anyStep).toBeVisible({ timeout: 1_000 });
      await page.reload();
    }
    if (await card.isVisible()) return;
    if (await cardLink.isVisible()) await cardLink.click();
    else {
      await page.getByRole("textbox", { name: "Email" }).fill("couple@example.com");
      await guestEmail.click();
    }
    await card.waitFor({ timeout: 8_000 }).catch(() => undefined);
  }
  await card.waitFor({ timeout: 30_000 });
}

const CARD = { number: "4111111111111111", expiry: "1230", cvv: "123" };
const onPayPal = (page: Page) => /(^|\.)paypal\.com$/.test(new URL(page.url()).host);

/**
 * Types into one of PayPal's masked fields and checks the digits landed. Typed with no delay, the
 * mask can drop a key, which leaves the form invalid and "Pay now" does nothing; then it's retyped
 * slowly.
 */
async function typeDigits(page: Page, field: string, digits: string, typingDelay: number) {
  const input = page.locator(field);
  for (let attempt = 0; attempt < 3; attempt++) {
    await input.fill("");
    await input.pressSequentially(digits, { delay: attempt === 0 ? typingDelay : 60 });
    const got = (await input.inputValue()).replace(/\D/g, "");
    if (got.endsWith(digits)) return;
    console.log(`[checkout] ${field} read "${got.length} digits" after typing; retyping slowly`);
  }
  await expect(input, `${field} on PayPal's card form`).toHaveValue(new RegExp(digits.split("").join("\\D*")));
}

async function fillCardForm(page: Page, typingDelay: number) {
  await openCardForm(page);
  await typeDigits(page, "#cardNumber", CARD.number, typingDelay);
  await typeDigits(page, "#cardExpiry", CARD.expiry, 0);
  await typeDigits(page, "#cardCvv", CARD.cvv, 0);
  for (const [field, value] of [["#firstName", "Sam"], ["#lastName", "Rivera"]] as const) if (await page.locator(field).count()) await page.locator(field).fill(value);
  await page.locator("#billingLine1").fill("1 Main St");
  await page.locator("#billingCity").fill("San Jose");
  await page.locator("#billingState").selectOption("CA");
  await page.locator("#billingPostalCode").fill("95131");
  if (await page.locator("#phone").count()) await typeDigits(page, "#phone", "4085551234", 0);
  if (await page.locator("#email").count()) await page.locator("#email").fill("couple@example.com");
  // PayPal sometimes opens this form with account creation switched on, which asks for a password.
  const createAccount = page.getByTestId("onboard-options-switch");
  // The switch can sit outside the viewport, where even a forced click is refused, so it's clicked in the page.
  if ((await createAccount.count()) && (await createAccount.isChecked())) await createAccount.evaluate((el: HTMLInputElement) => el.click());
  if (await createAccount.count()) await expect(createAccount).not.toBeChecked();
}

/** What PayPal's page shows when it didn't send the couple back: its URL, any invalid field, any alert. */
async function stuckReport(page: Page): Promise<string> {
  const invalid = await page.locator('[aria-invalid="true"]').evaluateAll((els) => els.map((el) => el.id || el.getAttribute("name") || el.tagName)).catch(() => []);
  const alerts = await page.locator('[role="alert"], .notification-critical, [data-testid*="error"]').allInnerTexts().catch(() => []);
  const url = new URL(page.url());
  return `${url.host}${url.pathname}; invalid fields: ${invalid.join(", ") || "none"}; alerts: ${alerts.map((a) => a.trim()).filter(Boolean).join(" | ").slice(0, 300) || "none"}`;
}

/**
 * PayPal's guest card form, on PayPal's checkout page. Returns once PayPal has sent the browser
 * back to the app. If it hasn't within 45 s, it logs what PayPal's page shows, saves a screenshot
 * and pays once more (the same order, so nothing is paid twice); a second miss fails the run.
 */
export async function payAsGuest(page: Page, { typingDelay = 15, beforePay }: { typingDelay?: number; beforePay?: () => Promise<void> } = {}) {
  const back = (timeout: number) => page.waitForURL((u) => !/(^|\.)paypal\.com$/.test(u.host), { timeout, waitUntil: "commit" }).then(() => true, () => false);
  await fillCardForm(page, typingDelay);
  await beforePay?.();
  const pay = page.getByRole("button", { name: /^Pay now( as guest)?$/i });
  await pay.click();
  if (await back(45_000)) return;
  const first = await stuckReport(page);
  const shot = `test-results/checkout-stuck-${Date.now()}.png`;
  await page.screenshot({ path: shot }).catch(() => undefined);
  console.log(`[checkout] PayPal didn't send the browser back within 45s (${first}); screenshot ${shot}. Paying once more.`);
  if (!onPayPal(page)) return;
  // Still on PayPal: fill whatever its form shows now (a reload brings back a lost form) and pay again.
  if (!(await pay.isVisible().catch(() => false))) await page.reload();
  await fillCardForm(page, 60);
  await pay.click();
  if (await back(60_000)) {
    console.log("[checkout] PayPal sent the browser back after the second try.");
    return;
  }
  throw new Error(`PayPal's checkout didn't return to the app after two tries: ${await stuckReport(page)}`);
}
