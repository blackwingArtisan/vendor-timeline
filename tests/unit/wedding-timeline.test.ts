import { describe, expect, it } from "vitest";
import { buildTimeline, captureState } from "@/lib/wedding/timeline";
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

const payment = (state: "paid" | "sending" | "awaiting_checkout" | "awaiting_approval" | "failed", cents: number) => ({ runId: "r", cents, attempt: 1, state, payee: "a@example.com" });

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

  it("keeps a past-due payment overdue while it waits on approval or the checkout", () => {
    const view = buildTimeline([contract("a", terms({ depositDue: "2026-10-01" }), { deposit: payment("awaiting_checkout", 25_000) })], "2026-11-20");
    expect(view.items[0].status).toBe("awaiting_checkout");
    expect(view.overdue.map((i) => i.kind)).toEqual(["deposit"]);
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

describe("captureState", () => {
  it.each([
    ["COMPLETED", "paid"],
    ["PENDING", "sending"],
    [undefined, "sending"],
    ["DECLINED", "failed"],
    ["FAILED", "failed"],
    ["REFUNDED", "failed"],
  ])("capture %s is %s", (status, expected) => {
    expect(captureState(status)).toBe(expected);
  });
});

describe("what to pay first", () => {
  it("is the most overdue payment, then the next one due", () => {
    const overdue = buildTimeline([contract("a", terms({ depositDue: "2026-11-10" })), contract("b", terms({ depositDue: "2026-10-01" })), contract("c", terms({ depositDue: "2026-11-25" }))], "2026-11-20");
    expect(overdue.payFirst?.contractId).toBe("b");
    expect(overdue.nextDue?.contractId).toBe("c");
    const none = buildTimeline([contract("c", terms({ depositDue: "2026-11-25" }))], "2026-11-20");
    expect(none.payFirst?.id).toBe(none.nextDue?.id);
  });

  it("skips a payment already waiting on the couple's PayPal checkout", () => {
    const view = buildTimeline([contract("b", terms({ depositDue: "2026-10-01" }), { deposit: payment("awaiting_checkout", 25_000) })], "2026-11-20");
    expect(view.items[0].status).toBe("awaiting_checkout");
    expect(view.payFirst?.kind).toBe("balance");
  });
});
