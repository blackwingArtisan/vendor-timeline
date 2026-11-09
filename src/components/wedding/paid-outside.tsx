"use client";

/**
 * A deposit or balance the couple paid outside PayPal, in cash or by cheque. The form records it;
 * the note under the row says plainly that it isn't a PayPal payment. Nothing here calls PayPal,
 * and once recorded the payment is closed, so neither the agent nor the Guard can pay it again.
 */
import { useState } from "react";
import { Banknote } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { Button, Input, MoneyInput, Select } from "@/components/ui";
import { amountText, formatCents } from "@/lib/wedding/cents";
import { formatDay, localToday } from "@/lib/wedding/dates";
import type { OutsideMethod, TimelineItem } from "@/lib/wedding/types";

const METHOD_LABEL: Record<OutsideMethod, string> = { cash: "cash", cheque: "cheque" };

export function PaidOutsideForm({ item, onSaved, onClose }: { item: TimelineItem; onSaved: () => void; onClose: () => void }) {
  const { kitFetch } = useKit();
  const today = localToday();
  const [amount, setAmount] = useState(amountText(item.cents));
  const [paidOn, setPaidOn] = useState(today);
  const [method, setMethod] = useState<OutsideMethod>("cheque");
  const [saving, setSaving] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function save() {
    setSaving(true);
    setProblem(null);
    try {
      await kitFetch(`/api/contracts/${item.contractId}/paid-outside`, { json: { kind: item.kind, amount, paidOn, method, today } });
      onSaved();
      onClose();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form
      className="mt-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
      data-testid="paid-outside-form"
    >
      <p className="text-xs text-zinc-600">
        Paid {item.vendorName} yourself, in cash or by cheque? Record it here. This isn&apos;t a PayPal payment: nothing is sent, and the app won&apos;t ask to pay it again.
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <MoneyInput aria-label="Amount paid" className="h-8 w-32 text-xs" value={amount} onChange={(e) => setAmount(e.target.value)} data-testid="paid-outside-amount" />
        <Input type="date" max={today} aria-label="Day you paid" className="h-8 w-36 text-xs" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} data-testid="paid-outside-date" />
        <Select aria-label="How you paid" className="h-8 w-28 text-xs" value={method} onChange={(e) => setMethod(e.target.value as OutsideMethod)} data-testid="paid-outside-method">
          <option value="cheque">Cheque</option>
          <option value="cash">Cash</option>
        </Select>
        <Button type="submit" size="sm" variant="secondary" loading={saving} disabled={saving} data-testid="paid-outside-save">Mark paid</Button>
        <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
      {problem ? <p className="mt-1 text-xs text-red-700" role="alert" data-testid="paid-outside-error">{problem}</p> : null}
    </form>
  );
}

/** Under a row paid outside PayPal: what the couple recorded, and that PayPal had no part in it. */
export function PaidOutsideNote({ item }: { item: TimelineItem }) {
  const outside = item.payment?.outside;
  if (item.payment?.paidBy !== "outside" || !outside) return null;
  return (
    <p className="mt-1 flex items-start gap-1.5 rounded-lg bg-zinc-50 px-3 py-1.5 text-xs text-zinc-600" data-testid="paid-outside">
      <Banknote className="mt-px size-3.5 shrink-0" aria-hidden />
      <span>
        Paid outside PayPal: {formatCents(item.cents)} by {METHOD_LABEL[outside.method]} on {formatDay(outside.paidOn)}. Not a PayPal payment, so there&apos;s no PayPal record or receipt.
      </span>
    </p>
  );
}

export const paidOutsideIcon = <Banknote className="size-3.5" />;
