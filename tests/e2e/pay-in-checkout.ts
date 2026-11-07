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
 * PayPal opens one of three screens: its card form; its login page, which links to the card form; or a
 * guest page that asks for an email first. Step through whichever it shows until the card form is up.
 */
async function openCardForm(page: Page) {
  const card = page.locator("#cardNumber");
  const cardLink = page.getByRole("button", { name: "Pay with Debit or Credit Card" });
  const guestEmail = page.getByRole("button", { name: "Continue to Payment" });
  for (let step = 0; step < 4; step++) {
    await expect(card.or(cardLink).or(guestEmail).first()).toBeVisible({ timeout: 60_000 });
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

/** PayPal's guest card form, on PayPal's checkout page. */
export async function payAsGuest(page: Page, { typingDelay = 15, beforePay }: { typingDelay?: number; beforePay?: () => Promise<void> } = {}) {
  const card = page.locator("#cardNumber");
  await openCardForm(page);
  await card.pressSequentially("4111111111111111", { delay: typingDelay });
  await page.locator("#cardExpiry").pressSequentially("1230", { delay: typingDelay });
  await page.locator("#cardCvv").pressSequentially("123", { delay: typingDelay });
  for (const [field, value] of [["#firstName", "Sam"], ["#lastName", "Rivera"]] as const) if (await page.locator(field).count()) await page.locator(field).fill(value);
  await page.locator("#billingLine1").fill("1 Main St");
  await page.locator("#billingCity").fill("San Jose");
  await page.locator("#billingState").selectOption("CA");
  await page.locator("#billingPostalCode").fill("95131");
  if (await page.locator("#phone").count()) await page.locator("#phone").pressSequentially("4085551234", { delay: typingDelay });
  if (await page.locator("#email").count()) await page.locator("#email").fill("couple@example.com");
  // PayPal sometimes opens this form with account creation switched on, which asks for a password.
  const createAccount = page.getByTestId("onboard-options-switch");
  // The switch can sit outside the viewport, where even a forced click is refused, so it's clicked in the page.
  if ((await createAccount.count()) && (await createAccount.isChecked())) await createAccount.evaluate((el: HTMLInputElement) => el.click());
  if (await createAccount.count()) await expect(createAccount).not.toBeChecked();
  await beforePay?.();
  await page.getByRole("button", { name: /^Pay now( as guest)?$/i }).click();
}
