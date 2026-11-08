import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getApprovals } from "@/lib/agent/approvals";
import { getAuditLog } from "@/lib/agent/audit";
import { getMockPayPal, getPayPal } from "@/lib/paypal";
import { addContract, confirmContract, listContracts, requireContract, saveContract } from "@/lib/wedding/contracts";
import { handleWebhookRequest, processWebhookEvent } from "@/lib/paypal/webhook-handler";
import type { Capture, WebhookEventEnvelope } from "@/lib/paypal/types";
import { moveDueDate } from "@/lib/wedding/contracts";
import { timeline } from "@/lib/events/bus";

import { resetEnvCache } from "@/lib/env";
import { DEFAULT_SANDBOX_VENDOR_EMAIL } from "@/lib/env-core";
import { captureCheckout, captureWebhook, checkoutAfterApproval, choosePayMethod, walletView, orderPayee, sandboxPayee, planChannel, planPayPalIds, webhookPlanChannel, ownsApproval, requestPayment, syncPayment, vendorOrder, viewTimeline, WEBHOOK_WAIT_MS } from "@/lib/wedding/pay";
import { readReceipt } from "@/lib/wedding/receipt";
import { savedPayPal } from "@/lib/wedding/budget";
import { BAND, CATERER, FLORIST, PHOTOGRAPHER, VENUE } from "@/lib/wedding/samples";
import type { Contract } from "@/lib/wedding/types";

const text = fs.readFileSync(path.join("public/sample-contracts", PHOTOGRAPHER.file), "utf8");
const PLAN = "plan_aaaaaaaaaaaa";

let n = 0;
async function confirmedContract(plan = `plan_test${n++}`): Promise<Contract> {
  const contract = await addContract(plan, { text });
  return confirmContract(plan, contract.id, {
    vendorName: PHOTOGRAPHER.vendorName,
    vendorRole: PHOTOGRAPHER.vendorRole,
    payeeEmail: PHOTOGRAPHER.payeeEmail!,
    totalCents: PHOTOGRAPHER.totalCents,
    depositCents: PHOTOGRAPHER.depositCents,
    depositDue: PHOTOGRAPHER.depositDue,
    balanceDue: PHOTOGRAPHER.balanceDue,
  });
}

async function pending(runId: string) {
  for (let i = 0; i < 200; i++) {
    const found = getApprovals().list({ runId, state: "pending" })[0];
    if (found) return found;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("No approval appeared");
}

const paymentOf = (id: string) => requireContract(id).payments.deposit!;

/** The couple approved, so the app has a PayPal order waiting for their checkout. */
async function approvedPayment(contract: Contract) {
  const { contract: asked, finished } = requestPayment(contract.planId, contract.id, "deposit", "test");
  getApprovals().decide((await pending(asked.payments.deposit!.runId)).id, "approved", "couple");
  await finished;
  return paymentOf(contract.id);
}

/** What the couple do in PayPal's checkout, then PayPal sending them back to the app. */
async function payInCheckout(contract: Contract) {
  const { orderId } = paymentOf(contract.id);
  await getMockPayPal()!.simulateBuyerApproval(orderId!);
  await captureCheckout(contract.planId, contract.id, "deposit", orderId!);
  return paymentOf(contract.id);
}

beforeEach(async () => {
  await getMockPayPal()!.flushWebhooks();
});

describe("confirming", () => {
  it("works out the balance itself", async () => {
    const contract = await confirmedContract();
    expect(contract.confirmed!.balanceCents).toBe(PHOTOGRAPHER.balanceCents);
  });

  it("refuses a huge or zero amount and a date years away, before saving anything", async () => {
    const contract = await addContract(`plan_test${n++}`, { text });
    const terms = { vendorName: "V", vendorRole: "photographer" as const, payeeEmail: "a@example.com", totalCents: 480_000, depositCents: 120_000, depositDue: PHOTOGRAPHER.depositDue, balanceDue: PHOTOGRAPHER.balanceDue };
    expect(() => confirmContract(contract.planId, contract.id, { ...terms, totalCents: 99_999_999_900 })).toThrow("Total is too large. The most it can be is $1,000,000.00.");
    expect(() => confirmContract(contract.planId, contract.id, { ...terms, depositCents: 0 })).toThrow("Deposit must be more than $0.00.");
    expect(() => confirmContract(contract.planId, contract.id, { ...terms, balanceDue: "2999-12-31" })).toThrow(/^The balance date must be from/);
    expect(requireContract(contract.id).confirmed).toBeUndefined();
  });

  it("refuses a deposit above the total and a missing balance date", async () => {
    const contract = await addContract(PLAN, { text: "x".repeat(50) });
    const input = { vendorName: "V", vendorRole: "other" as const, payeeEmail: "a@example.com", totalCents: 100, depositCents: 200, depositDue: "2027-01-01", balanceDue: "2027-02-01" };
    expect(() => confirmContract(PLAN, contract.id, input)).toThrow(/more than the/);
    expect(() => confirmContract(PLAN, contract.id, { ...input, depositCents: 50, balanceDue: null })).toThrow(/balance is due/);
  });

  it("hides one couple's contract from another", async () => {
    const contract = await confirmedContract("plan_one");
    expect(listContracts("plan_two").map((c) => c.id)).not.toContain(contract.id);
    expect(() => requestPayment("plan_two", contract.id, "deposit", "test")).toThrow(/not found/);
  });

  it("won't pay an unconfirmed contract", async () => {
    const contract = await addContract(PLAN, { text });
    expect(() => requestPayment(PLAN, contract.id, "deposit", "test")).toThrow(/Confirm this contract/);
  });
});

describe("paying", () => {
  it("moves nothing until a person approves, then the couple pay in PayPal and PayPal confirms it", async () => {
    const contract = await confirmedContract();
    const { contract: asked, finished } = requestPayment(contract.planId, contract.id, "deposit", "test");
    const runId = asked.payments.deposit!.runId;
    const approval = await pending(runId);
    expect(approval.tool).toBe("create_vendor_order");
    expect(approval.amount?.value).toBe("1200.00");
    expect(approval.counterparties).toEqual([PHOTOGRAPHER.payeeEmail]);
    expect(paymentOf(contract.id).orderId).toBeUndefined();
    expect(getAuditLog().list().filter((e) => e.runId === runId && e.action === "tool.executed")).toEqual([]);

    let view = await viewTimeline(contract.planId, "2026-11-20");
    expect(view.items[0]).toMatchObject({ status: "awaiting_approval", approval: { summary: "Pay Quillfeather Photo Studio $1,200.00 for the deposit" } });
    expect(view.totalDueCents).toBe(PHOTOGRAPHER.totalCents);
    // Waiting on the couple doesn't stop a late payment counting as overdue.
    expect((await viewTimeline(contract.planId, "2027-01-01")).overdue).toMatchObject([{ id: view.items[0].id, status: "awaiting_approval" }]);

    getApprovals().decide(approval.id, "approved", "couple");
    await finished;
    const ordered = paymentOf(contract.id);
    expect(ordered).toMatchObject({ state: "awaiting_checkout", orderStatus: "PAYER_ACTION_REQUIRED", payee: PHOTOGRAPHER.payeeEmail });
    expect(ordered.checkoutUrl).toMatch(/checkoutnow\?token=/);
    const order = await getPayPal().orders.get(ordered.orderId!);
    expect(order.intent).toBe("CAPTURE");
    expect(order.purchase_units![0]).toMatchObject({ amount: { currency_code: "USD", value: "1200.00" }, payee: { email_address: PHOTOGRAPHER.payeeEmail } });

    // Not paid until the couple pay in PayPal's checkout.
    await expect(captureCheckout(contract.planId, contract.id, "deposit", ordered.orderId!)).rejects.toThrow(/hasn.t had your approval for this payment yet, so nothing was taken/);
    expect(paymentOf(contract.id).state).toBe("awaiting_checkout");

    const captured = await payInCheckout(contract);
    expect(captured).toMatchObject({ state: "sending", captureStatus: "COMPLETED" });
    expect(captured.captureId).toBeTruthy();

    await getMockPayPal()!.flushWebhooks();
    view = await viewTimeline(contract.planId, "2026-11-20");
    expect(view.items[0]).toMatchObject({ status: "paid", payment: { state: "paid", captureId: captured.captureId, paidBy: "webhook", webhook: { eventType: "PAYMENT.CAPTURE.COMPLETED", captureId: captured.captureId } } });
    expect(view.paidCents).toBe(PHOTOGRAPHER.depositCents);
    expect(view.totalDueCents).toBe(PHOTOGRAPHER.balanceCents);
    expect((await getPayPal().payments.getCapture(captured.captureId!)).amount).toEqual({ currency_code: "USD", value: "1200.00" });
  });

  it("moves nothing when the couple decline, and lets them ask again", async () => {
    const contract = await confirmedContract();
    const { contract: asked, finished } = requestPayment(contract.planId, contract.id, "deposit", "test");
    getApprovals().decide((await pending(asked.payments.deposit!.runId)).id, "denied", "couple");
    await finished;
    expect(paymentOf(contract.id)).toMatchObject({ state: "failed", attempt: 1 });
    expect(paymentOf(contract.id).orderId).toBeUndefined();

    const again = requestPayment(contract.planId, contract.id, "deposit", "test");
    expect(again.contract.payments.deposit!.attempt).toBe(1);
    getApprovals().decide((await pending(again.contract.payments.deposit!.runId)).id, "denied", "couple");
    await again.finished;
  });

  it("won't start a second payment for the same item", async () => {
    const contract = await confirmedContract();
    const { contract: asked, finished } = requestPayment(contract.planId, contract.id, "deposit", "test");
    expect(() => requestPayment(contract.planId, contract.id, "deposit", "test")).toThrow(/already has a payment/);
    getApprovals().decide((await pending(asked.payments.deposit!.runId)).id, "approved", "couple");
    await finished;
    expect(() => requestPayment(contract.planId, contract.id, "deposit", "test")).toThrow(/already has a payment/);
  });

  it("captures only this payment's own order, and only once", async () => {
    const contract = await confirmedContract();
    const other = await confirmedContract();
    await approvedPayment(contract);
    await approvedPayment(other);
    await expect(captureCheckout(contract.planId, contract.id, "deposit", paymentOf(other.id).orderId!)).rejects.toThrow(/isn't for this payment/);
    await expect(captureCheckout("plan_someone_else", contract.id, "deposit", paymentOf(contract.id).orderId!)).rejects.toThrow(/not found/);
    const first = await payInCheckout(contract);
    const spy = vi.spyOn(getPayPal().orders, "capture");
    await captureCheckout(contract.planId, contract.id, "deposit", first.orderId!);
    expect(spy).not.toHaveBeenCalled();
    expect(paymentOf(contract.id).captureId).toBe(first.captureId);
    spy.mockRestore();
  });

  it("won't capture an order PayPal shows for another amount", async () => {
    const contract = await confirmedContract();
    const ordered = await approvedPayment(contract);
    await getMockPayPal()!.simulateBuyerApproval(ordered.orderId!);
    const stored = requireContract(contract.id);
    saveContract({ ...stored, payments: { deposit: { ...ordered, cents: 1100_00 } }, confirmed: { ...stored.confirmed!, depositCents: 1100_00 } });
    const spy = vi.spyOn(getPayPal().orders, "capture");
    await expect(captureCheckout(contract.planId, contract.id, "deposit", ordered.orderId!)).rejects.toThrow(/doesn't match this payment/);
    expect(spy).not.toHaveBeenCalled();
    expect(paymentOf(contract.id)).toMatchObject({ state: "failed" });
    spy.mockRestore();
  });

  it("the guard blocks a payee outside the allowlist", async () => {
    const contract = await confirmedContract();
    saveContract({ ...requireContract(contract.id), confirmed: { ...requireContract(contract.id).confirmed!, payeeEmail: "someone@gmail.com" } });
    const { finished } = requestPayment(contract.planId, contract.id, "deposit", "test");
    await finished;
    expect(paymentOf(contract.id)).toMatchObject({ state: "failed" });
    expect(paymentOf(contract.id).error).toContain("allowlist");
  });

  it("pays the vendor's own address outside sandbox", () => {
    expect(orderPayee(PHOTOGRAPHER.payeeEmail!)).toBe(PHOTOGRAPHER.payeeEmail);
    expect(sandboxPayee(FLORIST.payeeEmail!)).toBeUndefined();
  });

  it("in sandbox pays the florist and caterer to a separate vendor account, the rest to the app's own", () => {
    vi.stubEnv("PAYPAL_MODE", "sandbox");
    vi.stubEnv("PAYPAL_CLIENT_ID", "test-client");
    vi.stubEnv("PAYPAL_CLIENT_SECRET", "test-secret");
    vi.stubEnv("PAYPAL_SANDBOX_SELLER_EMAIL", "own-app@business.example.com");
    resetEnvCache();
    try {
      for (const vendor of [FLORIST, CATERER]) expect(sandboxPayee(vendor.payeeEmail!)).toEqual({ email: DEFAULT_SANDBOX_VENDOR_EMAIL, own: false });
      for (const vendor of [PHOTOGRAPHER, VENUE]) expect(sandboxPayee(vendor.payeeEmail!)).toEqual({ email: "own-app@business.example.com", own: true });
      expect(orderPayee("someone@gmail.com")).toBe("own-app@business.example.com");
    } finally {
      vi.unstubAllEnvs();
      resetEnvCache();
    }
  });
});

describe("the only order the app will ask PayPal for", () => {
  const origin = "https://vendor-timeline.example.com";

  it("is exactly the confirmed term, in dollars, to the contract's payee, with PayPal's checkout coming back here", async () => {
    const contract = await confirmedContract();
    const order = vendorOrder(contract, "deposit", { cents: PHOTOGRAPHER.depositCents, payee: PHOTOGRAPHER.payeeEmail! }, origin);
    expect(order.intent).toBe("CAPTURE");
    expect(order.purchase_units).toEqual([expect.objectContaining({ amount: { currency_code: "USD", value: "1200.00" }, payee: { email_address: PHOTOGRAPHER.payeeEmail } })]);
    expect(order.payment_source?.paypal?.experience_context).toMatchObject({ return_url: `${origin}/timeline?checkout=${contract.id}.deposit`, cancel_url: `${origin}/timeline?cancelled=${contract.id}.deposit`, shipping_preference: "NO_SHIPPING" });
    const balance = vendorOrder(contract, "balance", { cents: PHOTOGRAPHER.balanceCents, payee: PHOTOGRAPHER.payeeEmail! }, origin);
    expect(balance.purchase_units[0].amount.value).toBe((PHOTOGRAPHER.balanceCents / 100).toFixed(2));
  });

  it.each([
    ["one cent more", { cents: PHOTOGRAPHER.depositCents + 1 }, /is more than the confirmed deposit/],
    ["one cent less", { cents: PHOTOGRAPHER.depositCents - 1 }, /doesn't match the confirmed deposit/],
    ["the balance's amount for the deposit", { cents: PHOTOGRAPHER.balanceCents }, /confirmed deposit/],
    ["another payee", { payee: "someone-else@example.com" }, /isn't who this contract pays/],
  ])("refuses %s before any PayPal call", async (_name, change, error) => {
    const contract = await confirmedContract();
    expect(() => vendorOrder(contract, "deposit", { cents: PHOTOGRAPHER.depositCents, payee: PHOTOGRAPHER.payeeEmail!, ...change }, origin)).toThrow(error);
  });

  it("refuses an unconfirmed term before any PayPal call", async () => {
    const contract = await addContract(PLAN, { text });
    expect(() => vendorOrder(contract, "deposit", { cents: PHOTOGRAPHER.depositCents, payee: PHOTOGRAPHER.payeeEmail! }, origin)).toThrow(/Confirm this contract/);
  });

  it("stops a payment whose payee changed under its approval, and PayPal never hears of it", async () => {
    const contract = await confirmedContract();
    const { contract: asked, finished } = requestPayment(contract.planId, contract.id, "deposit", "test");
    const approval = await pending(asked.payments.deposit!.runId);
    const stored = requireContract(contract.id);
    saveContract({ ...stored, payments: { deposit: { ...stored.payments.deposit!, payee: "attacker@example.com" } } });
    const spy = vi.spyOn(getPayPal().orders, "create");
    getApprovals().decide(approval.id, "approved", "couple");
    await finished;
    expect(spy).not.toHaveBeenCalled();
    expect(paymentOf(contract.id)).toMatchObject({ state: "failed" });
    expect(paymentOf(contract.id).orderId).toBeUndefined();
    spy.mockRestore();
  });
});

describe("capture webhooks", () => {
  function captureEvent(payment: { captureId?: string; orderId?: string }, change: Partial<Capture> = {}): WebhookEventEnvelope<string, Capture> {
    return {
      id: `WH-${n++}`,
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      event_version: "1.0",
      create_time: "2026-11-02T03:05:57.307Z",
      resource_type: "capture",
      summary: "Payment completed",
      links: [],
      resource: { id: payment.captureId ?? "CAPTURE-X", status: "COMPLETED", amount: { currency_code: "USD", value: "1200.00" }, final_capture: true, supplementary_data: { related_ids: { order_id: payment.orderId } }, links: [], create_time: "", update_time: "", ...change },
    };
  }

  /** PayPal shows the capture COMPLETED, and only the webhook is missing. */
  async function capturedNoWebhook(contract: Contract) {
    await approvedPayment(contract);
    const paid = await payInCheckout(contract);
    expect(paid).toMatchObject({ state: "sending", captureStatus: "COMPLETED" });
    return paid;
  }

  it("ignores a capture this app didn't make", async () => {
    const contract = await confirmedContract();
    await approvedPayment(contract);
    expect(await captureWebhook(captureEvent({ captureId: "SOMEONE-ELSES", orderId: "SOMEONE-ELSES-ORDER" }))).toBe(false);
  });

  it("shows a payment's webhook only to the couple whose payment it is", async () => {
    const contract = await confirmedContract();
    const paid = await capturedNoWebhook(contract);
    const seen: { channel: string; title: string }[] = [];
    const stop = timeline.subscribe((e) => {
      if (e.kind === "webhook") seen.push({ channel: e.channel, title: e.title });
    });
    await processWebhookEvent(captureEvent(paid));
    // Someone else's sale on the same sandbox: it names nothing of this couple's, so no couple sees it.
    await processWebhookEvent(captureEvent({ captureId: "CAP-COFFEE", orderId: "ORDER-COFFEE" }, { amount: { currency_code: "USD", value: "48.50" } }));
    stop();
    expect(seen[0]).toEqual({ channel: planChannel(contract.planId), title: "PAYMENT.CAPTURE.COMPLETED" });
    expect(seen.filter((e) => e.channel.startsWith("plan:"))).toHaveLength(1);
    expect(webhookPlanChannel(captureEvent({ captureId: "CAP-COFFEE", orderId: "ORDER-COFFEE" }))).toBeUndefined();
    expect(paymentOf(contract.id)).toMatchObject({ state: "paid", paidBy: "webhook" });
  });

  it("lists only this couple's PayPal ids", async () => {
    const mine = await confirmedContract();
    const theirs = await confirmedContract();
    const a = await capturedNoWebhook(mine);
    const b = await capturedNoWebhook(theirs);
    expect([...planPayPalIds(mine.planId)].sort()).toEqual([a.orderId, a.captureId].sort());
    expect(planPayPalIds(mine.planId).has(b.orderId!)).toBe(false);
  });

  it("marks the payment paid from the webhook for its capture, once PayPal's status agrees", async () => {
    const contract = await confirmedContract();
    const paid = await capturedNoWebhook(contract);
    const event = captureEvent(paid);
    expect(await captureWebhook(event)).toBe(true);
    expect(paymentOf(contract.id)).toMatchObject({ state: "paid", paidBy: "webhook", webhook: { eventId: event.id, captureId: paid.captureId } });
  });

  it.each([
    ["another order", () => ({ supplementary_data: { related_ids: { order_id: "OTHER-ORDER" } } }) as Partial<Capture>],
    ["a different amount", () => ({ amount: { currency_code: "USD", value: "1200.01" } })],
    ["a different currency", () => ({ amount: { currency_code: "EUR", value: "1200.00" } })],
  ])("doesn't accept a webhook naming %s", async (_name, change) => {
    const contract = await confirmedContract();
    const paid = await capturedNoWebhook(contract);
    expect(await captureWebhook(captureEvent(paid, change()))).toBe(false);
    expect(paymentOf(contract.id)).toMatchObject({ state: "sending" });
    expect(paymentOf(contract.id).webhook).toBeUndefined();
  });

  it("a webhook alone isn't enough: the capture must exist and PayPal's own status must agree", async () => {
    const contract = await confirmedContract();
    const ordered = await approvedPayment(contract);
    // Early: it names the order, but nothing is captured yet.
    expect(await captureWebhook(captureEvent({ orderId: ordered.orderId, captureId: "EARLY-CAPTURE" }))).toBe(true);
    expect(paymentOf(contract.id).state).toBe("awaiting_checkout");
    const paid = await payInCheckout(contract);
    expect(paid.state).toBe("sending");
    expect(await captureWebhook(captureEvent(paid))).toBe(true);
    expect(paymentOf(contract.id)).toMatchObject({ state: "paid", paidBy: "webhook" });
  });

  it("a receipt is read back from PayPal: its order, its capture, the webhook event and a debug_id per call", async () => {
    const contract = await confirmedContract();
    await expect(readReceipt(contract.planId, contract.id, "deposit")).rejects.toThrow("no receipt");
    const paid = await capturedNoWebhook(contract);
    await expect(readReceipt(contract.planId, contract.id, "deposit")).rejects.toThrow("no receipt");
    const event = captureEvent(paid);
    await captureWebhook(event);
    const receipt = await readReceipt(contract.planId, contract.id, "deposit");
    expect(receipt).toMatchObject({ orderId: paid.orderId, orderStatus: "COMPLETED", captureId: paid.captureId, captureStatus: "COMPLETED", captureAmount: "1200.00 USD", paidBy: "webhook", webhook: { eventId: event.id } });
    expect(receipt.calls.map((c) => c.operation)).toEqual(["orders.get", "payments.getCapture"]);
    for (const call of receipt.calls) expect(call.debugId).toMatch(/^[0-9a-f]{8,}$/);
    // Another couple can't read it.
    await expect(readReceipt("plan_someoneelse", contract.id, "deposit")).rejects.toThrow("not found");
  });

  it("if no webhook ever comes, the capture read from PayPal stands and says so", async () => {
    const contract = await confirmedContract();
    await capturedNoWebhook(contract);
    const stored = requireContract(contract.id);
    const longAgo = new Date(Date.now() - WEBHOOK_WAIT_MS - 1000).toISOString();
    saveContract({ ...stored, payments: { deposit: { ...stored.payments.deposit!, successSeenAt: longAgo } } });
    await syncPayment(contract.id, "deposit");
    expect(paymentOf(contract.id)).toMatchObject({ state: "paid", paidBy: "re-read" });
  });

  it("rejects a webhook with no valid signature before it reaches a payment", async () => {
    const contract = await confirmedContract();
    const paid = await capturedNoWebhook(contract);
    const res = await handleWebhookRequest(new Request("http://localhost/api/paypal/webhooks", { method: "POST", body: JSON.stringify(captureEvent(paid)) }));
    expect(res.status).toBe(400);
    expect(paymentOf(contract.id).state).toBe("sending");
  });
});

describe("moving a payment date", () => {
  it("saves the new date, keeps the contract's date and leaves the amount alone", async () => {
    const contract = await confirmedContract();
    const moved = moveDueDate(contract.planId, contract.id, "deposit", "2026-12-28", "2026-11-20");
    expect(moved.confirmed).toMatchObject({ depositDue: "2026-12-28", depositCents: PHOTOGRAPHER.depositCents });
    const view = await viewTimeline(contract.planId, "2026-11-20");
    expect(view.items[0]).toMatchObject({ due: "2026-12-28", movedFrom: PHOTOGRAPHER.depositDue, cents: PHOTOGRAPHER.depositCents });
    expect(moveDueDate(contract.planId, contract.id, "deposit", "2027-01-02", "2026-11-20").movedFrom?.deposit).toBe(PHOTOGRAPHER.depositDue);
    expect(moveDueDate(contract.planId, contract.id, "deposit", PHOTOGRAPHER.depositDue, "2026-11-20").movedFrom?.deposit).toBeUndefined();
  });

  it("is the same move when sent twice, so a request the hosting proxy dropped can be sent again", async () => {
    const contract = await confirmedContract();
    const once = moveDueDate(contract.planId, contract.id, "deposit", "2026-12-28", "2026-11-20");
    const twice = moveDueDate(contract.planId, contract.id, "deposit", "2026-12-28", "2026-11-20");
    expect(twice.confirmed).toEqual(once.confirmed);
    expect(twice.movedFrom).toEqual({ deposit: PHOTOGRAPHER.depositDue });
  });

  it("refuses a date in the past or years away, in plain words", async () => {
    const contract = await confirmedContract();
    expect(() => moveDueDate(contract.planId, contract.id, "deposit", "2999-12-31", "2026-11-20")).toThrow(/^The new date must be from Fri, Nov 20, 2026 to /);
    expect(() => moveDueDate(contract.planId, contract.id, "deposit", "1999-01-01", "2026-11-20")).toThrow(/^The new date must be from/);
    expect(requireContract(contract.id).confirmed!.depositDue).toBe(PHOTOGRAPHER.depositDue);
  });

  it("refuses a bad date, another couple's contract and a payment already on its way", async () => {
    const contract = await confirmedContract();
    expect(() => moveDueDate(contract.planId, contract.id, "deposit", "2027-02-30", "2026-11-20")).toThrow(/real date/);
    expect(() => moveDueDate("plan_someone", contract.id, "deposit", "2027-01-01", "2026-11-20")).toThrow(/not found/);
    const { contract: asked, finished } = requestPayment(contract.planId, contract.id, "deposit", "test");
    expect(() => moveDueDate(contract.planId, contract.id, "deposit", "2027-01-01", "2026-11-20")).toThrow(/can't move/);
    getApprovals().decide((await pending(asked.payments.deposit!.runId)).id, "denied", "couple");
    await finished;
    expect(moveDueDate(contract.planId, contract.id, "deposit", "2027-01-01", "2026-11-20").confirmed!.depositDue).toBe("2027-01-01");
  });
});

describe("answering an approval", () => {
  it("belongs to the couple whose payment it is", async () => {
    const contract = await confirmedContract();
    const { contract: asked, finished } = requestPayment(contract.planId, contract.id, "deposit", "test");
    const approval = await pending(asked.payments.deposit!.runId);
    expect(ownsApproval(contract.planId, approval)).toBe(true);
    expect(ownsApproval("plan_someone", approval)).toBe(false);
    getApprovals().decide(approval.id, "denied", "couple");
    await finished;
  });

  it("hands back the order right after a yes, so checkout opens with no second step", async () => {
    const contract = await confirmedContract();
    const { contract: asked, finished } = requestPayment(contract.planId, contract.id, "deposit", "test");
    const approval = await pending(asked.payments.deposit!.runId);
    const decided = getApprovals().decide(approval.id, "approved", "couple");
    const checkout = await checkoutAfterApproval(decided);
    await finished;
    expect(checkout.orderId).toBe(paymentOf(contract.id).orderId);
    expect(paymentOf(contract.id).state).toBe("awaiting_checkout");
    // Mock PayPal has no real checkout page to send the browser to.
    expect(checkout.checkoutUrl).toBeUndefined();
  });

  it("hands back nothing after a no", async () => {
    const contract = await confirmedContract();
    const { contract: asked, finished } = requestPayment(contract.planId, contract.id, "deposit", "test");
    const decided = getApprovals().decide((await pending(asked.payments.deposit!.runId)).id, "denied", "couple");
    expect(await checkoutAfterApproval(decided)).toEqual({});
    await finished;
  });
});

describe("the band's contract", () => {
  it("can't be confirmed without the email and date it doesn't give", async () => {
    const contract = await addContract(PLAN, { text: fs.readFileSync(path.join("public/sample-contracts", BAND.file), "utf8") });
    expect(contract.proposed.payeeEmail.value).toBeNull();
    expect(contract.proposed.balanceDue.value).toBeNull();
    expect(contract.confirmed).toBeUndefined();
    expect((await viewTimeline(PLAN)).items.filter((i) => i.contractId === contract.id)).toEqual([]);
  });
});

describe("saving the couple's PayPal for later payments", () => {
  const paymentAt = (id: string, kind: "deposit" | "balance") => requireContract(id).payments[kind]!;

  async function approve(planId: string, contractId: string, kind: "deposit" | "balance", choice: { method?: "checkout" | "saved"; save?: boolean }) {
    const { contract: asked, finished } = requestPayment(planId, contractId, kind, "test");
    const approval = await pending(asked.payments[kind]!.runId);
    // Nothing exists at PayPal while the approval waits.
    expect(paymentAt(contractId, kind).orderId).toBeUndefined();
    choosePayMethod(planId, approval, choice);
    getApprovals().decide(approval.id, "approved", "couple");
    await finished;
    return paymentAt(contractId, kind);
  }

  it("saves it on a checkout the couple asked to save, then charges it for exactly the next term with one approval and no checkout", async () => {
    const contract = await confirmedContract();
    const plan = contract.planId;
    expect(walletView(plan)).toEqual({ saved: null, canSave: true });

    // First payment: PayPal's checkout, asked to save the PayPal on success. PayPal asks for a login, not a guest card.
    const first = await approve(plan, contract.id, "deposit", { method: "checkout", save: true });
    expect(first).toMatchObject({ state: "awaiting_checkout", method: "checkout", saveWallet: true });
    const asked = vendorOrder(requireContract(contract.id), "deposit", { cents: first.cents, payee: first.payee }, "https://app.example", { save: true });
    expect(asked.payment_source?.paypal?.attributes?.vault).toEqual({ store_in_vault: "ON_SUCCESS", usage_type: "MERCHANT", customer_type: "CONSUMER" });
    expect(asked.payment_source?.paypal?.experience_context?.landing_page).toBe("LOGIN");
    expect((await getPayPal().orders.get(first.orderId!)).payment_source?.paypal?.attributes?.vault?.status).toBe("CREATED");
    await getMockPayPal()!.simulateBuyerApproval(first.orderId!);
    await captureCheckout(plan, contract.id, "deposit", first.orderId!);
    const saved = savedPayPal(plan)!;
    expect(saved).toMatchObject({ vaultId: expect.stringMatching(/\S/), fromOrderId: first.orderId });
    expect(walletView(plan)).toMatchObject({ saved: { email: saved.email }, canSave: false });
    // The view never carries the token.
    expect(JSON.stringify(walletView(plan))).not.toContain(saved.vaultId);

    // Later: the balance, charged to the saved PayPal. The order is the confirmed term to the same payee.
    const second = await approve(plan, contract.id, "balance", { method: "saved" });
    expect(second).toMatchObject({ method: "saved", state: "sending", orderStatus: "COMPLETED", captureStatus: "COMPLETED" });
    expect(second.checkoutUrl).toBeUndefined();
    const order = await getPayPal().orders.get(second.orderId!);
    expect(order.purchase_units?.[0]?.amount).toMatchObject({ currency_code: "USD", value: (PHOTOGRAPHER.balanceCents / 100).toFixed(2) });
    expect(order.purchase_units?.[0]?.payee?.email_address).toBe(second.payee);
    expect(order.payment_source?.paypal?.attributes?.vault).toMatchObject({ id: saved.vaultId, status: "VAULTED" });

    // Still not paid: only the capture's webhook, with PayPal's status agreeing, makes it paid.
    expect(paymentAt(contract.id, "balance").state).toBe("sending");
    const event: WebhookEventEnvelope<string, Capture> = {
      id: `WH-VAULT-${n++}`,
      event_type: "PAYMENT.CAPTURE.COMPLETED",
      event_version: "1.0",
      create_time: "2026-11-02T03:05:57.307Z",
      resource_type: "capture",
      summary: "Payment completed",
      links: [],
      resource: { id: second.captureId!, status: "COMPLETED", amount: { currency_code: "USD", value: (PHOTOGRAPHER.balanceCents / 100).toFixed(2) }, final_capture: true, supplementary_data: { related_ids: { order_id: second.orderId } }, links: [], create_time: "", update_time: "" },
    };
    expect(await captureWebhook(event)).toBe(true);
    expect(paymentAt(contract.id, "balance")).toMatchObject({ state: "paid", paidBy: "webhook", webhook: { eventId: event.id } });
  });

  it("won't charge a saved PayPal the plan doesn't have, and a checkout not asked to save saves nothing", async () => {
    const contract = await confirmedContract();
    const { contract: asked } = requestPayment(contract.planId, contract.id, "deposit", "test");
    const approval = await pending(asked.payments.deposit!.runId);
    expect(() => choosePayMethod(contract.planId, approval, { method: "saved" })).toThrow("no saved PayPal");
    getApprovals().decide(approval.id, "denied", "couple");

    const other = await confirmedContract();
    const plain = await approvedPayment(other);
    expect(plain.saveWallet).toBeFalsy();
    await getMockPayPal()!.simulateBuyerApproval(plain.orderId!);
    await captureCheckout(other.planId, other.id, "deposit", plain.orderId!);
    expect(savedPayPal(other.planId)).toBeUndefined();
  });

  it("charges only the confirmed term: an order on a saved PayPal still refuses any other amount", async () => {
    const contract = await confirmedContract();
    const payee = orderPayee(PHOTOGRAPHER.payeeEmail!);
    expect(() => vendorOrder(contract, "deposit", { cents: PHOTOGRAPHER.depositCents + 1, payee }, "https://app.example", { vaultId: "TOKEN-1" })).toThrow("confirmed deposit");
    const body = vendorOrder(contract, "deposit", { cents: PHOTOGRAPHER.depositCents, payee }, "https://app.example", { vaultId: "TOKEN-1" });
    expect(body.payment_source).toEqual({ paypal: { vault_id: "TOKEN-1" } });
    expect(body.purchase_units[0].amount.value).toBe((PHOTOGRAPHER.depositCents / 100).toFixed(2));
  });
});
