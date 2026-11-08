"use client";

import { useState, type ReactNode } from "react";
import { Check, ShieldAlert, X } from "lucide-react";
import type { Money } from "@/lib/money";
import { MoneyBadge } from "../money-badge";
import { Button } from "../ui/button";
import { cn } from "../ui/cn";
import { useKit } from "../kit/kit-provider";
import { useToast } from "../toast";
import { plainText } from "@/lib/plain-text";

/**
 * The human-in-the-loop card. Posts the decision to /api/agent/approvals/:id; the waiting
 * agent continues (or stops) immediately.
 */
export function ApprovalPrompt({
  approvalId,
  summary,
  reason,
  amount,
  details,
  onDecided,
  onApproved,
  approveLabel = "Approve",
  decisionExtra,
  className,
}: {
  approvalId: string;
  summary: string;
  reason?: string;
  amount?: Money;
  details?: ReactNode;
  onDecided?: (decision: "approved" | "denied") => void;
  /** Gets the server's answer to an approval. Return true when it takes over (say, opening checkout). */
  onApproved?: (response: unknown) => boolean | Promise<boolean>;
  approveLabel?: string;
  /** Sent along with an approval, e.g. how the couple chose to pay. */
  decisionExtra?: Record<string, unknown>;
  className?: string;
}) {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const [busy, setBusy] = useState<"approved" | "denied" | null>(null);

  async function decide(decision: "approved" | "denied") {
    setBusy(decision);
    try {
      const response = await kitFetch(`/api/agent/approvals/${approvalId}`, { json: { decision, ...(decision === "approved" ? decisionExtra : {}) } });
      const handled = decision === "approved" && onApproved ? await onApproved(response) : false;
      onDecided?.(decision);
      if (!handled) toast({ title: decision === "approved" ? "Approved" : "Declined", description: summary, variant: decision === "approved" ? "success" : "warning" });
    } catch (e) {
      toast({ title: "Could not record decision", description: (e as Error).message, variant: "error" });
      setBusy(null);
    }
  }

  return (
    <div data-testid="approval-prompt" className={cn("animate-pulse-ring rounded-xl border border-amber-300 bg-gradient-to-b from-amber-50 to-white p-4", className)}>
      <div className="flex items-start gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <ShieldAlert className="size-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-amber-700">Approval needed</p>
          <p className="mt-0.5 font-semibold text-zinc-900">{plainText(summary)}</p>
          {reason ? <p className="mt-0.5 text-sm text-zinc-600">{plainText(reason)}</p> : null}
        </div>
        {amount ? <MoneyBadge amount={amount} direction="neutral" size="lg" /> : null}
      </div>
      {details}
      <div className="mt-3 flex justify-end gap-2">
        <Button variant="secondary" size="sm" icon={<X className="size-4" />} loading={busy === "denied"} disabled={!!busy} onClick={() => decide("denied")}>
          Decline
        </Button>
        <Button variant="success" size="sm" icon={<Check className="size-4" />} loading={busy === "approved"} disabled={!!busy} onClick={() => decide("approved")} data-testid="approve-button">
          {approveLabel}
        </Button>
      </div>
    </div>
  );
}
