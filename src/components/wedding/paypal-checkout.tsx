"use client";

/**
 * The couple pay an approved payment themselves. In sandbox this is PayPal's own checkout page,
 * where they log in or pay by card as a guest, and PayPal sends them back to the timeline. With mock
 * PayPal it is the kit's simulated approval, which follows the same server flow.
 */
import { useEffect, useSyncExternalStore } from "react";
import { ShieldCheck } from "lucide-react";
import { CheckoutButton } from "@/components/paypal/checkout-button";
import { useKit } from "@/components/kit/kit-provider";
import { useToast } from "@/components/toast";
import { formatCents } from "@/lib/wedding/cents";
import { checkoutOpened, subscribeCheckout, wantsCheckout } from "./open-checkout";
import type { TimelineItem } from "@/lib/wedding/types";

/**
 * In sandbox the payee is a test business account, so say plainly which one and whose place it
 * takes: a separate vendor account for some vendors, the app's own for the rest.
 */
export function StandInLine({ item, className }: { item: TimelineItem; className?: string }) {
  const email = item.payment?.payee ?? item.sandboxPayee?.email;
  const own = item.sandboxPayee?.own ?? true;
  return (
    <p className={className ?? "text-xs text-zinc-500"} data-testid="stand-in" data-account={own ? "app" : "vendor"}>
      {own
        ? `In the sandbox, this app's own test business account${email ? ` (${email})` : ""} stands in for ${item.vendorName}.`
        : `In the sandbox, PayPal pays a separate vendor test business account${email ? ` (${email})` : ""}, standing in for ${item.vendorName}.`}
    </p>
  );
}

export function PayPalCheckout({ item, sandbox, onPaid, className }: { item: TimelineItem; sandbox: boolean; onPaid: () => void; className?: string }) {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const payment = item.payment;
  // Right after "Approve and pay", the simulated checkout opens by itself (mock PayPal only).
  const autoStart = useSyncExternalStore(subscribeCheckout, () => wantsCheckout(item.id), () => false);
  const ready = !!payment?.orderId;
  // The simulated checkout (a child) has opened by the time this runs.
  useEffect(() => {
    if (autoStart && ready) checkoutOpened(item.id);
  }, [autoStart, ready, item.id]);
  if (!payment?.orderId) return null;
  const orderId = payment.orderId;
  const amount = formatCents(item.cents);

  return (
    <div className={`rounded-xl border border-sky-200 bg-sky-50/60 p-4 text-sm text-zinc-700 ${className ?? ""}`} data-testid="checkout-box">
      <p className="font-semibold text-zinc-900">Approved. Pay {amount} to {item.vendorName} in PayPal&apos;s checkout.</p>
      <dl className="mt-2 grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-1 text-sm">
        <dt className="text-zinc-500">From</dt>
        <dd className="font-medium text-zinc-900">Your PayPal account or card, in PayPal&apos;s checkout</dd>
        <dt className="text-zinc-500">To</dt>
        <dd className="font-medium text-zinc-900" data-testid="checkout-to">{item.vendorName}</dd>
        <dt className="text-zinc-500">PayPal account</dt>
        <dd className="break-all text-zinc-900" data-testid="checkout-payee">{payment.payee}</dd>
        <dt className="text-zinc-500">Order</dt>
        <dd className="break-all font-mono text-xs text-zinc-900" data-testid="checkout-order-id">{orderId}</dd>
      </dl>
      {sandbox ? <StandInLine item={item} className="mt-2 text-xs text-zinc-600" /> : null}
      <div className="mt-3">
        {sandbox && payment.checkoutUrl ? (
          <>
            <a
              href={payment.checkoutUrl}
              data-testid="paypal-checkout"
              className="flex h-11 w-full max-w-sm items-center justify-center gap-2 rounded-lg bg-[#ffc439] font-semibold text-[#111] shadow-sm transition hover:brightness-95"
            >
              Pay {amount} with PayPal
            </a>
            <p className="mt-2 flex items-center gap-1.5 text-xs text-zinc-500">
              <ShieldCheck className="size-3.5" /> Opens PayPal&apos;s sandbox checkout. Log in as a sandbox buyer, or pay as a guest with PayPal&apos;s test card 4111 1111 1111 1111.
            </p>
          </>
        ) : (
          <CheckoutButton
            amountLabel={amount}
            label={`Pay ${amount} with PayPal`}
            autoStart={autoStart}
            createOrder={async () => ({ orderId })}
            onApprove={async ({ orderId: approved }) => {
              await kitFetch(`/api/contracts/${item.contractId}/capture`, { json: { kind: item.kind, orderId: approved } });
              onPaid();
            }}
            onError={(e) => toast({ title: "PayPal checkout didn't finish", description: e.message, variant: "error" })}
          />
        )}
      </div>
    </div>
  );
}
