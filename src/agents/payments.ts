/**
 * APP-OWNED: the payment agent. It names what is due, explains the clashes the code found, and
 * asks to pay. It stops there: the only money tool waits for a person in the Guard. Code does every
 * sum, and code decides what may be paid, so nothing in a prompt or a reply can change a limit.
 */
import { z } from "zod";
import { appConfig } from "@/app.config";
import { defineAgent, type AgentInput, type ScriptStep } from "@/lib/agent/define";
import { defineTool } from "@/lib/agent/tool";
import { monthlyBudget } from "@/lib/wedding/budget";
import { centsToDollars, dollarFigures, formatCents } from "@/lib/wedding/cents";
import { listContracts } from "@/lib/wedding/contracts";
import { formatDay } from "@/lib/wedding/dates";
import { vendorPayoutTool, viewTimeline } from "@/lib/wedding/pay";
import { buildTimeline } from "@/lib/wedding/timeline";
import type { TimelineItem, TimelineView } from "@/lib/wedding/types";

export const PAYMENT_AGENT_ID = "payments";

const SYSTEM = `You help a couple keep up with their wedding vendor payments.

Call review_payments first. It returns every figure you may use, already worked out by the app's code. Never add, subtract or work out a figure yourself. Quote amounts and dates exactly as it gives them.

Then tell the couple, in plain words:
- the next payment due: vendor, what it is, amount and date
- anything overdue
- each warning in the warnings list, and what it means for them. Don't suggest moving a payment date unless they ask, because the vendor would have to agree.

If they asked to pay something, or to set up the next payment, call create_vendor_payout with the contract_id and kind from review_payments. If they named an amount, pass that amount. Otherwise pass the amount from review_payments. The app refuses anything that doesn't match the confirmed contract, and a person must approve what it accepts. You can't approve a payment, and there is no other way to pay. If a call is refused, tell them why in one sentence and stop.`;

function paymentFacts(item: TimelineItem) {
  return { contract_id: item.contractId, kind: item.kind, vendor: item.vendorName, amount: centsToDollars(item.cents), amount_text: formatCents(item.cents), due: formatDay(item.due), days_until: item.daysUntil, status: item.status };
}

function reviewFacts(view: TimelineView) {
  return {
    today: formatDay(view.today),
    monthly_budget: formatCents(view.cash.monthlyBudgetCents),
    next_payment: view.nextDue ? paymentFacts(view.nextDue) : null,
    overdue: view.overdue.map(paymentFacts),
    warnings: view.cash.warnings.map((w) => w.message),
    total_still_to_pay: formatCents(view.totalDueCents),
    unpaid_payments: view.items.filter((i) => i.status !== "paid").map(paymentFacts),
  };
}

const say = (next: TimelineItem | null) => (next ? `Next up is ${next.vendorName}: the ${next.kind} of ${formatCents(next.cents)}, due ${formatDay(next.due)}.` : "Nothing else is due right now.");

/** AI mock mode. A dollar figure in the goal is asked for as is, so a run can ask for too much. */
function mockSteps(planId: string, today: string, input: AgentInput): ScriptStep[] {
  const view = buildTimeline(listContracts(planId), today, monthlyBudget(planId));
  const next = view.nextDue;
  const overdue = view.overdue.map((i) => `${i.vendorName} ${i.kind} (${formatCents(i.cents)})`).join(" and ");
  const steps: ScriptStep[] = [
    { say: "Checking every confirmed payment first.", tool: "review_payments", as: "review" },
    { say: say(next), pauseMs: 300 },
    ...(overdue ? [{ say: `Overdue: ${overdue}.`, pauseMs: 300 }] : []),
    ...view.cash.warnings.map((w) => ({ say: `Heads up: ${w.message}`, pauseMs: 300 })),
  ];
  if (!next) return steps;
  const asked = dollarFigures(input.goal)[0];
  steps.push({
    say: "I'll set this payment up and stop there. Nothing moves until you approve it.",
    tool: "create_vendor_payout",
    input: { contract_id: next.contractId, kind: next.kind, amount: centsToDollars(asked ?? next.cents) },
    as: "payout",
  });
  steps.push({ say: (r) => (r.payout?.error ? `That payment didn't go: ${r.payout.error.reason}` : "You approved it and PayPal has it. It shows as paid once PayPal confirms.") });
  return steps;
}

export function paymentAgent(planId: string, today: string) {
  const reviewPayments = defineTool({
    name: "review_payments",
    description: "Read this couple's confirmed payments: the next one due, anything overdue, the unpaid list and the cash warnings. All figures are worked out by the app.",
    risk: "read",
    source: "app",
    schema: z.object({}),
    title: () => "Review every payment",
    execute: async () => reviewFacts(await viewTimeline(planId, today)),
  });
  return defineAgent({
    id: PAYMENT_AGENT_ID,
    name: "Payment agent",
    description: "Names the next payment, warns about cash clashes, and stops for a person's approval.",
    system: SYSTEM,
    tools: () => [reviewPayments, vendorPayoutTool(planId)],
    policy: appConfig.agentPolicy,
    effort: "low",
    maxTurns: 5,
    mockScript: (input) => mockSteps(planId, today, input),
  });
}
