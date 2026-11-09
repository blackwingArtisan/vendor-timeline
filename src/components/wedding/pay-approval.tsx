"use client";

import { ApprovalPrompt } from "@/components/agent/approval-prompt";
import { formatCents } from "@/lib/wedding/cents";
import { formatMonth } from "@/lib/wedding/dates";
import type { CashPlan, PendingApproval, TimelineItem } from "@/lib/wedding/types";
import { openCheckoutFor } from "./open-checkout";
import { StandInLine } from "./paypal-checkout";

/** The sum this approval makes, worked out by the cash check. */
function budgetLine(item: TimelineItem, cash: CashPlan) {
  const month = cash.months.find((m) => m.payments.some((p) => p.id === item.id));
  if (!month) return null;
  const spent = `${month.label} comes to ${formatCents(month.totalCents)} of your ${formatCents(month.budgetCents)} monthly budget`;
  const sum = month.leftCents < 0 ? `With this, ${spent}, ${formatCents(-month.leftCents)} over.` : `With this, ${spent}, ${formatCents(month.leftCents)} left.`;
  // Paid now, it counts in this month, not the month it's due. Say so, or the month looks wrong.
  const dueMonth = formatMonth(item.due);
  return dueMonth === month.label ? sum : `Paid now, it counts in ${month.label}, not ${dueMonth} when it's due. ${sum}`;
}

/**
 * Asks the couple to spend their own money, and says where it goes and what it does to the month.
 * It is the only approval: "Approve and pay" goes straight on to PayPal's checkout.
 */
export function PayApproval({ item, approval, cash, sandbox, onDecided, className }: { item: TimelineItem; approval: PendingApproval; cash: CashPlan; sandbox: boolean; onDecided?: () => void; className?: string }) {
  // Someone the couple assigned this payment to asked to pay it: the couple approve, that person pays.
  const payer = item.payment?.payer?.name;
  return (
    <ApprovalPrompt
      className={className}
      approvalId={approval.id}
      summary={approval.summary}
      reason={payer ? `${payer} pays it in PayPal's checkout, from their link.` : "You pay it in PayPal's checkout."}
      amount={approval.amountValue ? { currency_code: "USD", value: approval.amountValue } : undefined}
      approveLabel={payer ? `Approve for ${payer}` : "Approve and pay"}
      onApproved={(response) => {
        if (payer) return true; // They pay from their own link; this browser stays on the timeline.
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
        <div className="mt-2 space-y-1 border-t border-amber-200 pt-2 text-sm text-zinc-700">
          <p data-testid="approval-why">{payer ? `${payer} asked to pay this from their own PayPal. Approve it, and they pay it in PayPal's checkout from their link. Nothing moves before that.` : "This is your money. You pay it yourself in PayPal's checkout, and nothing moves before that."}</p>
          {/* From and to on one line, so the card stays short enough to sit at the top of a phone screen. */}
          <dl className="flex flex-wrap gap-x-4 gap-y-0.5">
            <div className="flex gap-1.5">
              <dt className="text-zinc-500">From</dt>
              <dd className="font-medium text-zinc-900" data-testid="approval-from">{payer ? `${payer}'s PayPal, in their own checkout` : "Your PayPal, in PayPal's checkout"}</dd>
            </div>
            <div className="flex gap-1.5">
              <dt className="text-zinc-500">To</dt>
              <dd className="font-medium text-zinc-900" data-testid="approval-to">{item.vendorName}</dd>
            </div>
          </dl>
          <p data-testid="approval-budget">{budgetLine(item, cash)}</p>
          {sandbox ? <StandInLine item={item} /> : null}
        </div>
      }
    />
  );
}
