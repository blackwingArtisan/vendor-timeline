import fs from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { getApprovals } from "@/lib/agent/approvals";
import { getMockPayPal } from "@/lib/paypal";
import { addContract, confirmContract, requireContract } from "@/lib/wedding/contracts";
import { assignContributor, contributorCapture, contributorPay, contributorView, findContribution, unassignContributor } from "@/lib/wedding/contributor";
import { checkoutAfterApproval, orderPayee, requestPayment, vendorOrder, viewTimeline } from "@/lib/wedding/pay";
import { PHOTOGRAPHER } from "@/lib/wedding/samples";
import type { Contract } from "@/lib/wedding/types";

const text = fs.readFileSync(path.join("public/sample-contracts", PHOTOGRAPHER.file), "utf8");
let n = 0;
async function confirmed(): Promise<Contract> {
  const plan = `plan_ctrb${String(n++).padStart(8, "0")}`;
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

async function pendingFor(runId: string) {
  for (let i = 0; i < 200; i++) {
    const found = getApprovals().list({ runId, state: "pending" })[0];
    if (found) return found;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error("No approval appeared");
}

beforeEach(async () => {
  await getMockPayPal()!.flushWebhooks();
});

describe("assigning a payment to someone else", () => {
  it("makes one link per payment, keeps it on a rename, and refuses a name it can't show", async () => {
    const c = await confirmed();
    const first = assignContributor(c.planId, c.id, "deposit", "  Linda  ");
    expect(first.name).toBe("Linda");
    expect(first.token).toMatch(/^[A-Za-z0-9_-]{24}$/);
    expect(assignContributor(c.planId, c.id, "deposit", "Mom").token).toBe(first.token);
    expect(() => assignContributor(c.planId, c.id, "deposit", "<script>")).toThrow(/letters only/);
    expect(() => assignContributor(c.planId, c.id, "deposit", "")).toThrow(/letters only/);
    expect(() => assignContributor("plan_zzzzzzzzzzzz", c.id, "deposit", "Linda")).toThrow();
  });

  it("shows the contributor only that one payment, and an unknown or taken-back link is a 404", async () => {
    const c = await confirmed();
    const { token } = assignContributor(c.planId, c.id, "deposit", "Linda");
    expect(contributorView(token)).toEqual({
      name: "Linda",
      vendorName: PHOTOGRAPHER.vendorName,
      kind: "deposit",
      amount: "$1,200.00",
      due: PHOTOGRAPHER.depositDue,
      state: "open",
      orderId: null,
      checkoutUrl: null,
      captureId: null,
      payee: null,
      error: null,
      sandbox: false,
    });
    expect(() => findContribution("x".repeat(24))).toThrow(/isn't valid/);
    expect(() => findContribution("../../etc")).toThrow(/isn't valid/);
    unassignContributor(c.planId, c.id, "deposit");
    expect(() => contributorView(token)).toThrow(/isn't valid/);
  });

  it("the contributor's payment waits for the couple's approval, pays the contract's payee, and returns to their link", async () => {
    const c = await confirmed();
    const { token } = assignContributor(c.planId, c.id, "deposit", "Linda");
    expect(contributorPay(token).state).toBe("waiting");
    const payment = requireContract(c.id).payments.deposit!;
    expect(payment.payer).toEqual({ name: "Linda", token });
    expect(payment.payee).toBe(orderPayee(PHOTOGRAPHER.payeeEmail!));
    // Nothing exists at PayPal before the couple approve.
    expect(payment.orderId).toBeUndefined();
    const view = await viewTimeline(c.planId);
    const item = view.items.find((i) => i.contractId === c.id && i.kind === "deposit")!;
    expect(item.approval?.summary).toBe(`Pay ${PHOTOGRAPHER.vendorName} $1,200.00 for the deposit, from Linda's PayPal`);
    expect(item.contributor).toEqual({ name: "Linda", token });
    // A second ask while it waits is refused.
    expect(() => contributorPay(token)).toThrow(/already has a payment/);

    const decided = getApprovals().decide((await pendingFor(payment.runId)).id, "approved", "couple");
    const after = await checkoutAfterApproval(decided);
    // The couple's browser isn't sent to checkout: Linda pays from her link.
    expect(after).toMatchObject({ payer: "Linda" });
    expect(after).not.toHaveProperty("checkoutUrl");
    const order = requireContract(c.id).payments.deposit!;
    expect(contributorView(token)).toMatchObject({ state: "checkout", orderId: order.orderId });
    const body = vendorOrder(requireContract(c.id), "deposit", { cents: order.cents, payee: order.payee });
    expect(body.payment_source?.paypal?.experience_context?.return_url).toContain(`/contribute/${token}?checkout=`);

    // Someone else's order on this payment is refused; Linda's own is captured.
    await expect(contributorCapture(token, "WRONG-ORDER")).rejects.toThrow(/isn't for this payment/);
    await getMockPayPal()!.simulateBuyerApproval(order.orderId!);
    const paid = await contributorCapture(token, order.orderId!);
    expect(["sending", "paid"]).toContain(paid.state);
    expect(paid.captureId).toBeTruthy();
    expect(() => unassignContributor(c.planId, c.id, "deposit")).toThrow(/already started paying/);
  });

  it("a payment the couple pay themselves shows as taken on the contributor's link", async () => {
    const c = await confirmed();
    const { token } = assignContributor(c.planId, c.id, "deposit", "Linda");
    requestPayment(c.planId, c.id, "deposit", "test");
    expect(contributorView(token).state).toBe("taken");
    await expect(contributorCapture(token, "ANY")).rejects.toThrow(/isn't for this link/);
  });
});
