import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getApprovals } from "@/lib/agent/approvals";
import { getAuditLog } from "@/lib/agent/audit";
import { getMockPayPal, getPayPal } from "@/lib/paypal";
import { addContract, confirmContract, listContracts, requireContract, saveContract } from "@/lib/wedding/contracts";
import { handleWebhookRequest } from "@/lib/paypal/webhook-handler";
import type { PayoutItem, WebhookEventEnvelope } from "@/lib/paypal/types";
import { moveDueDate } from "@/lib/wedding/contracts";
import { ownsApproval, payoutBatchWebhook, payoutItemWebhook, payoutReceiver, requestPayment, syncPayment, viewTimeline, WEBHOOK_WAIT_MS } from "@/lib/wedding/pay";
import { itemId } from "@/lib/wedding/timeline";
import { BAND, PHOTOGRAPHER } from "@/lib/wedding/samples";
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

/** PayPal finishes the batch, and its webhook arrives. */
async function finishOnPayPal() {
  await getMockPayPal()!.advancePayouts();
  await getMockPayPal()!.flushWebhooks();
}

async function approvedPayment(contract: Contract) {
  const { contract: asked, finished } = requestPayment(contract.planId, contract.id, "deposit", "test");
  getApprovals().decide((await pending(asked.payments.deposit!.runId)).id, "approved", "couple");
  await finished;
}

beforeEach(async () => {
  await getMockPayPal()!.advancePayouts();
});

describe("confirming", () => {
  it("works out the balance itself", async () => {
    const contract = await confirmedContract();
    expect(contract.confirmed!.balanceCents).toBe(PHOTOGRAPHER.balanceCents);
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
  it("moves nothing until a person approves, then follows PayPal to paid", async () => {
    const contract = await confirmedContract();
    const { contract: asked, finished } = requestPayment(contract.planId, contract.id, "deposit", "test");
    const runId = asked.payments.deposit!.runId;
    const approval = await pending(runId);
    expect(approval.tool).toBe("create_vendor_payout");
    expect(approval.amount?.value).toBe("1200.00");
    expect(approval.counterparties).toEqual([PHOTOGRAPHER.payeeEmail]);
    expect(paymentOf(contract.id).batchId).toBeUndefined();
    expect(getAuditLog().list().filter((e) => e.runId === runId && e.action === "tool.executed")).toEqual([]);

    let view = await viewTimeline(contract.planId, "2026-11-20");
    expect(view.items[0]).toMatchObject({ status: "awaiting_approval", approval: { summary: "Pay Quillfeather Photo Studio $1,200.00 for the deposit" } });
    expect(view.totalDueCents).toBe(PHOTOGRAPHER.totalCents);

    getApprovals().decide(approval.id, "approved", "couple");
    await finished;
    const sent = paymentOf(contract.id);
    expect(sent.state).toBe("sending");
    expect(sent.batchId).toBeTruthy();

    await finishOnPayPal();
    view = await viewTimeline(contract.planId, "2026-11-20");
    expect(view.items[0]).toMatchObject({ status: "paid", payment: { state: "paid", itemStatus: "SUCCESS", batchId: sent.batchId, paidBy: "webhook" } });
    expect(view.items[0].payment!.transactionId).toBeTruthy();
    expect(view.paidCents).toBe(PHOTOGRAPHER.depositCents);
    expect(view.totalDueCents).toBe(PHOTOGRAPHER.balanceCents);

    const batch = await getPayPal().payouts.get(sent.batchId!);
    expect(batch.items[0].payout_item.amount.value).toBe("1200.00");
  });

  it("moves nothing when the couple decline, and lets them ask again", async () => {
    const contract = await confirmedContract();
    const { contract: asked, finished } = requestPayment(contract.planId, contract.id, "deposit", "test");
    getApprovals().decide((await pending(asked.payments.deposit!.runId)).id, "denied", "couple");
    await finished;
    expect(paymentOf(contract.id)).toMatchObject({ state: "failed", attempt: 1 });
    expect(paymentOf(contract.id).batchId).toBeUndefined();

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

  it("marks a payout PayPal failed, and a retry uses a new batch id", async () => {
    const contract = await confirmedContract();
    const failing = { ...requireContract(contract.id).confirmed!, payeeEmail: "fail@example.com" };
    saveContract({ ...requireContract(contract.id), confirmed: failing });
    const first = requestPayment(contract.planId, contract.id, "deposit", "test");
    getApprovals().decide((await pending(first.contract.payments.deposit!.runId)).id, "approved", "couple");
    await first.finished;
    await getMockPayPal()!.advancePayouts();
    await syncPayment(contract.id, "deposit");
    expect(paymentOf(contract.id)).toMatchObject({ state: "failed", itemStatus: "FAILED", attempt: 1 });

    const second = requestPayment(contract.planId, contract.id, "deposit", "test");
    expect(second.contract.payments.deposit!.attempt).toBe(2);
    getApprovals().decide((await pending(second.contract.payments.deposit!.runId)).id, "denied", "couple");
    await second.finished;
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
    expect(payoutReceiver(PHOTOGRAPHER.payeeEmail!)).toBe(PHOTOGRAPHER.payeeEmail);
  });
});

describe("payout webhooks", () => {
  function itemEvent(contractId: string, batchId: string, change: Partial<PayoutItem["payout_item"]> = {}): WebhookEventEnvelope<string, PayoutItem> {
    const payment = paymentOf(contractId);
    return {
      id: `WH-${n++}`,
      event_type: "PAYMENT.PAYOUTS-ITEM.SUCCEEDED",
      event_version: "1.0",
      create_time: "2026-11-02T03:05:57.307Z",
      resource_type: "payouts_item",
      summary: "Payout item succeeded",
      links: [],
      resource: {
        payout_item_id: "ITEM-1",
        transaction_status: "SUCCESS",
        payout_batch_id: batchId,
        links: [],
        payout_item: { recipient_type: "EMAIL", amount: { currency: "USD", value: "1200.00" }, receiver: payment.receiver, sender_item_id: itemId(contractId, "deposit"), ...change },
      },
    };
  }

  /** PayPal has finished and says SUCCESS, and only the webhook is missing. */
  async function paidOnPayPal(contractId: string) {
    await getMockPayPal()!.advancePayouts();
    await syncPayment(contractId, "deposit");
    expect(paymentOf(contractId)).toMatchObject({ state: "sending", itemStatus: "SUCCESS" });
  }

  it("ignores a batch this app didn't create", async () => {
    const contract = await confirmedContract();
    await approvedPayment(contract);
    expect(await payoutItemWebhook(itemEvent(contract.id, "SOMEONE-ELSES-BATCH"))).toBe(false);
    expect(await payoutBatchWebhook("SOMEONE-ELSES-BATCH")).toBe(false);
  });

  it("marks the payment paid from the webhook that names it", async () => {
    const contract = await confirmedContract();
    await approvedPayment(contract);
    const { batchId } = paymentOf(contract.id);
    await paidOnPayPal(contract.id);
    const event = itemEvent(contract.id, batchId!);
    expect(await payoutItemWebhook(event)).toBe(true);
    expect(paymentOf(contract.id)).toMatchObject({ state: "paid", paidBy: "webhook", webhook: { eventId: event.id, payoutItemId: "ITEM-1" } });
  });

  it.each([
    ["another item in the batch", { sender_item_id: "ctr_other.deposit" }],
    ["a different amount", { amount: { currency: "USD", value: "1200.01" } }],
    ["a different currency", { amount: { currency: "EUR", value: "1200.00" } }],
    ["a different receiver", { receiver: "someone-else@example.com" }],
  ])("doesn't accept a webhook naming %s", async (_name, change) => {
    const contract = await confirmedContract();
    await approvedPayment(contract);
    const { batchId } = paymentOf(contract.id);
    await paidOnPayPal(contract.id);
    expect(await payoutItemWebhook(itemEvent(contract.id, batchId!, change))).toBe(false);
    expect(paymentOf(contract.id)).toMatchObject({ state: "sending" });
    expect(paymentOf(contract.id).webhook).toBeUndefined();
  });

  it("won't let a batch webhook mark anything paid", async () => {
    const contract = await confirmedContract();
    await approvedPayment(contract);
    const { batchId } = paymentOf(contract.id);
    await paidOnPayPal(contract.id);
    expect(await payoutBatchWebhook(batchId!)).toBe(true);
    expect(paymentOf(contract.id)).toMatchObject({ state: "sending" });
  });

  it("a webhook alone isn't enough: PayPal's own status must agree", async () => {
    const contract = await confirmedContract();
    await approvedPayment(contract);
    expect(await payoutItemWebhook(itemEvent(contract.id, paymentOf(contract.id).batchId!))).toBe(true);
    expect(paymentOf(contract.id).state).toBe("sending");
    await paidOnPayPal(contract.id).catch(() => undefined);
    expect(paymentOf(contract.id)).toMatchObject({ state: "paid", paidBy: "webhook" });
  });

  it("if no webhook ever comes, the status read from PayPal stands and says so", async () => {
    const contract = await confirmedContract();
    await approvedPayment(contract);
    await paidOnPayPal(contract.id);
    const stored = requireContract(contract.id);
    const longAgo = new Date(Date.now() - WEBHOOK_WAIT_MS - 1000).toISOString();
    saveContract({ ...stored, payments: { deposit: { ...stored.payments.deposit!, successSeenAt: longAgo } } });
    await syncPayment(contract.id, "deposit");
    expect(paymentOf(contract.id)).toMatchObject({ state: "paid", paidBy: "re-read" });
  });

  it("rejects a webhook with no valid signature before it reaches a payment", async () => {
    const contract = await confirmedContract();
    await approvedPayment(contract);
    const { batchId } = paymentOf(contract.id);
    await paidOnPayPal(contract.id);
    const res = await handleWebhookRequest(new Request("http://localhost/api/paypal/webhooks", { method: "POST", body: JSON.stringify(itemEvent(contract.id, batchId!)) }));
    expect(res.status).toBe(400);
    expect(paymentOf(contract.id).state).toBe("sending");
  });
});

describe("moving a payment date", () => {
  it("saves the new date, keeps the contract's date and leaves the amount alone", async () => {
    const contract = await confirmedContract();
    const moved = moveDueDate(contract.planId, contract.id, "deposit", "2026-12-28");
    expect(moved.confirmed).toMatchObject({ depositDue: "2026-12-28", depositCents: PHOTOGRAPHER.depositCents });
    const view = await viewTimeline(contract.planId, "2026-11-20");
    expect(view.items[0]).toMatchObject({ due: "2026-12-28", movedFrom: PHOTOGRAPHER.depositDue, cents: PHOTOGRAPHER.depositCents });
    expect(moveDueDate(contract.planId, contract.id, "deposit", "2027-01-02").movedFrom?.deposit).toBe(PHOTOGRAPHER.depositDue);
    expect(moveDueDate(contract.planId, contract.id, "deposit", PHOTOGRAPHER.depositDue).movedFrom?.deposit).toBeUndefined();
  });

  it("refuses a bad date, another couple's contract and a payment already on its way", async () => {
    const contract = await confirmedContract();
    expect(() => moveDueDate(contract.planId, contract.id, "deposit", "2027-02-30")).toThrow(/real date/);
    expect(() => moveDueDate("plan_someone", contract.id, "deposit", "2027-01-01")).toThrow(/not found/);
    const { contract: asked, finished } = requestPayment(contract.planId, contract.id, "deposit", "test");
    expect(() => moveDueDate(contract.planId, contract.id, "deposit", "2027-01-01")).toThrow(/can't move/);
    getApprovals().decide((await pending(asked.payments.deposit!.runId)).id, "denied", "couple");
    await finished;
    expect(moveDueDate(contract.planId, contract.id, "deposit", "2027-01-01").confirmed!.depositDue).toBe("2027-01-01");
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
