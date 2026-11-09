import { describe, expect, it } from "vitest";
import { foldLine, icsText, timelineIcs } from "@/lib/wedding/ics";
import { buildTimeline } from "@/lib/wedding/timeline";
import { formatCents } from "@/lib/wedding/cents";
import type { ConfirmedTerms, Contract, ProposedTerms } from "@/lib/wedding/types";
import { parseIcs } from "../support/parse-ics";

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

const contract = (id: string, confirmed: ConfirmedTerms, payments: Contract["payments"] = {}): Contract => ({
  id,
  planId: "p",
  createdAt: "2026-11-01T00:00:00Z",
  text: "",
  proposed: {} as ProposedTerms,
  read: { mocked: true, costUsd: 0 },
  confirmed,
  payments,
});

const NOW = new Date("2026-11-20T15:04:05.678Z");

describe("timelineIcs", () => {
  const contracts = [
    contract("a", terms({ vendorName: "Bramble & Vetch Floral, Ltd; Co", vendorRole: "florist" })),
    contract("b", terms({ vendorName: "Saltmeadow Table Catering", vendorRole: "caterer", depositCents: 300_000, depositDue: "2026-11-10", balanceCents: 1_046_000, balanceDue: "2027-05-29" }), {
      deposit: { runId: "r", cents: 300_000, attempt: 1, state: "paid", payee: "a@example.com" },
    }),
  ];
  const { items } = buildTimeline(contracts, "2026-11-20");
  const { calendar, events } = parseIcs(timelineIcs(items, { planId: "plan-secret-id", now: NOW, origin: "https://example.test" }));

  it("has one all-day event per unpaid deposit or balance, with the vendor and the amount", () => {
    expect(calendar.VERSION).toBe("2.0");
    expect(events).toHaveLength(3); // The caterer's deposit is paid, so it's left out.
    const byDay = Object.fromEntries(events.map((e) => [e["DTSTART;VALUE=DATE"], e]));
    expect(Object.keys(byDay).sort()).toEqual(["20261201", "20270301", "20270529"]);
    expect(byDay["20261201"].SUMMARY).toBe(`Pay Bramble & Vetch Floral, Ltd; Co deposit, ${formatCents(25_000)}`);
    expect(byDay["20261201"]["DTEND;VALUE=DATE"]).toBe("20261202");
    expect(byDay["20270301"].SUMMARY).toBe(`Pay Bramble & Vetch Floral, Ltd; Co balance, ${formatCents(75_000)}`);
    expect(byDay["20270529"].SUMMARY).toBe(`Pay Saltmeadow Table Catering balance, ${formatCents(1_046_000)}`);
    expect(byDay["20270529"].DESCRIPTION).toContain("$10,460.00 balance for Saltmeadow Table Catering, due 2027-05-29.");
    expect(byDay["20270529"].DESCRIPTION).toContain("https://example.test/timeline");
    for (const e of events) expect(e.DTSTAMP).toBe("20261120T150405Z");
  });

  it("gives each event a stable id that doesn't carry the plan's own id", () => {
    const uids = events.map((e) => e.UID);
    expect(new Set(uids).size).toBe(3);
    for (const uid of uids) expect(uid).not.toContain("plan-secret-id");
    const again = parseIcs(timelineIcs(items, { planId: "plan-secret-id", now: new Date() })).events.map((e) => e.UID);
    expect(again).toEqual(uids);
  });

  it("escapes text and folds long lines at 75 octets without splitting a character", () => {
    expect(icsText("a,b;c\\d\ne")).toBe("a\\,b\;c\\\\d\\ne");
    const long = `SUMMARY:${"é".repeat(60)}`;
    const folded = foldLine(long);
    for (const part of folded.split("\r\n")) expect(Buffer.byteLength(part)).toBeLessThanOrEqual(75);
    expect(folded.split("\r\n").map((p, i) => (i ? p.slice(1) : p)).join("")).toBe(long);
  });

  it("is an empty calendar when everything is paid", () => {
    const paid = buildTimeline([contract("c", terms(), { deposit: { runId: "r", cents: 25_000, attempt: 1, state: "paid", payee: "a@example.com" }, balance: { runId: "r", cents: 75_000, attempt: 1, state: "paid", payee: "a@example.com" } })], "2026-11-20");
    expect(parseIcs(timelineIcs(paid.items, { planId: "p" })).events).toEqual([]);
  });
});
