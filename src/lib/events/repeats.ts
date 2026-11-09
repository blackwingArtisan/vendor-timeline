/**
 * Folds repeats of a quiet PayPal read into one row with a count. While a payment waits for PayPal's
 * webhook the app keeps re-reading the capture (and the order), and a dozen alternating "Get
 * capture" and "Get order" lines would bury the calls that matter. Within each unbroken stretch of
 * quiet reads, each distinct call gets one row, in the order it first came, counting its repeats.
 * A call that moves money, or any other step, ends the stretch, so the story stays in order.
 * Safe to import in the browser.
 */
import type { TimelineStep } from "./types";

export interface StepRow {
  /** The first call's step id, so the row keeps its place as the count grows. */
  key: string;
  /** The latest of the calls. */
  step: TimelineStep;
  /** How many identical calls, back to back, this row stands for. */
  count: number;
  /** Why the call repeated, when the app knows. */
  reason?: string;
}

/** Repeated reads the app makes on purpose, and why. */
const WHY: Record<string, string> = {
  "payments.getCapture": "re-read while waiting for PayPal's webhook for the payment",
  "orders.get": "re-read while waiting for PayPal's webhook for the payment",
  "webhooks.verify": "one check for each webhook PayPal sent",
};

const callKey = (s: TimelineStep) => `${s.kind}|${s.status}|${s.title}|${s.paypal?.operation ?? ""}|${s.paypal?.path ?? ""}`;

export function foldRepeats(steps: TimelineStep[], quiet: (s: TimelineStep) => boolean): StepRow[] {
  const rows: StepRow[] = [];
  // The quiet PayPal reads of the current stretch, by call.
  let stretch = new Map<string, StepRow>();
  for (const step of steps) {
    if (!quiet(step) || !step.paypal) {
      stretch = new Map();
      rows.push({ key: step.stepId, step, count: 1 });
      continue;
    }
    const same = stretch.get(callKey(step));
    if (same) {
      same.count += 1;
      same.step = step;
      same.reason = (step.paypal && WHY[step.paypal.operation]) || undefined;
    } else {
      const row: StepRow = { key: step.stepId, step, count: 1 };
      stretch.set(callKey(step), row);
      rows.push(row);
    }
  }
  return rows;
}
