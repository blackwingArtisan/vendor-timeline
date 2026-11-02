/**
 * The one timeline, built only from confirmed contracts. "Paid" comes from the payment's PayPal
 * status, and every sum is worked out here in cents. Safe to import in the browser.
 */
import { cashPlan, DEFAULT_MONTHLY_BUDGET_CENTS } from "./cash";
import { sumCents } from "./cents";
import { daysBetween } from "./dates";
import type { Contract, ItemKind, ItemStatus, Payment, TimelineItem, TimelineView, VendorRole } from "./types";

export const itemId = (contractId: string, kind: ItemKind) => `${contractId}.${kind}`;

/** What a payout's status means for the couple. A batch that says SUCCESS doesn't mean this item was paid. */
export function paymentState(itemStatus: string | undefined, batchStatus: string): Payment["state"] {
  if (itemStatus === "SUCCESS") return "paid";
  if (itemStatus && ["FAILED", "RETURNED", "BLOCKED", "REFUNDED", "REVERSED"].includes(itemStatus)) return "failed";
  if (batchStatus === "DENIED" || batchStatus === "CANCELED") return "failed";
  return "sending";
}

function itemStatus(payment: Payment | undefined, daysUntil: number): ItemStatus {
  if (payment?.state === "paid" || payment?.state === "sending" || payment?.state === "awaiting_approval") return payment.state;
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
    overdue: items.filter((i) => i.status === "overdue"),
    nextDue: unpaid.find((i) => i.daysUntil >= 0 && i.status !== "sending") ?? null,
    totalDueCents: sumCents(unpaid.map((i) => i.cents)),
    paidCents: sumCents(items.filter((i) => i.status === "paid").map((i) => i.cents)),
    contractedCents: sumCents(contracts.map((c) => c.confirmed?.totalCents ?? 0)),
    cash: cashPlan(items, today, monthlyBudgetCents),
    sandboxStandIn: false,
  };
}

export const payLabel = (role: VendorRole, vendorName: string) => `Pay ${role === "other" ? vendorName : role}`;
