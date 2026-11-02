"use client";

import { useState } from "react";
import { AlertTriangle, CircleCheck } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { useToast } from "@/components/toast";
import { Button, Card, CardBody, CardHeader, Field, MoneyInput } from "@/components/ui";
import { centsToDollars, formatCents, parseDollars } from "@/lib/wedding/cents";
import { formatDay } from "@/lib/wedding/dates";
import type { CashMonth, CashPayment, CashPlan, CashWarning } from "@/lib/wedding/types";

function whenItPays(p: CashPayment) {
  if (p.paid) return `Paid ${formatDay(p.payDate)}`;
  return p.payDate === p.due ? `Pays ${formatDay(p.payDate)}` : `Pays ${formatDay(p.payDate)}, was due ${formatDay(p.due)}`;
}

function Sums({ payments, lines }: { payments: CashPayment[]; lines: [string, number][] }) {
  return (
    <ul className="mt-2 space-y-1.5 text-xs tabular-nums">
      {payments.map((p) => (
        <li key={p.id} className="flex items-baseline justify-between gap-3">
          <span className="min-w-0">
            <span className="block font-medium">{p.label}</span>
            <span className="block opacity-80">{whenItPays(p)}</span>
          </span>
          <span className="shrink-0">{formatCents(p.cents)}</span>
        </li>
      ))}
      {lines.map(([label, cents], index) => (
        <li key={label} className={`flex justify-between gap-3 ${index === 0 ? "border-t border-current/20 pt-1.5" : ""} ${index === lines.length - 1 ? "font-semibold" : ""}`}>
          <span>{label}</span>
          <span>{formatCents(cents)}</span>
        </li>
      ))}
    </ul>
  );
}

function warningLines(w: CashWarning, budget: number): [string, number][] {
  return [
    [w.kind === "same_week" ? "Total in one week" : "Total for the month", w.totalCents],
    ["Monthly budget", budget],
    ["Over by", w.overByCents],
  ];
}

function monthLines(m: CashMonth): [string, number][] {
  return [
    ["Total", m.totalCents],
    ["Monthly budget", m.budgetCents],
    [m.leftCents < 0 ? "Over by" : "Left", Math.abs(m.leftCents)],
  ];
}

/** Everything here is worked out by code, so it stays right with AI switched off. */
export function CashCard({ cash, onChanged }: { cash: CashPlan; onChanged: () => void }) {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const [budget, setBudget] = useState(centsToDollars(cash.monthlyBudgetCents));
  const [saving, setSaving] = useState(false);

  async function save() {
    const monthlyBudgetCents = parseDollars(budget);
    if (!monthlyBudgetCents) return toast({ title: "Enter a monthly budget", description: "For example 5,000.00", variant: "error" });
    setSaving(true);
    try {
      await kitFetch("/api/timeline/budget", { json: { monthlyBudgetCents } });
      onChanged();
    } catch (e) {
      toast({ title: "Could not save your budget", description: (e as Error).message, variant: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="cash-card">
      <CardHeader title="Cash check" description="Each payment on the day it leaves, against your monthly budget. Worked out by code." />
      <CardBody>
        <form
          className="mb-3 flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <Field label="Monthly budget" htmlFor="monthly-budget" className="flex-1">
            <MoneyInput id="monthly-budget" value={budget} onChange={(e) => setBudget(e.target.value)} data-testid="monthly-budget" />
          </Field>
          <Button type="submit" variant="secondary" loading={saving} disabled={saving} data-testid="save-budget">
            Save
          </Button>
        </form>
        {cash.warnings.length ? (
          <ul className="space-y-2">
            {cash.warnings.map((w) => (
              <li key={`${w.kind}-${w.from}`} className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="cash-warning" data-kind={w.kind}>
                <p className="flex items-start gap-2">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" /> <span className="min-w-0">{w.message}</span>
                </p>
                <details className="mt-1 pl-6" data-testid="cash-sums">
                  <summary className="cursor-pointer text-xs font-medium underline underline-offset-2">Show the sums</summary>
                  <Sums payments={w.payments} lines={warningLines(w, cash.monthlyBudgetCents)} />
                </details>
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-zinc-600" data-testid="cash-clear">
            <CircleCheck className="size-4 text-emerald-600" /> Nothing clashes with your budget.
          </p>
        )}
        {cash.months.length ? (
          <details className="mt-3 text-sm text-zinc-700" data-testid="cash-months">
            <summary className="cursor-pointer text-xs font-medium underline underline-offset-2">Month by month</summary>
            <ul className="mt-2 space-y-3">
              {cash.months.map((m) => (
                <li key={m.month} data-testid="cash-month" data-month={m.month}>
                  <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">{m.label}</p>
                  <Sums payments={m.payments} lines={monthLines(m)} />
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardBody>
    </Card>
  );
}
