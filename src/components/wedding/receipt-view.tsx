"use client";

/**
 * A paid payment's receipt, read back from PayPal when it opens: order, capture, the webhook event
 * that marked it paid, and PayPal's debug_id for each re-read. Every value is PayPal's.
 */
import { useEffect, useState, type ReactNode } from "react";
import { ReceiptText, X } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { Button } from "@/components/ui";
import type { TimelineItem } from "@/lib/wedding/types";
import type { Receipt } from "@/lib/wedding/receipt";

const CALL_NAME: Record<string, string> = { "orders.get": "Order re-read", "payments.getCapture": "Capture re-read" };

function Line({ label, children, testId }: { label: string; children: ReactNode; testId?: string }) {
  return (
    <div className="grid grid-cols-[11rem_minmax(0,1fr)] gap-x-3 py-0.5">
      <dt className="font-sans text-zinc-500">{label}</dt>
      <dd className="min-w-0 break-all text-zinc-900" data-testid={testId}>{children}</dd>
    </div>
  );
}

export function ReceiptView({ item, onClose }: { item: TimelineItem; onClose: () => void }) {
  const { kitFetch } = useKit();
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    kitFetch<Receipt>(`/api/contracts/${item.contractId}/receipt?kind=${item.kind}`).then(
      (r) => live && setReceipt(r),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
  }, [kitFetch, item.contractId, item.kind]);

  return (
    <section className="mt-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs" data-testid="receipt" aria-label={`Receipt for the ${item.vendorName} ${item.kind}`}>
      <div className="flex items-center justify-between gap-2">
        <p className="inline-flex items-center gap-1.5 font-semibold text-zinc-900">
          <ReceiptText className="size-3.5 text-brand" aria-hidden /> Receipt, read back from PayPal
          {receipt ? <span className="font-normal text-zinc-500" data-testid="receipt-read-at">just now, {new Date(receipt.readAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit", second: "2-digit" })}</span> : null}
        </p>
        <Button size="sm" variant="ghost" className="px-2" icon={<X className="size-3.5" />} onClick={onClose} aria-label="Close the receipt" data-testid="receipt-close">
          <span className="sr-only">Close</span>
        </Button>
      </div>
      {error ? <p className="mt-1 text-red-700" role="alert" data-testid="receipt-error">{error}</p> : null}
      {!receipt && !error ? <p className="mt-1 text-zinc-500" data-testid="receipt-reading">Asking PayPal for the order and the capture…</p> : null}
      {receipt ? (
        <dl className="mt-1 font-mono">
          <Line label="Order" testId="receipt-order">
            <span data-testid="receipt-order-id">{receipt.orderId}</span> {receipt.orderStatus}
          </Line>
          <Line label="Capture" testId="receipt-capture">
            <span data-testid="receipt-capture-id">{receipt.captureId}</span> {receipt.captureStatus} {receipt.captureAmount}
          </Line>
          {receipt.payee ? <Line label="Paid to">{receipt.payee}</Line> : null}
          <Line label="Webhook event" testId="receipt-webhook">
            {receipt.webhook ? (
              <>
                <span data-testid="receipt-webhook-event">{receipt.webhook.eventId}</span> {receipt.webhook.eventType}
              </>
            ) : (
              <span className="font-sans text-zinc-600">None reached this copy of the app. It was marked paid on PayPal&apos;s re-read of the capture.</span>
            )}
          </Line>
          {receipt.calls.map((c) => (
            <Line key={c.operation} label={`${CALL_NAME[c.operation] ?? c.operation} debug_id`}>
              <span data-testid="receipt-debug-id" data-operation={c.operation}>{c.debugId ?? "not given"}</span>
            </Line>
          ))}
        </dl>
      ) : null}
    </section>
  );
}
