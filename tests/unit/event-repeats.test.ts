import { describe, expect, it } from "vitest";
import { foldRepeats } from "@/lib/events/repeats";
import type { TimelineStep } from "@/lib/events/types";

let n = 0;
const step = (title: string, operation: string, quiet = true): TimelineStep => {
  n += 1;
  const ts = new Date(Date.UTC(2026, 10, 8, 0, 0, n)).toISOString();
  return { id: `e${n}`, stepId: `s${n}`, channel: "c", ts, startedAt: ts, updatedAt: ts, history: ["succeeded"], kind: "paypal", status: "succeeded", title, paypal: { operation, method: quiet ? "GET" : "POST", path: "/v2/x", mode: "sandbox" }, data: quiet ? { quiet: true } : undefined };
};
const isQuiet = (s: TimelineStep) => !!(s.data as { quiet?: boolean } | undefined)?.quiet;

describe("repeated reads fold into one row", () => {
  it("ten back-to-back capture reads are one row of ten, with the reason", () => {
    const order = step("Create order", "orders.create", false);
    const capture = step("Capture order", "orders.capture", false);
    const polls = Array.from({ length: 10 }, () => step("Get capture", "payments.getCapture"));
    const rows = foldRepeats([order, capture, ...polls], isQuiet);
    expect(rows.map((r) => [r.step.title, r.count])).toEqual([["Create order", 1], ["Capture order", 1], ["Get capture", 10]]);
    expect(rows[2].key).toBe(polls[0].stepId);
    expect(rows[2].step).toBe(polls[9]);
    expect(rows[2].reason).toBe("re-read while waiting for PayPal's webhook for the payment");
    expect(rows.reduce((sum, r) => sum + r.count, 0)).toBe(12);
  });

  it("alternating reads of the capture and the order fold into one row each, in first-seen order", () => {
    const reads = Array.from({ length: 5 }, () => [step("Get capture", "payments.getCapture"), step("Get order", "orders.get")]).flat();
    const rows = foldRepeats(reads, isQuiet);
    expect(rows.map((r) => [r.step.title, r.count])).toEqual([["Get capture", 5], ["Get order", 5]]);
    expect(rows.every((r) => r.reason === "re-read while waiting for PayPal's webhook for the payment")).toBe(true);
  });

  it("a card between two reads keeps them apart, so the story stays in order", () => {
    const rows = foldRepeats([step("Get capture", "payments.getCapture"), step("Capture order", "orders.capture", false), step("Get capture", "payments.getCapture")], isQuiet);
    expect(rows.map((r) => r.count)).toEqual([1, 1, 1]);
    expect(rows.every((r) => !r.reason)).toBe(true);
  });

  it("never folds the agent's own quiet steps, only PayPal reads", () => {
    const thought = (): TimelineStep => ({ ...step("Reasoning", "x"), kind: "agent.thinking", paypal: undefined });
    expect(foldRepeats([thought(), thought()], isQuiet).map((r) => r.count)).toEqual([1, 1]);
  });

  it("says why webhook checks repeat", () => {
    const rows = foldRepeats([step("Verify webhook", "webhooks.verify"), step("Verify webhook", "webhooks.verify")], isQuiet);
    expect(rows).toMatchObject([{ count: 2, reason: "one check for each webhook PayPal sent" }]);
  });

  it("never folds the calls that move money", () => {
    const rows = foldRepeats([step("Capture order", "orders.capture", false), step("Capture order", "orders.capture", false)], isQuiet);
    expect(rows.map((r) => r.count)).toEqual([1, 1]);
  });
});
