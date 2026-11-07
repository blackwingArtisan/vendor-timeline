/**
 * The one timeline, built only from confirmed contracts. "Paid" comes from the payment's PayPal
 * status, and every sum is worked out here in cents. Safe to import in the browser.
 */
import { cashPlan, DEFAULT_MONTHLY_BUDGET_CENTS } from "./cash";
import { sumCents } from "./cents";
import { daysBetween } from "./dates";
import type { Contract, ItemKind, ItemStatus, Payment, TimelineItem, TimelineView, VendorRole } from "./types";

export const itemId = (contractId: string, kind: ItemKind) => `${contractId}.${kind}`;

/** What PayPal's capture status means for the couple. Only COMPLETED is money that arrived. */
export function captureState(status: string | undefined): Payment["state"] {
  if (status === "COMPLETED") return "paid";
  if (status && ["DECLINED", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"].includes(status)) return "failed";
  return "sending";
}

function itemStatus(payment: Payment | undefined, daysUntil: number): ItemStatus {
  if (payment && payment.state !== "failed") return payment.state;
  if (daysUntil < 0) return "overdue";
  return daysUntil === 0 ? "due_today" : "upcoming";
}

function itemsOf(contract: Contract, today: string): TimelineItem[] {
  const terms = contract.confirmed;
  if (!terms) return [];
  const entry = (kind: ItemKind, cents: number, due: string): TimelineItem => {
    const payment = contract.payments[kind];
    const daysUntil = daysBetween(today, due);
    return { id: itemId(contract.id, kind), contractId: contract.id, kind, vendorName: terms.vendorName, vendorRole: terms.vendorRole, cents, due, daysUntil, status: itemStatus(payment, daysUntil), payment, movedFrom: contract.movedFrom?.[kind] };
  };
  const items = [entry("deposit", terms.depositCents, terms.depositDue)];
  if (terms.balanceCents > 0 && terms.balanceDue) items.push(entry("balance", terms.balanceCents, terms.balanceDue));
  return items;
}

export function buildTimeline(contracts: Contract[], today: string, monthlyBudgetCents = DEFAULT_MONTHLY_BUDGET_CENTS): TimelineView {
  const items = contracts.flatMap((c) => itemsOf(c, today)).sort((a, b) => a.due.localeCompare(b.due) || a.vendorName.localeCompare(b.vendorName));
  const unpaid = items.filter((i) => i.status !== "paid");
  return {
    today,
    items,
    // Past due until PayPal says paid, even while it waits on an approval or the checkout.
    overdue: unpaid.filter((i) => i.daysUntil < 0),
    nextDue: unpaid.find((i) => i.daysUntil >= 0 && i.status !== "sending") ?? null,
    payFirst: unpaid.find((i) => i.status === "overdue") ?? unpaid.find((i) => i.status === "due_today" || i.status === "upcoming") ?? null,
    totalDueCents: sumCents(unpaid.map((i) => i.cents)),
    paidCents: sumCents(items.filter((i) => i.status === "paid").map((i) => i.cents)),
    contractedCents: sumCents(contracts.map((c) => c.confirmed?.totalCents ?? 0)),
    cash: cashPlan(items, today, monthlyBudgetCents),
    sandboxStandIn: false,
  };
}

export const payLabel = (role: VendorRole) => `Pay ${role === "other" ? "vendor" : role}`;
