import fs from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { appConfig } from "@/app.config";
import { runTool } from "@/lib/agent/execute";
import { Guard } from "@/lib/agent/guard";
import { getPayPal } from "@/lib/paypal";
import { addContract, confirmContract, listContracts, requireContract } from "@/lib/wedding/contracts";
import { recordPaidOutside, requestPayment, vendorOrderTool } from "@/lib/wedding/pay";
import { buildTimeline } from "@/lib/wedding/timeline";
import { PHOTOGRAPHER } from "@/lib/wedding/samples";

const text = fs.readFileSync(path.join("public/sample-contracts", PHOTOGRAPHER.file), "utf8");
const TODAY = "2026-11-20";
let n = 0;

async function photographer() {
  const plan = `plan_outside${n++}`;
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

const view = (planId: string) => buildTimeline(listContracts(planId), TODAY, 500_000);

describe("paid outside PayPal", () => {
  it("records a cheque without any PayPal call, and the timeline and cash check follow it", async () => {
    const contract = await photographer();
    const before = view(contract.planId);
    const create = vi.spyOn(getPayPal().orders, "create");
    recordPaidOutside(contract.planId, contract.id, "deposit", { cents: PHOTOGRAPHER.depositCents, paidOn: "2026-11-12", method: "cheque" }, TODAY);
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();

    const payment = requireContract(contract.id).payments.deposit!;
    expect(payment).toMatchObject({ state: "paid", paidBy: "outside", payee: "", outside: { method: "cheque", paidOn: "2026-11-12" } });
    expect(payment.orderId).toBeUndefined();
    expect(payment.captureId).toBeUndefined();

    const after = view(contract.planId);
    const deposit = after.items.find((i) => i.kind === "deposit")!;
    expect(deposit.status).toBe("paid");
    expect(after.totalDueCents).toBe(before.totalDueCents - PHOTOGRAPHER.depositCents);
    expect(after.paidCents).toBe(PHOTOGRAPHER.depositCents);
    // The cash check counts it on the day they paid, as already paid, in November.
    const cashed = after.cash.months.flatMap((m) => m.payments).find((p) => p.id === deposit.id)!;
    expect(cashed).toMatchObject({ payDate: "2026-11-12", paid: true });
    expect(after.cash.months.find((m) => m.month === "2026-11")!.payments.map((p) => p.id)).toContain(deposit.id);
    // Paid things are never "Pay first" or "Due next".
    expect(after.payFirst?.id).not.toBe(deposit.id);
    expect(after.nextDue?.id).not.toBe(deposit.id);
  });

  it("refuses an amount other than the confirmed term, a future day and a payment already under way", async () => {
    const contract = await photographer();
    expect(() => recordPaidOutside(contract.planId, contract.id, "deposit", { cents: PHOTOGRAPHER.depositCents - 100, paidOn: TODAY, method: "cash" }, TODAY)).toThrow(
      `The confirmed ${PHOTOGRAPHER.vendorName} deposit is $1,200.00, not $1,199.00. Record the full amount you paid, or pay it through PayPal.`,
    );
    expect(() => recordPaidOutside(contract.planId, contract.id, "deposit", { cents: PHOTOGRAPHER.depositCents, paidOn: "2026-11-21", method: "cash" }, TODAY)).toThrow("Sat, Nov 21, 2026 hasn't happened yet. Record a payment once it's made.");
    expect(() => recordPaidOutside(contract.planId, contract.id, "deposit", { cents: PHOTOGRAPHER.depositCents, paidOn: "not a day", method: "cash" }, TODAY)).toThrow("Enter the day you paid as a real date.");
    expect(requireContract(contract.id).payments.deposit).toBeUndefined();

    // Already gone to PayPal: it can't also be marked paid outside.
    requestPayment(contract.planId, contract.id, "balance", "test");
    expect(() => recordPaidOutside(contract.planId, contract.id, "balance", { cents: PHOTOGRAPHER.balanceCents, paidOn: TODAY, method: "cash" }, TODAY)).toThrow("This balance already has a payment.");
  });

  it("the Guard never moves money for it: the agent's payment tool is refused and no order is made", async () => {
    const contract = await photographer();
    recordPaidOutside(contract.planId, contract.id, "deposit", { cents: PHOTOGRAPHER.depositCents, paidOn: TODAY, method: "cash" }, TODAY);
    const create = vi.spyOn(getPayPal().orders, "create");
    const guard = new Guard({ paypal: getPayPal(), policy: appConfig.agentPolicy });
    const result = await runTool(vendorOrderTool(contract.planId), { contract_id: contract.id, kind: "deposit", amount: "1200.00" }, { runId: "run_outside", actor: "agent", channel: "test", guard });
    expect(result.isError).toBe(true);
    expect(result.outcome?.status).toBe("denied");
    expect(result.content).toContain("paid this deposit outside PayPal, so nothing can be sent for it");
    // The Pay button's path is refused the same way, before any approval is asked.
    expect(() => requestPayment(contract.planId, contract.id, "deposit", "test")).toThrow("paid this deposit outside PayPal");
    expect(create).not.toHaveBeenCalled();
    create.mockRestore();
    expect(requireContract(contract.id).payments.deposit).toMatchObject({ state: "paid", paidBy: "outside" });
  });
});
