"use client";

import { ApprovalPrompt } from "@/components/agent/approval-prompt";
import { formatCents } from "@/lib/wedding/cents";
import type { CashPlan, PendingApproval, TimelineItem } from "@/lib/wedding/types";
import { openCheckoutFor } from "./open-checkout";
import { StandInLine } from "./paypal-checkout";

/** The sum this approval makes, worked out by the cash check. */
function budgetLine(item: TimelineItem, cash: CashPlan) {
  const month = cash.months.find((m) => m.payments.some((p) => p.id === item.id));
  if (!month) return null;
  const spent = `${month.label} comes to ${formatCents(month.totalCents)} of your ${formatCents(month.budgetCents)} monthly budget`;
  return month.leftCents < 0 ? `With this, ${spent}, ${formatCents(-month.leftCents)} over.` : `With this, ${spent}, ${formatCents(month.leftCents)} left.`;
}

/**
 * Asks the couple to spend their own money, and says where it goes and what it does to the month.
 * It is the only approval: "Approve and pay" goes straight on to PayPal's checkout.
 */
export function PayApproval({ item, approval, cash, sandbox, onDecided, className }: { item: TimelineItem; approval: PendingApproval; cash: CashPlan; sandbox: boolean; onDecided?: () => void; className?: string }) {
  return (
    <ApprovalPrompt
      className={className}
      approvalId={approval.id}
      summary={approval.summary}
      reason="This is your money. Approve and pay opens PayPal's checkout, where you pay it yourself. Nothing moves before that."
      amount={approval.amountValue ? { currency_code: "USD", value: approval.amountValue } : undefined}
      approveLabel="Approve and pay"
      onApproved={(response) => {
        const { checkoutUrl } = (response ?? {}) as { checkoutUrl?: string };
        if (checkoutUrl) {
          window.location.assign(checkoutUrl); // PayPal's own checkout page.
          return true;
        }
        openCheckoutFor(item.id);
        return true;
      }}
      onDecided={onDecided}
      details={
        <div className="mt-3 space-y-1 border-t border-amber-200 pt-3 text-sm text-zinc-700">
          <dl className="grid grid-cols-[3rem_1fr] gap-x-2 gap-y-1">
            <dt className="text-zinc-500">From</dt>
            <dd className="font-medium text-zinc-900" data-testid="approval-from">Your PayPal, in PayPal&apos;s checkout</dd>
            <dt className="text-zinc-500">To</dt>
            <dd className="font-medium text-zinc-900" data-testid="approval-to">{item.vendorName}</dd>
          </dl>
          <p data-testid="approval-budget">{budgetLine(item, cash)}</p>
          {sandbox ? <StandInLine item={item} /> : null}
        </div>
      }
    />
  );
}
