/**
 * Save PayPal on the real PayPal sandbox: the couple tick "Save my PayPal", sign in to PayPal's
 * checkout as the sandbox buyer and pay the florist deposit; PayPal saves their PayPal on success.
 * The photographer deposit is then one approval, charged server-side to the saved PayPal, with no
 * checkout window. Skips with the reason when the sandbox buyer's login isn't in .env.shared.
 * The password is read from the environment only. Trace, video and screenshots are off for this
 * file so it can't be recorded, and the field is cleared if sign-in fails part way.
 */
import { expect, test, type Page } from "@playwright/test";
import { formatCents } from "../../src/lib/wedding/cents";
import { FLORIST, PHOTOGRAPHER } from "../../src/lib/wedding/samples";
import { sandboxBuyer, type SandboxBuyer } from "./sandbox-buyer";

test.use({ trace: "off", video: "off", screenshot: "off" });

const row = (page: Page, role: string, kind: string) => page.locator(`[data-testid="timeline-item"][data-role="${role}"][data-kind="${kind}"]`);

/** PayPal's sign-in: email, Next, password, Log In. Clears the password field if anything throws. */
async function signIn(page: Page, buyer: SandboxBuyer) {
  const email = page.locator("#email");
  const password = page.locator("#password");
  await email.or(password).first().waitFor({ timeout: 60_000 });
  if (await email.isVisible()) {
    await email.fill(buyer.email);
    const next = page.locator("#btnNext");
    if (await next.isVisible()) await next.click();
  }
  try {
    await password.waitFor({ state: "visible", timeout: 30_000 });
    await password.fill(buyer.password);
    await page.locator("#btnLogin").click();
    await password.waitFor({ state: "hidden", timeout: 60_000 });
  } catch (error) {
    if (await password.isVisible().catch(() => false)) await password.fill("").catch(() => undefined);
    throw new Error(`Couldn't sign in to the PayPal sandbox as the buyer: ${(error as Error).message.split("\n")[0]}`);
  }
}

/** After sign-in PayPal shows its review page; its one button sends the couple back to the app. */
async function confirmInPayPal(page: Page) {
  const go = page.getByTestId("submit-button-initial").or(page.locator("#payment-submit-btn")).or(page.getByRole("button", { name: /^(Complete Purchase|Agree (&|and) Continue|Save and Continue|Continue|Pay Now|Pay)$/i })).first();
  await go.waitFor({ timeout: 90_000 });
  await go.click();
}

test("sandbox: save PayPal on one checkout, then pay the next with one approval and no checkout window", async ({ page }) => {
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);
  const status = await (await page.request.get("/api/kit/status")).json();
  test.skip(status.paypal.mode !== "sandbox", "The mock flow is save-paypal.spec.ts.");
  const buyer = sandboxBuyer();
  test.skip("missing" in buyer, `${"missing" in buyer ? buyer.missing : ""} isn't set (in .env.shared or the environment), so the sandbox buyer can't sign in to PayPal to save a PayPal.`);
  if ("missing" in buyer) return;
  const before = (await (await page.request.get("/api/timeline")).json()).wallet;
  // A hosted copy decides for itself whether saving is on (PAYPAL_VAULT_SAVE); this suite's own server has it on.
  test.skip(!before.canSave, "Saving a PayPal is switched off on this server (PAYPAL_VAULT_SAVE).");
  expect(before.saved).toBeNull();

  // First: the florist deposit in PayPal's checkout, signed in, asking PayPal to save the PayPal.
  const florist = row(page, "florist", "deposit");
  await florist.getByTestId("pay-item").click();
  const first = florist.getByTestId("approval-prompt");
  await first.getByTestId("save-paypal").check();
  await first.getByTestId("approve-button").click();
  const problem = florist.getByTestId("item-error");
  await page.waitForURL(/sandbox\.paypal\.com/, { timeout: 60_000 }).catch(async (e) => {
    // An order PayPal refused (no Vault permission, say) shows PayPal's own words and debug_id here.
    if (await problem.isVisible()) throw new Error(`PayPal refused the save-PayPal order: ${await problem.textContent()}`);
    throw e;
  });
  const firstOrder = new URL(page.url()).searchParams.get("token");
  await signIn(page, buyer);
  await confirmInPayPal(page);
  await page.waitForURL(/\/timeline/, { timeout: 120_000 });
  await expect(florist.getByTestId("item-status")).toHaveText("Paid", { timeout: 120_000 });
  const timeline = await (await page.request.get("/api/timeline")).json();
  const floristItem = timeline.items.find((i: { vendorRole: string; kind: string }) => i.vendorRole === "florist" && i.kind === "deposit");
  console.log(`Saved-PayPal order ${firstOrder}, capture ${floristItem.payment.captureId}`);
  expect(timeline.wallet.saved, "PayPal captured the order but didn't return a VAULTED payment token").not.toBeNull();

  // Next: the photographer deposit. One approval, charged to the saved PayPal; no checkout opens.
  const photographer = row(page, "photographer", "deposit");
  await photographer.getByTestId("pay-item").click();
  const second = photographer.getByTestId("approval-prompt");
  await expect(second.getByTestId("approve-button")).toHaveText("Approve and pay with saved PayPal");
  await expect(second).toContainText(formatCents(PHOTOGRAPHER.depositCents));
  const url = page.url();
  await second.getByTestId("approve-button").click();
  await expect(photographer.getByTestId("item-status").or(photographer.getByTestId("item-error"))).toHaveText(/Paid|\S/, { timeout: 120_000 });
  if (await photographer.getByTestId("item-error").isVisible()) throw new Error(`PayPal refused the charge to the saved PayPal: ${await photographer.getByTestId("item-error").textContent()}`);
  await expect(photographer.getByTestId("item-status")).toHaveText("Paid", { timeout: 120_000 });
  expect(page.url()).toBe(url);
  await expect(photographer.getByTestId("paid-saved")).toContainText("saved PayPal");
  await expect(page.getByTestId("stat-paid")).toContainText(formatCents(FLORIST.depositCents + PHOTOGRAPHER.depositCents));

  // PayPal's own record of the saved-PayPal charge, re-read with its debug_id.
  await photographer.getByTestId("receipt-open").click();
  const receipt = photographer.getByTestId("receipt");
  await expect(receipt.getByTestId("receipt-capture")).toContainText(`COMPLETED ${(PHOTOGRAPHER.depositCents / 100).toFixed(2)} USD`, { timeout: 60_000 });
  const after = (await (await page.request.get("/api/timeline")).json()).items.find((i: { vendorRole: string; kind: string }) => i.vendorRole === "photographer" && i.kind === "deposit");
  console.log(`Saved-PayPal charge: order ${after.payment.orderId}, capture ${after.payment.captureId}`);
});
