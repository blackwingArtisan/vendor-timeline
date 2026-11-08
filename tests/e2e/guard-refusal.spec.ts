/**
 * Asked to pay the caterer $5,000, more than any confirmed term, the agent's payment tool is refused
 * by the Guard's check in code: no approval is asked for, no PayPal order is created, and the panel
 * says so in a card of its own. Code reads the amount from the request and asks the Guard itself
 * before any model runs, so a model that declines in words instead of asking can't hide the card.
 * Runs on mock PayPal, the sandbox and the hosted copy, with real AI there too (E2E_AI_MODE=live).
 */
import { expect, test } from "@playwright/test";
import { formatCents } from "../../src/lib/wedding/cents";
import { CATERER } from "../../src/lib/wedding/samples";

const TODAY = "2026-11-20";

test("asked to pay the caterer $5,000, the Guard refuses it and nothing is sent", async ({ page }) => {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(10);

  await page.getByTestId("agent-goal").fill("Pay the caterer $5,000.");
  await page.getByTestId("ask-agent").click();
  const panel = page.getByTestId("agent-panel");
  const card = panel.getByTestId("guard-refusal");
  await expect(card).toBeVisible({ timeout: 90_000 });
  await expect(card).toContainText("The Guard refused this payment of $5,000.00");
  await expect(card).toContainText("No PayPal order was created and no approval was asked for.");
  // The reason is the code's own, naming the confirmed term it checked against. Code reads the ask
  // and sends it to the Guard before any model runs, so it is the same with real AI or without.
  await expect(card.getByTestId("guard-reason")).toHaveText(`$5,000.00 is more than the confirmed deposit of ${formatCents(CATERER.depositCents)} for ${CATERER.vendorName}. Nothing was sent.`);
  await expect(panel.getByTestId("agent-reply")).toHaveText(`I haven't sent anything: the ${CATERER.vendorName} deposit is confirmed at ${formatCents(CATERER.depositCents)}, and only that exact amount can be paid.`);
  await expect(panel.getByTestId("agent-chain-step").last()).toHaveText("Nothing sent");
  await expect(panel.getByTestId("agent-chain-step").nth(-2)).toHaveText("Guard refused $5,000.00");
  await expect(page.getByTestId("agent-phase")).toHaveText("Finished", { timeout: 60_000 });
  await page.screenshot({ path: "screenshots/guard-refusal.png" });

  // Nothing was asked for and nothing exists at PayPal: no approval, no order, nothing paid.
  await expect(page.getByTestId("approval-prompt")).toHaveCount(0);
  const view = await (await page.request.get(`/api/timeline?today=${TODAY}`)).json();
  const caterer = view.items.filter((i: { vendorRole: string }) => i.vendorRole === "caterer");
  expect(caterer.map((i: { payment?: unknown }) => i.payment ?? null)).toEqual([null, null]);
  expect(view.items.some((i: { payment?: { orderId?: string } }) => i.payment?.orderId)).toBe(false);
  await expect(page.getByTestId("stat-paid")).toContainText("$0.00");
  const audit = await (await page.request.get("/api/audit")).json();
  expect(audit.integrity.ok).toBe(true);
});
