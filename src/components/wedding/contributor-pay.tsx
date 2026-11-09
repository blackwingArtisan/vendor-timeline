"use client";

/**
 * The contributor's side of "Assign to a parent": one card, made for a phone. Which vendor, which
 * payment and how much, from the server; one button to ask to pay; then, once the couple approve,
 * PayPal's own checkout in the contributor's own account or card. The contributor can't change the
 * amount or who is paid.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { CircleCheck, Clock, HandCoins, ShieldCheck } from "lucide-react";
import { CheckoutButton } from "@/components/paypal/checkout-button";
import { Button, Card, CardBody } from "@/components/ui";
import { formatDay } from "@/lib/wedding/dates";

interface View {
  name: string;
  vendorName: string;
  kind: "deposit" | "balance";
  amount: string;
  due: string | null;
  state: "open" | "waiting" | "checkout" | "sending" | "paid" | "taken";
  orderId: string | null;
  checkoutUrl: string | null;
  captureId: string | null;
  payee: string | null;
  error: string | null;
  sandbox: boolean;
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error?.message ?? body?.message ?? "Something went wrong. Try again.");
  return body as T;
}

export function ContributorScreen() {
  const { token } = useParams<{ token: string }>();
  const base = `/api/contribute/${encodeURIComponent(token)}`;
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const returned = useRef(false);

  const load = useCallback(() => api<View>(base).then(setView, (e: Error) => setError(e.message)), [base]);

  // PayPal sends the contributor back here from its checkout: capture that order, then tidy the address.
  useEffect(() => {
    if (returned.current) return;
    returned.current = true;
    const params = new URLSearchParams(window.location.search);
    const back = params.get("checkout");
    const cancelled = params.get("cancelled");
    const orderId = params.get("token");
    if (!back && !cancelled) {
      void load();
      return;
    }
    window.history.replaceState(null, "", window.location.pathname);
    void (async () => {
      if (cancelled || !orderId) {
        setError(cancelled ? "PayPal checkout was cancelled. Nothing was paid." : "That link back from PayPal is missing its order, so nothing was taken.");
        await load();
        return;
      }
      setBusy(true);
      try {
        setView(await api<View>(`${base}/capture`, { method: "POST", body: JSON.stringify({ orderId }) }));
      } catch (e) {
        setError((e as Error).message);
        await load();
      } finally {
        setBusy(false);
      }
    })();
  }, [base, load]);

  // While the couple decide, or PayPal confirms, keep the card current.
  const waiting = view?.state === "waiting" || view?.state === "sending";
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(() => void load(), 2000);
    return () => clearInterval(timer);
  }, [waiting, load]);

  async function ask() {
    setBusy(true);
    setError(null);
    try {
      setView(await api<View>(`${base}/pay`, { method: "POST" }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!view) {
    return (
      <main className="mx-auto max-w-md px-4 py-8">
        {error ? <p className="text-sm text-red-700" data-testid="contrib-error">{error}</p> : <p className="text-sm text-zinc-500" data-testid="contrib-loading">Opening the payment.</p>}
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md px-4 py-6" data-testid="contrib-page" data-state={view.state}>
      <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-zinc-500">Wedding Vendor Timeline · help pay a vendor</p>
      <Card>
        <CardBody className="space-y-4">
          <div>
            <p className="text-sm text-zinc-600">For {view.name}</p>
            <h1 className="mt-1 text-lg font-semibold leading-snug text-zinc-900" data-testid="contrib-ask">
              Pay the {view.vendorName} {view.kind}: {view.amount}
            </h1>
            {view.due ? <p className="mt-1 text-sm text-zinc-600">Due {formatDay(view.due)}. The couple asked you to pay this one payment from your own PayPal.</p> : null}
          </div>

          {view.state === "open" ? (
            <>
              <p className="text-sm text-zinc-700">The couple approve it first, then you pay {view.amount} in PayPal&apos;s own checkout. The amount and the vendor come from their contract.</p>
              <Button className="w-full" icon={<HandCoins className="size-4" />} loading={busy} disabled={busy} onClick={() => void ask()} data-testid="contrib-start">
                Pay {view.amount}
              </Button>
            </>
          ) : null}
          {view.state === "waiting" ? (
            <p className="flex items-start gap-2 text-sm text-zinc-700" data-testid="contrib-waiting">
              <Clock className="mt-0.5 size-4 shrink-0" /> Waiting for the couple to approve it. This page updates by itself.
            </p>
          ) : null}
          {view.state === "checkout" && view.orderId ? (
            <div className="space-y-2" data-testid="contrib-checkout">
              <p className="text-sm font-medium text-zinc-900">Approved. Pay {view.amount} to {view.vendorName} in PayPal&apos;s checkout.</p>
              {view.sandbox && view.checkoutUrl ? (
                <>
                  <a href={view.checkoutUrl} data-testid="paypal-checkout" className="flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-[#ffc439] font-semibold text-[#111] shadow-sm transition hover:brightness-95">
                    Pay {view.amount} with PayPal
                  </a>
                  <p className="flex items-center gap-1.5 text-xs text-zinc-500">
                    <ShieldCheck className="size-3.5" /> Opens PayPal&apos;s sandbox checkout. Log in as a sandbox buyer, or pay as a guest with PayPal&apos;s test card 4111 1111 1111 1111.
                  </p>
                </>
              ) : (
                <CheckoutButton
                  amountLabel={view.amount}
                  label={`Pay ${view.amount} with PayPal`}
                  createOrder={async () => ({ orderId: view.orderId! })}
                  onApprove={async ({ orderId }) => setView(await api<View>(`${base}/capture`, { method: "POST", body: JSON.stringify({ orderId }) }))}
                  onError={(e) => setError(e.message)}
                />
              )}
            </div>
          ) : null}
          {view.state === "sending" || view.state === "paid" ? (
            <div className="space-y-1 text-sm" data-testid="contrib-paid">
              <p className="flex items-center gap-2 font-medium text-emerald-800">
                <CircleCheck className="size-4 shrink-0" /> {view.state === "paid" ? `Paid. ${view.vendorName} has your ${view.amount}. Thank you.` : "Paid in PayPal. Waiting for PayPal to confirm it."}
              </p>
              {view.captureId ? <p className="break-all text-xs text-zinc-500">PayPal capture <span className="font-mono" data-testid="contrib-capture-id">{view.captureId}</span>{view.payee ? ` · paid to ${view.payee}` : ""}</p> : null}
            </div>
          ) : null}
          {view.state === "taken" ? <p className="text-sm text-zinc-700" data-testid="contrib-taken">The couple have already paid this one. Nothing for you to do.</p> : null}
          {error || view.error ? <p className="text-sm text-red-700" data-testid="contrib-error">{error ?? view.error}</p> : null}
        </CardBody>
      </Card>
      <p className="mt-3 text-xs text-zinc-500">The couple shared this link with you. It shows only this payment.</p>
    </main>
  );
}
