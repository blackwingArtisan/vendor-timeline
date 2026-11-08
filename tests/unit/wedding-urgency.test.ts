import { describe, expect, it } from "vitest";
import { buildTimeline } from "@/lib/wedding/timeline";
import { payFirstSentence } from "@/lib/wedding/urgency";
import type { ConfirmedTerms, Contract, Payment, ProposedTerms } from "@/lib/wedding/types";

const TODAY = "2026-11-20";
const terms = (vendorName: string, over: Partial<ConfirmedTerms> = {}): ConfirmedTerms => ({
  vendorName,
  vendorRole: "other",
  payeeEmail: "a@example.com",
  totalCents: 100_000,
  depositCents: 25_000,
  depositDue: "2026-12-01",
  balanceCents: 75_000,
  balanceDue: "2027-03-01",
  ...over,
});
const contract = (id: string, confirmed: ConfirmedTerms, payments: Contract["payments"] = {}): Contract => ({ id, planId: "p", createdAt: "2026-11-01T00:00:00Z", text: "", proposed: {} as ProposedTerms, read: { mocked: true, costUsd: 0 }, confirmed, payments });
const payment = (state: Payment["state"], cents: number): Payment => ({ runId: "r", cents, attempt: 1, state, payee: "a@example.com" });

describe("payFirstSentence", () => {
  it("always names an overdue payment first, whatever the order of the contracts", () => {
    const soon = contract("a", terms("Soon Studio", { depositDue: "2026-11-25" }));
    const late = contract("b", terms("Late Florals", { depositDue: "2026-10-23", depositCents: 60_000 }));
    for (const contracts of [[soon, late], [late, soon]]) {
      const said = payFirstSentence(buildTimeline(contracts, TODAY));
      expect(said.startsWith("Pay first: the Late Florals deposit, $600.00, 28 days overdue since Fri, Oct 23, 2026. Overdue comes first.")).toBe(true);
      expect(said.indexOf("Late Florals")).toBeLessThan(said.indexOf("Soon Studio"));
      expect(said).toContain("After that, next due is the Soon Studio deposit, $250.00, due Wed, Nov 25, 2026.");
    }
  });

  it("puts the most overdue first and lists the others", () => {
    const view = buildTimeline([contract("a", terms("Less Late", { depositDue: "2026-11-10" })), contract("b", terms("Most Late", { depositDue: "2026-10-01" }))], TODAY);
    const said = payFirstSentence(view);
    expect(said).toMatch(/^Pay first: the Most Late deposit/);
    expect(said).toContain("Also overdue: the Less Late deposit ($250.00, 10 days overdue since Tue, Nov 10, 2026).");
  });

  it("says why an overdue payment already on its way isn't first, before naming the next", () => {
    const late = contract("b", terms("Late Florals", { depositDue: "2026-10-23", depositCents: 60_000 }), { deposit: payment("awaiting_approval", 60_000) });
    const soon = contract("a", terms("Soon Studio", { depositDue: TODAY }));
    const said = payFirstSentence(buildTimeline([soon, late], TODAY));
    expect(said).toBe("The Late Florals deposit ($600.00, 28 days overdue since Fri, Oct 23, 2026) is waiting for your approval. Pay first: the Soon Studio deposit, $250.00, due today. Nothing else is overdue, so the next one due comes first.");
  });

  it("says when nothing needs paying", () => {
    const paid = contract("a", terms("Done", { balanceCents: 0, balanceDue: null, totalCents: 25_000 }), { deposit: payment("paid", 25_000) });
    expect(payFirstSentence(buildTimeline([paid], TODAY))).toBe("Nothing is waiting to be paid.");
  });
});
