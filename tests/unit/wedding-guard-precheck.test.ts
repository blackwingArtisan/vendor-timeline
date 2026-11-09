/**
 * The Guard's refusal doesn't depend on a model asking for the payment. Code reads the request
 * first; when it names a vendor and an amount that isn't a confirmed term, that exact ask goes to
 * the Guard and is refused, in every AI mode. Here AI is "live" and the model is a stub that would
 * fail the test if it ran.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai/client", async (real) => ({ ...(await real<typeof import("@/lib/ai/client")>()), isAiLive: () => true }));
const model = vi.hoisted(() => ({ ran: 0 }));
vi.mock("@/lib/agent/loop", () => ({
  runClaudeAgent: async () => {
    model.ran++;
    return { summary: "model reply", turns: 1, costUsd: 0, stopReason: "end_turn" };
  },
}));

import { paymentAgent } from "@/agents/payments";
import { getApprovals } from "@/lib/agent/approvals";
import { getAuditLog } from "@/lib/agent/audit";
import { startAgentRun } from "@/lib/agent/runs";
import { timeline } from "@/lib/events/bus";
import { askedCents, askedMismatch } from "@/lib/wedding/asked-payment";
import { formatCents } from "@/lib/wedding/cents";
import { listContracts } from "@/lib/wedding/contracts";
import { monthlyBudget } from "@/lib/wedding/budget";
import { loadSampleWedding } from "@/lib/wedding/demo";
import { CATERER, FLORIST } from "@/lib/wedding/samples";
import { buildTimeline } from "@/lib/wedding/timeline";

const TODAY = "2026-11-20";
let n = 0;

function wedding() {
  const plan = `plan_precheck_${n++}`;
  loadSampleWedding(plan);
  return { plan, items: buildTimeline(listContracts(plan), TODAY, monthlyBudget(plan)).items };
}

async function settled(run: { status: string }) {
  for (let i = 0; i < 1500 && run.status === "running"; i++) await new Promise((r) => setTimeout(r, 10));
  expect(run.status).toBe("completed");
}

beforeEach(() => {
  model.ran = 0;
});

describe("reading the amount a request asks to pay", () => {
  it.each([
    ["Pay the caterer $5,000.", 500_000],
    ["pay the florist 600 dollars", 60_000],
    ["Send Saltmeadow Table Catering $2,500.00 now", 250_000],
  ])("reads %j as an ask for %i cents", (goal, cents) => {
    expect(askedCents(goal)).toBe(cents);
  });

  it.each([
    "Set up the next payment.",
    "What's due before $5,000 runs out?",
    "Pay the caterer, my budget is $5,000 a month.",
    "I have $3,000 left, pay the florist",
  ])("reads no ask in %j", (goal) => {
    expect(askedCents(goal)).toBeUndefined();
  });
});

describe("checking the ask against the confirmed terms", () => {
  it("flags an amount that is none of the named vendor's unpaid terms, against the payment due next", () => {
    const { items } = wedding();
    const mismatch = askedMismatch("Pay the caterer $5,000.", items);
    expect(mismatch).toMatchObject({ askedCents: 500_000, item: { vendorName: CATERER.vendorName, kind: "deposit", cents: CATERER.depositCents } });
  });

  it("lets a confirmed amount through to the agent, deposit or balance", () => {
    const { items } = wedding();
    expect(askedMismatch(`Pay the caterer ${formatCents(CATERER.depositCents)}.`, items)).toBeNull();
    expect(askedMismatch(`Pay the florist ${formatCents(FLORIST.depositCents)}`, items)).toBeNull();
    const balance = items.find((i) => i.vendorRole === "caterer" && i.kind === "balance")!;
    expect(askedMismatch(`Pay the caterer ${formatCents(balance.cents)}`, items)).toBeNull();
  });

  it("checks against the named term when the request says deposit or balance", () => {
    const { items } = wedding();
    const balance = items.find((i) => i.vendorRole === "caterer" && i.kind === "balance")!;
    expect(askedMismatch(`Pay the caterer balance ${formatCents(CATERER.depositCents)}`, items)).toMatchObject({ item: { kind: "balance", cents: balance.cents } });
  });

  it("leaves requests with no vendor or no amount to the agent", () => {
    const { items } = wedding();
    expect(askedMismatch("Pay $5,000.", items)).toBeNull();
    expect(askedMismatch("Pay the caterer.", items)).toBeNull();
  });
});

describe("with AI live, a mismatched ask never reaches the model", () => {
  it("sends the ask to the Guard in code, which refuses it: no model, no approval, no order", async () => {
    const { plan } = wedding();
    const run = startAgentRun(paymentAgent(plan, TODAY), { goal: "Pay the caterer $5,000." }, { channel: "precheck-test" });
    expect(run.mode).toBe("precheck");
    await settled(run);
    expect(model.ran).toBe(0);

    // A step's later events patch its first one, as the browser merges them.
    const events = timeline.history({ runId: run.id });
    const stepId = events.find((e) => e.kind === "tool" && e.tool?.name === "create_vendor_order")!.stepId;
    const last = Object.assign({}, ...events.filter((e) => e.stepId === stepId));
    expect(last.status).toBe("denied");
    expect(last.approval).toBeUndefined();
    expect(last.detail).toBe(`$5,000.00 is more than the confirmed deposit of ${formatCents(CATERER.depositCents)} for ${CATERER.vendorName}. Nothing was sent.`);
    expect((last.tool?.input as { amount: string }).amount).toBe("5000.00");
    expect(run.summary).toBe(`I haven't sent anything: the ${CATERER.vendorName} deposit is confirmed at ${formatCents(CATERER.depositCents)}, and only that exact amount can be paid.`);
    expect(getApprovals().list({ runId: run.id })).toEqual([]);
    expect(getAuditLog().list().filter((e) => e.runId === run.id).map((e) => e.action)).toEqual(expect.arrayContaining(["tool.requested", "tool.denied"]));
    expect(listContracts(plan).find((c) => c.confirmed!.vendorRole === "caterer")!.payments).toEqual({});
  }, 20_000);

  it("leaves any other request to the model", async () => {
    const { plan } = wedding();
    const run = startAgentRun(paymentAgent(plan, TODAY), { goal: `Pay the caterer ${formatCents(CATERER.depositCents)}.` }, { channel: "precheck-test" });
    expect(run.mode).toBe("claude");
    await settled(run);
    expect(model.ran).toBe(1);
  });
});
