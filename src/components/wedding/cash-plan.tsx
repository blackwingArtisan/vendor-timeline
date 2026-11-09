"use client";

/**
 * The cash plan's moves, one card each, for the couple to approve one at a time. "Pay early" sends
 * the payment to the same approval and PayPal checkout as the timeline's Pay button. "Ask to move"
 * gives the couple a link to share with the vendor (ask-vendor.tsx); the date moves only on the
 * vendor's reply, checked by code and approved by the couple. Every
 * move, amount, date and sentence comes from code (cash-moves.ts).
 */
import { useState } from "react";
import { CalendarClock, CircleCheck, Send, Wallet } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { useToast } from "@/components/toast";
import { Badge, Button } from "@/components/ui";
import { formatCents } from "@/lib/wedding/cents";
import type { CashFix, CashMove, CashPlan, TimelineItem } from "@/lib/wedding/types";
import { PayApproval } from "./pay-approval";
import { PayPalCheckout } from "./paypal-checkout";
import { AskVendor } from "./ask-vendor";

function PayEarly({ move, item, cash, sandbox, onStarted, onDone }: { move: CashMove; item?: TimelineItem; cash: CashPlan; sandbox: boolean; onStarted: (runId: string) => void; onDone: () => void }) {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const [starting, setStarting] = useState(false);
  if (!item) return null;

  async function start() {
    setStarting(true);
    try {
      const { runId } = await kitFetch<{ runId?: string }>(`/api/contracts/${move.contractId}/pay`, { json: { kind: move.itemKind } });
      if (runId) onStarted(runId);
      onDone();
    } catch (e) {
      toast({ title: "Could not start that payment", description: (e as Error).message, variant: "error" });
    } finally {
      setStarting(false);
    }
  }

  if (item.status === "awaiting_approval" && item.approval) return <PayApproval className="mt-3" item={item} approval={item.approval} cash={cash} sandbox={sandbox} onDecided={onDone} />;
  if (item.status === "awaiting_approval") return <p className="mt-2 text-sm text-zinc-500">Working with PayPal.</p>;
  if (item.status === "awaiting_checkout") return <PayPalCheckout className="mt-3" item={item} sandbox={sandbox} onPaid={onDone} />;
  if (item.status === "sending") return <p className="mt-2 text-sm text-sky-800" data-testid="move-sending">Confirming with PayPal.</p>;
  if (item.status === "paid") {
    return (
      <p className="mt-2 flex items-center gap-2 text-sm text-emerald-800" data-testid="move-done">
        <CircleCheck className="size-4 shrink-0" /> Paid early through PayPal.
      </p>
    );
  }
  return (
    <Button size="sm" className="mt-2" icon={<Send className="size-3.5" />} loading={starting} disabled={starting} onClick={() => void start()} data-testid="move-pay">
      Pay early
    </Button>
  );
}

/**
 * The plan as it stands, plus any move the couple already started here, so a card stays while its
 * payment goes through approval and checkout even after the plan moves on.
 */
export function CashPlanMoves({ fix, started, items, cash, sandbox, onStarted, onDone, className }: { fix: CashFix | null; started: CashMove[]; items: TimelineItem[]; cash: CashPlan; sandbox: boolean; onStarted: (move: CashMove, runId?: string) => void; onDone: () => void; className?: string }) {
  const current = fix?.moves ?? [];
  const moves = [...started, ...current.filter((m) => !started.some((s) => s.itemId === m.itemId))];
  return (
    <div className={`rounded-xl border border-brand-200 bg-brand-50/40 p-4 ${className ?? ""}`} data-testid="cash-plan">
      <p className="text-sm font-semibold text-zinc-900">Cash plan: approve each move on its own</p>
      {/* The agent's message gives the plan as proposed. This line follows it as moves are made. */}
      {fix ? (
        fix.stillOver ? <p className="mt-1 text-sm text-zinc-700" data-testid="cash-plan-still-over">{fix.stillOver}</p> : null
      ) : (
        <p className="mt-1 flex items-center gap-2 text-sm text-emerald-800" data-testid="cash-plan-fits">
          <CircleCheck className="size-4 shrink-0" /> Every month now fits your {formatCents(cash.monthlyBudgetCents)} monthly budget.
        </p>
      )}
      {moves.length ? (
        <ul className="mt-3 space-y-3">
          {moves.map((move) => {
            const item = items.find((i) => i.id === move.itemId);
            return (
              <li key={move.id} className="rounded-lg border border-zinc-200 bg-white px-3 py-3" data-testid="cash-move" data-kind={move.kind} data-item={item ? `${item.vendorRole}.${item.kind}` : undefined}>
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 text-sm font-medium text-zinc-900" data-testid="move-title">{move.title}</p>
                  <Badge tone={move.kind === "pay_now" ? "brand" : "neutral"}>
                    <span className="inline-flex items-center gap-1">{move.kind === "pay_now" ? <Wallet className="size-3" /> : <CalendarClock className="size-3" />}{move.kind === "pay_now" ? "Pay early" : "Ask to move"}</span>
                  </Badge>
                </div>
                <p className="mt-1 text-xs text-zinc-600" data-testid="move-why">{move.why}</p>
                {move.kind === "pay_now" ? (
                  <PayEarly move={move} item={item} cash={cash} sandbox={sandbox} onStarted={(runId) => onStarted(move, runId)} onDone={onDone} />
                ) : (
                  <AskVendor move={move} item={item} onRun={(runId) => onStarted(move, runId)} onDone={() => {
                    onStarted(move);
                    onDone();
                  }} />
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
