import { describe, expect, it } from "vitest";
import { buildTimeline, paymentState } from "@/lib/wedding/timeline";
import type { ConfirmedTerms, Contract, ProposedTerms } from "@/lib/wedding/types";

const terms = (over: Partial<ConfirmedTerms> = {}): ConfirmedTerms => ({
  vendorName: "Vendor",
  vendorRole: "florist",
  payeeEmail: "a@example.com",
  totalCents: 100_000,
  depositCents: 25_000,
  depositDue: "2026-12-01",
  balanceCents: 75_000,
  balanceDue: "2027-03-01",
  ...over,
});

const contract = (id: string, confirmed?: ConfirmedTerms, payments: Contract["payments"] = {}): Contract => ({
  id,
  planId: "p",
  createdAt: "2026-11-01T00:00:00Z",
  text: "",
  proposed: {} as ProposedTerms,
  read: { mocked: true, costUsd: 0 },
  confirmed,
  payments,
});

const payment = (state: "paid" | "sending" | "awaiting_approval" | "failed", cents: number) => ({ runId: "r", cents, attempt: 1, state, receiver: "a@example.com" });

describe("buildTimeline", () => {
  it("leaves out anything unconfirmed", () => {
    const view = buildTimeline([contract("a")], "2026-11-20");
    expect(view.items).toEqual([]);
    expect(view.totalDueCents).toBe(0);
    expect(view.contractedCents).toBe(0);
  });

  it("orders every deposit and balance by date", () => {
    const view = buildTimeline([contract("a", terms({ depositDue: "2027-01-05" })), contract("b", terms({ depositDue: "2026-12-01", balanceDue: "2027-02-01" }))], "2026-11-20");
    expect(view.items.map((i) => `${i.contractId}.${i.kind}`)).toEqual(["b.deposit", "a.deposit", "b.balance", "a.balance"]);
  });

  it("works out what is due and paid from the items", () => {
    const view = buildTimeline([contract("a", terms(), { deposit: payment("paid", 25_000) }), contract("b", terms())], "2026-11-20");
    expect(view.paidCents).toBe(25_000);
    expect(view.totalDueCents).toBe(175_000);
    expect(view.contractedCents).toBe(200_000);
  });

  it("labels a past date overdue, and today as due today", () => {
    const view = buildTimeline([contract("a", terms({ depositDue: "2026-11-19", balanceDue: "2026-11-20" }))], "2026-11-20");
    expect(view.items.map((i) => [i.status, i.daysUntil])).toEqual([["overdue", -1], ["due_today", 0]]);
    expect(view.overdue).toHaveLength(1);
    expect(view.nextDue?.kind).toBe("balance");
  });

  it("never calls a paid item overdue", () => {
    const view = buildTimeline([contract("a", terms({ depositDue: "2026-10-01" }), { deposit: payment("paid", 25_000) })], "2026-11-20");
    expect(view.items[0].status).toBe("paid");
    expect(view.overdue).toEqual([]);
  });

  it("counts money as due until PayPal says it was paid", () => {
    const view = buildTimeline([contract("a", terms(), { deposit: payment("sending", 25_000) })], "2026-11-20");
    expect(view.items[0].status).toBe("sending");
    expect(view.totalDueCents).toBe(100_000);
    expect(view.paidCents).toBe(0);
    expect(view.nextDue?.kind).toBe("balance");
  });

  it("puts a failed payment back to due", () => {
    const view = buildTimeline([contract("a", terms({ depositDue: "2026-10-01" }), { deposit: payment("failed", 25_000) })], "2026-11-20");
    expect(view.items[0].status).toBe("overdue");
  });

  it("has no balance item when the deposit is everything", () => {
    const view = buildTimeline([contract("a", terms({ depositCents: 100_000, balanceCents: 0, balanceDue: null }))], "2026-11-20");
    expect(view.items.map((i) => i.kind)).toEqual(["deposit"]);
  });
});

describe("paymentState", () => {
  it.each([
    ["SUCCESS", "PROCESSING", "paid"],
    ["SUCCESS", "SUCCESS", "paid"],
    ["PENDING", "PENDING", "sending"],
    [undefined, "PENDING", "sending"],
    ["UNCLAIMED", "SUCCESS", "sending"],
    ["ONHOLD", "SUCCESS", "sending"],
    ["FAILED", "SUCCESS", "failed"],
    ["RETURNED", "SUCCESS", "failed"],
    [undefined, "DENIED", "failed"],
  ])("item %s in batch %s is %s", (item, batch, expected) => {
    expect(paymentState(item, batch)).toBe(expected);
  });
});
