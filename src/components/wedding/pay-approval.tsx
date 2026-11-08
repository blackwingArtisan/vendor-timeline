"use client";

import { useState } from "react";
import { ApprovalPrompt } from "@/components/agent/approval-prompt";
import { formatCents } from "@/lib/wedding/cents";
import { formatMonth } from "@/lib/wedding/dates";
import type { CashPlan, PendingApproval, TimelineItem, WalletView } from "@/lib/wedding/types";
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
 * It is the only approval: "Approve and pay" goes straight on to PayPal's checkout, or, once PayPal
 * has saved the couple's PayPal, charges that with no checkout window.
 */
export function PayApproval({ item, approval, cash, sandbox, wallet, onDecided, className }: { item: TimelineItem; approval: PendingApproval; cash: CashPlan; sandbox: boolean; wallet?: WalletView; onDecided?: () => void; className?: string }) {
  const [useCheckout, setUseCheckout] = useState(false);
  const [save, setSave] = useState(false);
  const saved = wallet?.saved && !useCheckout ? wallet.saved : null;
  return (
    <ApprovalPrompt
      className={className}
      approvalId={approval.id}
      summary={approval.summary}
      reason={saved ? "This is your money. One approval, and PayPal charges your saved PayPal for exactly this amount, with no checkout window." : "This is your money. You pay it yourself in PayPal's checkout, and nothing moves before that."}
      amount={approval.amountValue ? { currency_code: "USD", value: approval.amountValue } : undefined}
      approveLabel={saved ? "Approve and pay with saved PayPal" : "Approve and pay"}
      decisionExtra={saved ? { method: "saved" } : { method: "checkout", save: !!wallet?.canSave && save }}
      onApproved={(response) => {
        const { checkoutUrl, saved: charged } = (response ?? {}) as { checkoutUrl?: string; saved?: boolean };
        // Charged to the saved PayPal: nothing to open. The row follows PayPal's capture.
        if (charged) return false;
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
            <dd className="font-medium text-zinc-900" data-testid="approval-from">
              {saved ? `Your saved PayPal${saved.email ? ` (${saved.email})` : ""}, no checkout window` : "Your PayPal, in PayPal's checkout"}
            </dd>
            <dt className="text-zinc-500">To</dt>
            <dd className="font-medium text-zinc-900" data-testid="approval-to">{item.vendorName}</dd>
          </dl>
          <p data-testid="approval-budget">{budgetLine(item, cash)}</p>
          {wallet?.saved ? (
            <label className="flex items-center gap-2 text-xs text-zinc-600">
              <input type="checkbox" className="size-3.5 accent-brand" checked={useCheckout} onChange={(e) => setUseCheckout(e.target.checked)} data-testid="use-checkout" />
              Pay in PayPal&apos;s checkout instead
            </label>
          ) : null}
          {wallet?.canSave ? (
            <label className="flex items-center gap-2 text-xs text-zinc-600">
              <input type="checkbox" className="size-3.5 accent-brand" checked={save} onChange={(e) => setSave(e.target.checked)} data-testid="save-paypal" />
              Save my PayPal for this plan&apos;s later payments (PayPal asks you to log in)
            </label>
          ) : null}
          {sandbox ? <StandInLine item={item} /> : null}
        </div>
      }
    />
  );
}
