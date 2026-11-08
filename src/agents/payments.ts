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
import { cashPlanSentence } from "@/lib/wedding/cash-moves";
import { CASH_CHECK_TITLE, CASH_PLAN_TITLE, PAY_FIRST_TITLE, payFirstSentence } from "@/lib/wedding/urgency";
import type { TimelineItem, TimelineView } from "@/lib/wedding/types";

export const PAYMENT_AGENT_ID = "payments";

const SYSTEM = `You help a couple keep up with their wedding vendor payments.

Call review_payments first, before you write anything. It returns every figure you may use, already worked out by the app's code. Never add, subtract or work out a figure yourself. Quote amounts and dates exactly as it gives them.

As soon as you call it, the app shows the couple its own sentence on what to pay first and why (pay_first_said), and each cash warning word for word. Don't repeat those, and never put a different payment first. When something clashes, the app also shows its own cash plan word for word (cash_plan_said): only moves the contracts allow, paying a payment early in PayPal's checkout or asking a vendor for a later date, and the couple approve each one themselves. Don't repeat it, and don't suggest any other move or work out any other date or amount. Then, in one or two short sentences of plain text, say what the warnings and the plan mean for them. Write plain sentences: no Markdown, no bold, no lists, no headings.

If they asked to pay something, or to set up the next payment, call create_vendor_order. Unless they named a different payment, pay pay_first from review_payments. If you pay anything other than pay_first, say why in one line first. Pass the contract_id and kind from review_payments. If they named an amount, pass that amount. Otherwise pass the amount from review_payments. Once a person approves, the couple pay it themselves in PayPal's own checkout. The app refuses anything that doesn't match the confirmed contract, and a person must approve what it accepts. You can't approve a payment, and there is no other way to pay. If a call is refused, tell them why in one sentence and stop.`;

function paymentFacts(item: TimelineItem) {
  return { contract_id: item.contractId, kind: item.kind, vendor: item.vendorName, amount: centsToDollars(item.cents), amount_text: formatCents(item.cents), due: formatDay(item.due), days_until: item.daysUntil, status: item.status };
}

function reviewFacts(view: TimelineView) {
  return {
    today: formatDay(view.today),
    monthly_budget: formatCents(view.cash.monthlyBudgetCents),
    pay_first: view.payFirst ? paymentFacts(view.payFirst) : null,
    pay_first_said: payFirstSentence(view),
    next_payment: view.nextDue ? paymentFacts(view.nextDue) : null,
    overdue: view.overdue.map(paymentFacts),
    warnings: view.cash.warnings.map((w) => w.message),
    cash_plan_said: view.cashFix ? cashPlanSentence(view.cashFix) : null,
    cash_plan_moves: (view.cashFix?.moves ?? []).map((m) => ({ move: m.kind, vendor: m.vendorName, kind: m.itemKind, amount_text: formatCents(m.cents), due: formatDay(m.due), to: formatDay(m.to) })),
    total_still_to_pay: formatCents(view.totalDueCents),
    unpaid_payments: view.items.filter((i) => i.status !== "paid").map(paymentFacts),
  };
}

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
  // review_payments itself shows what to pay first, so the script only explains a different choice.
  const steps: ScriptStep[] = [{ say: "Checking every confirmed payment first.", tool: "review_payments", as: "review" }];
  if (!target) return steps;
  const asked = dollarFigures(input.goal)[0];
  const plan = view.cashFix?.moves.length ? "The cash plan below lists the moves your contracts allow, for you to approve one by one. " : "";
  const why = named && view.payFirst && named.id !== view.payFirst.id ? `You asked for the ${target.vendorName} ${target.kind}, so that one, not the ${view.payFirst.vendorName} ${view.payFirst.kind}. ` : "";
  steps.push({
    say: `${plan}${why}I'll set up the ${target.vendorName} ${target.kind} and stop there. Nothing moves until you approve it.`,
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
    description: "Read this couple's confirmed payments: what to pay first, the next one due, anything overdue, the unpaid list, the cash warnings and the cash plan. All figures and dates are worked out by the app.",
    risk: "read",
    source: "app",
    schema: z.object({}),
    title: () => "Review every payment",
    execute: async () => {
      const view = await viewTimeline(planId, today);
      // Code says what comes first, so the model's own words can't reorder it.
      timeline.emit({ kind: "agent.message", status: "info", title: PAY_FIRST_TITLE, detail: payFirstSentence(view) });
      // Written by code, so the warnings reach the couple whatever the model chooses to say.
      for (const warning of view.cash.warnings) timeline.emit({ kind: "agent.message", status: "info", title: CASH_CHECK_TITLE, detail: `Heads up: ${warning.message}` });
      // The plan's moves, dates and sums are code's too. The couple approve each move on its own card.
      if (view.cashFix) timeline.emit({ kind: "agent.message", status: "info", title: CASH_PLAN_TITLE, detail: `Cash plan: ${cashPlanSentence(view.cashFix)}` });
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
