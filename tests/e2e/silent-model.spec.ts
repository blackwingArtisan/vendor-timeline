/**
 * Claude sometimes calls its tool without writing a word first (seen on the hosted copy). The
 * browser then gets no model message while the approval waits. This drops every model message
 * from the event stream before the page sees it, and checks the pending approval still shows,
 * with code's own lines and no stand-in reply, and that the approval still pays.
 */
import { expect, test } from "@playwright/test";
import { formatCents } from "../../src/lib/wedding/cents";
import { FLORIST, SAMPLES } from "../../src/lib/wedding/samples";
import { APP_MESSAGE_TITLES } from "../../src/lib/wedding/urgency";
import { approveAndPay } from "./pay-in-checkout";

const TODAY = "2026-11-20";

test("with no word from the model, the pending approval still shows and still pays", async ({ page }) => {
  const status = await (await page.request.get("/api/kit/status")).json();
  test.skip(status.paypal.mode !== "mock", "mock PayPal only: it pays");

  await page.addInitScript((appTitles: readonly string[]) => {
    type Ev = { kind?: string; title?: string };
    const silent = (e: Ev) => !(e.kind === "agent.message" && !appTitles.includes(e.title ?? ""));
    // The panel listens with addEventListener("snapshot" | "timeline"); wrap those listeners.
    const add = EventSource.prototype.addEventListener as (this: EventSource, type: string, listener: EventListener, opts?: boolean | AddEventListenerOptions) => void;
    EventSource.prototype.addEventListener = function (this: EventSource, type: string, listener: EventListenerOrEventListenerObject, opts?: boolean | AddEventListenerOptions) {
      if ((type !== "timeline" && type !== "snapshot") || typeof listener !== "function") return add.call(this, type, listener as EventListener, opts);
      const wrapped = (e: Event) => {
        const data = JSON.parse((e as MessageEvent).data);
        if (type === "snapshot") return listener.call(this, new MessageEvent(type, { data: JSON.stringify((data as Ev[]).filter(silent)) }));
        if (silent(data as Ev)) listener.call(this, e);
      };
      return add.call(this, type, wrapped, opts);
    } as typeof EventSource.prototype.addEventListener;
  }, APP_MESSAGE_TITLES);

  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(SAMPLES.length * 2);
  await page.getByTestId("ask-agent").click();

  const panel = page.getByTestId("agent-panel");
  const prompt = panel.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 90_000 });
  await expect(prompt).toContainText(`Pay ${FLORIST.vendorName} ${formatCents(FLORIST.depositCents)} for the deposit`);
  await expect(page.getByTestId("agent-phase")).toHaveText("Stopped for your approval");
  await expect(panel.getByTestId("agent-chain-step").last()).toHaveText("Waiting for you");

  // Code's lines are there; nothing stands in for the model's missing words.
  await expect(panel.getByTestId("pay-first-by").first()).toHaveText("Checked by code");
  await expect(panel.locator('[data-testid="agent-message"][data-from="app"]').first()).toContainText(`Pay first: the ${FLORIST.vendorName} deposit`);
  await expect(panel.getByTestId("agent-reply")).toHaveCount(0);
  await expect(panel.getByTestId("agent-reply-by")).toHaveCount(0);
  await expect(panel.locator('[data-testid="agent-message"][data-from="agent"]')).toHaveCount(0);

  // The approval still works without the reply.
  await approveAndPay(page, prompt, false);
  await expect(page.locator('[data-testid="timeline-item"][data-role="florist"][data-kind="deposit"]').getByTestId("item-status")).toHaveText("Paid", { timeout: 30_000 });
});
