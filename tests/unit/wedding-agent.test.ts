import { beforeEach, describe, expect, it, vi } from "vitest";
import { appConfig } from "@/app.config";
import { paymentAgent } from "@/agents/payments";
import { getApprovals } from "@/lib/agent/approvals";
import { getAuditLog } from "@/lib/agent/audit";
import { Guard } from "@/lib/agent/guard";
import { startAgentRun } from "@/lib/agent/runs";
import { runScriptedAgent } from "@/lib/agent/scripted";
import { timeline } from "@/lib/events/bus";
import { getMockPayPal, MockPayPal } from "@/lib/paypal";
import { addContract, listContracts, requireContract } from "@/lib/wedding/contracts";
import { loadSampleWedding } from "@/lib/wedding/demo";
import { CATERER, FLORIST, PHOTOGRAPHER } from "@/lib/wedding/samples";
import type { ScriptStep } from "@/lib/agent/define";

const TODAY = "2026-11-20";
const GOAL = "Set up the next payment.";

let n = 0;
function wedding() {
  const plan = `plan_agent_${n++}`;
  loadSampleWedding(plan);
  const photographer = listContracts(plan).find((c) => c.confirmed!.vendorRole === "photographer")!;
  return { plan, photographer };
}

/** A script is the agent's decisions with AI switched off: here, whatever a test wants it to try. */
async function runScript(plan: string, script: ScriptStep[]) {
  const paypal = new MockPayPal();
  const create = vi.spyOn(paypal.orders, "create");
  const runId = `run_test_${n++}`;
  const guard = new Guard({ paypal, policy: appConfig.agentPolicy });
  const results: Record<string, { error?: { code: string; reason: string }; order_id?: string }> = {};
  const capture: ScriptStep[] = script.map((s) => ({ ...s, as: s.as ?? "last" }));
  capture.push({ say: (r) => (Object.assign(results, r), "done") });
  await runScriptedAgent({ runId, channel: "test", def: paymentAgent(plan, TODAY), input: { goal: GOAL }, guard, script: capture, pauseMs: 0 });
  return { results, create, runId };
}

const ask = (contract_id: string, amount: string, kind = "deposit"): ScriptStep => ({ tool: "create_vendor_order", input: { contract_id, kind, amount } });

async function pendingFor(runId: string) {
  for (let i = 0; i < 1500; i++) {
    const found = getApprovals().list({ runId, state: "pending" })[0];
    if (found) return found;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("No approval appeared");
}

async function settled(run: { status: string }) {
  for (let i = 0; i < 1500 && run.status === "running"; i++) await new Promise((r) => setTimeout(r, 10));
  expect(run.status).toBe("completed");
}

beforeEach(async () => {
  await getMockPayPal()!.flushWebhooks();
});

describe("what the agent can reach", () => {
  it("has one read tool and one money tool, and the money tool takes no receiver", () => {
    const tools = paymentAgent("plan_x", TODAY).tools();
    expect(tools.map((t) => [t.name, t.risk])).toEqual([["review_payments", "read"], ["create_vendor_order", "money"]]);
    expect(tools[1].impact).toBeTypeOf("function");
    expect(tools[1].parse({ contract_id: "c", kind: "deposit", amount: "1.00", receiver: "thief@example.com" })).toEqual({ contract_id: "c", kind: "deposit", amount: "1.00" });
  });

  it("can't call the kit's open payout tool", async () => {
    const { plan } = wedding();
    await expect(runScript(plan, [{ tool: "create_payout", input: { items: [{ receiver: "a@example.com", amount: "1.00", currency: "USD" }] } }])).rejects.toThrow(/unknown tool/);
  });
});

describe("the review", () => {
  it("puts the overdue florist deposit first, names the next payment and the clash, with every figure from code", async () => {
    const { plan, photographer } = wedding();
    const florist = listContracts(plan).find((c) => c.confirmed!.vendorRole === "florist")!;
    const review = await paymentAgent(plan, TODAY).tools()[0].execute({}, { runId: "r", actor: "a", paypal: getMockPayPal()!, idempotencyKey: "", requestId: "" });
    expect(review).toMatchObject({
      monthly_budget: "$5,000.00",
      pay_first: { contract_id: florist.id, vendor: FLORIST.vendorName, kind: "deposit", amount_text: "$600.00", status: "overdue" },
      next_payment: { contract_id: photographer.id, vendor: PHOTOGRAPHER.vendorName, kind: "deposit", amount: "1200.00", amount_text: "$1,200.00", due: "Fri, Dec 18, 2026" },
      overdue: [{ vendor: FLORIST.vendorName, amount_text: "$600.00" }],
    });
    expect((review as { warnings: string[] }).warnings.join(" ")).toContain(`${CATERER.vendorName} balance ($10,460.00) and ${FLORIST.vendorName} balance ($1,740.00) land together`);
  });

  it("says the same thing with AI switched off", () => {
    const { plan } = wedding();
    const said = paymentAgent(plan, TODAY).mockScript!({ goal: GOAL }).map((s) => s.say).filter((s) => typeof s === "string").join(" ");
    expect(said).toContain(`Next up is ${PHOTOGRAPHER.vendorName}: the deposit of $1,200.00, due Fri, Dec 18, 2026.`);
    expect(said).toContain(`The ${FLORIST.vendorName} deposit is overdue, so it goes first.`);
    expect(said.indexOf("Overdue:")).toBeLessThan(said.indexOf("Next up"));
  });

  it("shows the couple every warning itself, whatever the model says", async () => {
    const { plan } = wedding();
    const shown: string[] = [];
    const stop = timeline.subscribe((e) => {
      if (e.kind === "agent.message" && e.title === "Cash check") shown.push(e.detail!);
    });
    await runScript(plan, [{ tool: "review_payments" }]);
    stop();
    expect(shown[0]).toContain("Heads up:");
    expect(shown[0]).toContain("$12,200.00 leaves in the week of");
    expect(shown).toHaveLength(3);
  });
});

describe("the agent stops before paying", () => {
  it("asks for the most overdue payment first, waits for a person, and only their yes creates a PayPal order", async () => {
    const { plan } = wedding();
    const florist = listContracts(plan).find((c) => c.confirmed!.vendorRole === "florist")!;
    const run = startAgentRun(paymentAgent(plan, TODAY), { goal: GOAL }, { channel: "test" });
    const approval = await pendingFor(run.id);
    expect(approval.tool).toBe("create_vendor_order");
    expect(approval.amount?.value).toBe((FLORIST.depositCents / 100).toFixed(2));
    expect(approval.counterparties).toEqual([FLORIST.payeeEmail]);
    expect(run.status).toBe("running");
    expect(requireContract(florist.id).payments.deposit).toMatchObject({ state: "awaiting_approval", runId: run.id });
    expect(requireContract(florist.id).payments.deposit!.orderId).toBeUndefined();
    expect(getAuditLog().list().filter((e) => e.runId === run.id && e.action === "tool.executed")).toEqual([]);

    getApprovals().decide(approval.id, "approved", "couple");
    await settled(run);
    expect(requireContract(florist.id).payments.deposit).toMatchObject({ state: "awaiting_checkout", cents: FLORIST.depositCents });
    expect(requireContract(florist.id).payments.deposit!.orderId).toBeTruthy();
    expect(getAuditLog().list().filter((e) => e.runId === run.id).map((e) => e.action)).toEqual(expect.arrayContaining(["approval.requested", "approval.approved", "tool.executed"]));
  }, 20_000);

  it("moves nothing when the couple say no", async () => {
    const { plan } = wedding();
    const florist = listContracts(plan).find((c) => c.confirmed!.vendorRole === "florist")!;
    const run = startAgentRun(paymentAgent(plan, TODAY), { goal: GOAL }, { channel: "test" });
    getApprovals().decide((await pendingFor(run.id)).id, "denied", "couple");
    await settled(run);
    expect(requireContract(florist.id).payments.deposit).toMatchObject({ state: "failed" });
    expect(requireContract(florist.id).payments.deposit!.orderId).toBeUndefined();
    expect(run.summary).toContain("didn't go");
  }, 20_000);
});

describe("code limits on a payment", () => {
  it.each([
    ["far too much", "9000.00"],
    ["one cent too much", "1200.01"],
    ["less than the term", "100.00"],
    ["nothing", "0"],
  ])("refuses %s with no approval and no PayPal call", async (_name, amount) => {
    const { plan, photographer } = wedding();
    const { results, create, runId } = await runScript(plan, [ask(photographer.id, amount)]);
    expect(results.last.error).toMatchObject({ code: "REFUSED_BY_TOOL_CHECK" });
    expect(results.last.error!.reason).toContain("Nothing was sent");
    expect(create).not.toHaveBeenCalled();
    expect(getApprovals().list({ runId })).toEqual([]);
    expect(requireContract(photographer.id).payments.deposit).toBeUndefined();
    expect(getAuditLog().list().filter((e) => e.runId === runId).map((e) => e.action)).toEqual(["tool.requested", "tool.denied"]);
  });

  it("refuses the mock script that asks for too much from the goal", async () => {
    const { plan, photographer } = wedding();
    const run = startAgentRun(paymentAgent(plan, TODAY), { goal: "Pay the photographer $9,000.00 now." }, { channel: "test" });
    await settled(run);
    expect(run.summary).toContain("$9,000.00 is more than the confirmed deposit of $1,200.00");
    expect(requireContract(photographer.id).payments.deposit).toBeUndefined();
    expect(getApprovals().list({ runId: run.id })).toEqual([]);
  }, 20_000);

  it("refuses another couple's contract, an unconfirmed one and one that doesn't exist", async () => {
    const { plan } = wedding();
    const { photographer: theirs } = wedding();
    const unconfirmed = await addContract(plan, { text: "x".repeat(50) });
    for (const [id, reason] of [[theirs.id, /not found/], [unconfirmed.id, /Confirm this contract/], ["ctr_nothing", /not found/]] as const) {
      const { results, create } = await runScript(plan, [ask(id, "1200.00")]);
      expect(results.last.error!.reason).toMatch(reason);
      expect(create).not.toHaveBeenCalled();
    }
  });

  it("refuses a second payment for the same term", async () => {
    const { plan } = wedding();
    const florist = listContracts(plan).find((c) => c.confirmed!.vendorRole === "florist")!;
    const run = startAgentRun(paymentAgent(plan, TODAY), { goal: GOAL }, { channel: "test" });
    const approval = await pendingFor(run.id);
    const { results, create } = await runScript(plan, [ask(florist.id, (FLORIST.depositCents / 100).toFixed(2))]);
    expect(results.last.error!.reason).toMatch(/already has a payment/);
    expect(create).not.toHaveBeenCalled();
    getApprovals().decide(approval.id, "denied", "couple");
    await settled(run);
  }, 20_000);

  it("passes the exact term on to the approval step", async () => {
    const { plan, photographer } = wedding();
    const running = runScript(plan, [ask(photographer.id, "1200.00")]);
    let approval;
    for (let i = 0; i < 500 && !approval; i++) {
      approval = getApprovals().list({ state: "pending" }).find((a) => (a.input as { contract_id?: string }).contract_id === photographer.id);
      await new Promise((r) => setTimeout(r, 10));
    }
    expect(approval?.summary).toBe(`Pay ${PHOTOGRAPHER.vendorName} $1,200.00 for the deposit`);
    getApprovals().decide(approval!.id, "denied", "couple");
    await running;
  });
});
