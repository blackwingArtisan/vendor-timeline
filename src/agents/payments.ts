/**
 * APP-OWNED: the payment agent. It names what is due, explains the clashes the code found, and
 * asks to pay. It stops there: the only money tool waits for a person in the Guard. Code does every
 * sum, shows every warning and decides what may be paid, so nothing in a prompt or a reply can
 * change a limit or hide a clash.
 */
import { z } from "zod";
import { appConfig } from "@/app.config";
import { defineAgent, type AgentInput, type ScriptStep } from "@/lib/agent/define";
import { defineTool } from "@/lib/agent/tool";
import { timeline } from "@/lib/events/bus";
import { monthlyBudget } from "@/lib/wedding/budget";
import { centsToDollars, dollarFigures, formatCents } from "@/lib/wedding/cents";
import { listContracts } from "@/lib/wedding/contracts";
import { formatDay } from "@/lib/wedding/dates";
import { VENDOR_ORDER_TOOL, vendorOrderTool, viewTimeline } from "@/lib/wedding/pay";
import { buildTimeline } from "@/lib/wedding/timeline";
import type { TimelineItem, TimelineView } from "@/lib/wedding/types";

export const PAYMENT_AGENT_ID = "payments";

const SYSTEM = `You help a couple keep up with their wedding vendor payments.

Call review_payments first. It returns every figure you may use, already worked out by the app's code. Never add, subtract or work out a figure yourself. Quote amounts and dates exactly as it gives them.

Then tell the couple, in plain words:
- anything overdue, most overdue first
- the next payment due: vendor, what it is, amount and date
- what the warnings mean for them, in one short sentence. The app has already shown them each warning word for word, so don't repeat the list. Don't suggest moving a payment date unless they ask, because the vendor would have to agree.

Write all of that before you call any other tool.

If they asked to pay something, or to set up the next payment, call create_vendor_order. Urgent comes first: unless they named a different payment, pay pay_first from review_payments, which is the most overdue payment, or the next one due when nothing is overdue. If you pay anything other than pay_first, say why in one line first. Pass the contract_id and kind from review_payments. If they named an amount, pass that amount. Otherwise pass the amount from review_payments. Once a person approves, the couple pay it themselves in PayPal's own checkout. The app refuses anything that doesn't match the confirmed contract, and a person must approve what it accepts. You can't approve a payment, and there is no other way to pay. If a call is refused, tell them why in one sentence and stop.`;

function paymentFacts(item: TimelineItem) {
  return { contract_id: item.contractId, kind: item.kind, vendor: item.vendorName, amount: centsToDollars(item.cents), amount_text: formatCents(item.cents), due: formatDay(item.due), days_until: item.daysUntil, status: item.status };
}

function reviewFacts(view: TimelineView) {
  return {
    today: formatDay(view.today),
    monthly_budget: formatCents(view.cash.monthlyBudgetCents),
    pay_first: view.payFirst ? paymentFacts(view.payFirst) : null,
    next_payment: view.nextDue ? paymentFacts(view.nextDue) : null,
    overdue: view.overdue.map(paymentFacts),
    warnings: view.cash.warnings.map((w) => w.message),
    total_still_to_pay: formatCents(view.totalDueCents),
    unpaid_payments: view.items.filter((i) => i.status !== "paid").map(paymentFacts),
  };
}

const say = (next: TimelineItem | null) => (next ? `Next up is ${next.vendorName}: the ${next.kind} of ${formatCents(next.cents)}, due ${formatDay(next.due)}.` : "Nothing else is due right now.");

/** The payment a goal names by vendor, role or "deposit"/"balance", if it names exactly one. */
function namedIn(goal: string, items: TimelineItem[]): TimelineItem | undefined {
  const text = goal.toLowerCase();
  const byVendor = items.filter((i) => text.includes(i.vendorRole) || text.includes(i.vendorName.toLowerCase()));
  const byKind = byVendor.filter((i) => text.includes(i.kind));
  return byKind.length === 1 ? byKind[0] : byVendor.length >= 1 ? byVendor.find((i) => i.status !== "paid") : undefined;
}

/** AI mock mode. Urgent first, unless the goal names a payment. A dollar figure in the goal is asked for as is, so a run can ask for too much. */
function mockSteps(planId: string, today: string, input: AgentInput): ScriptStep[] {
  const view = buildTimeline(listContracts(planId), today, monthlyBudget(planId));
  const named = namedIn(input.goal, view.items.filter((i) => i.status !== "paid"));
  const target = named ?? view.payFirst;
  const overdue = view.overdue.map((i) => `${i.vendorName} ${i.kind} (${formatCents(i.cents)}, due ${formatDay(i.due)})`).join(" and ");
  const steps: ScriptStep[] = [
    { say: "Checking every confirmed payment first.", tool: "review_payments", as: "review" },
    ...(overdue ? [{ say: `Overdue: ${overdue}.`, pauseMs: 300 }] : []),
    { say: say(view.nextDue), pauseMs: 300 },
  ];
  if (!target) return steps;
  const asked = dollarFigures(input.goal)[0];
  const why = target.status === "overdue" ? `The ${target.vendorName} ${target.kind} is overdue, so it goes first.` : named && view.payFirst && named.id !== view.payFirst.id ? `You asked for the ${target.vendorName} ${target.kind}, so that one, not the ${view.payFirst.vendorName} ${view.payFirst.kind}.` : "Nothing is overdue, so the next one due goes first.";
  steps.push({
    say: `${why} I'll set it up and stop there. Nothing moves until you approve it.`,
    tool: VENDOR_ORDER_TOOL,
    input: { contract_id: target.contractId, kind: target.kind, amount: centsToDollars(asked ?? target.cents) },
    as: "order",
  });
  steps.push({ say: (r) => (r.order?.error ? `That payment didn't go: ${r.order.error.reason}` : "You approved it. Pay it in PayPal's checkout from the timeline, and it shows as paid once PayPal confirms the capture.") });
  return steps;
}

export function paymentAgent(planId: string, today: string) {
  const reviewPayments = defineTool({
    name: "review_payments",
    description: "Read this couple's confirmed payments: what to pay first, the next one due, anything overdue, the unpaid list and the cash warnings. All figures are worked out by the app.",
    risk: "read",
    source: "app",
    schema: z.object({}),
    title: () => "Review every payment",
    execute: async () => {
      const view = await viewTimeline(planId, today);
      // Written by code, so the warnings reach the couple whatever the model chooses to say.
      for (const warning of view.cash.warnings) timeline.emit({ kind: "agent.message", status: "info", title: "Cash check", detail: `Heads up: ${warning.message}` });
      return reviewFacts(view);
    },
  });
  return defineAgent({
    id: PAYMENT_AGENT_ID,
    name: "Payment agent",
    description: "Names the most urgent payment, warns about cash clashes, and stops for a person's approval.",
    system: SYSTEM,
    tools: () => [reviewPayments, vendorOrderTool(planId)],
    policy: appConfig.agentPolicy,
    effort: "low",
    maxTurns: 5,
    mockScript: (input) => mockSteps(planId, today, input),
  });
}
