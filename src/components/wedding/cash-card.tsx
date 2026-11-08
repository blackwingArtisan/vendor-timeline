"use client";

import { useState } from "react";
import { AlertTriangle, CircleCheck } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { Button, Card, CardBody, CardHeader, MoneyInput } from "@/components/ui";
import { CashChart } from "./cash-chart";
import { amountText, formatCents } from "@/lib/wedding/cents";
import { MAX_BUDGET_CENTS, readAmount } from "@/lib/wedding/limits";
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

/** A week is summed as a week. Only a month is weighed against the monthly budget. */
function warningLines(w: CashWarning, budget: number): [string, number][] {
  if (w.kind === "same_week") return [["Leaves in one week", w.totalCents]];
  return [
    ["Total for the month", w.totalCents],
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
  const [budget, setBudget] = useState(amountText(cash.monthlyBudgetCents));
  const [saving, setSaving] = useState(false);
  /** Why the budget wasn't saved. Stays until the box changes. */
  const [problem, setProblem] = useState<string | null>(null);

  async function save() {
    const read = readAmount(budget, "Monthly budget", MAX_BUDGET_CENTS);
    if (read.error !== undefined) return setProblem(read.error);
    setSaving(true);
    try {
      await kitFetch("/api/timeline/budget", { json: { monthlyBudgetCents: read.cents } });
      onChanged();
    } catch (e) {
      setProblem((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card data-testid="cash-card">
      <CardHeader className="py-3!" title="Cash check" description="Each month against your budget, worked out by code." />
      <CardBody className="py-3!">
        <CashChart cash={cash} className="mb-3" />
        <form
          className="mb-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            void save();
          }}
        >
          <label htmlFor="monthly-budget" className="shrink-0 text-sm font-medium text-zinc-700">Monthly budget</label>
          <MoneyInput id="monthly-budget" className="min-w-0 flex-1" value={budget} onChange={(e) => {
              setBudget(e.target.value);
              setProblem(null);
            }}
            aria-invalid={!!problem}
            data-testid="monthly-budget"
          />
          <Button type="submit" size="sm" variant="secondary" loading={saving} disabled={saving} data-testid="save-budget">
            Save
          </Button>
        </form>
        {problem ? (
          <p role="alert" className="-mt-1 mb-3 text-sm text-red-700" data-testid="budget-problem">
            {problem}
          </p>
        ) : null}
        {cash.warnings.length ? (
          <ul className="space-y-1.5">
            {cash.warnings.map((w) => (
              <li key={`${w.kind}-${w.from}`} className="rounded-lg bg-amber-50 px-3 py-1.5 text-xs text-amber-900" data-testid="cash-warning" data-kind={w.kind}>
                <p className="flex items-start gap-2">
                  <AlertTriangle className="mt-px size-3.5 shrink-0" /> <span className="min-w-0">{w.message}</span>
                </p>
                <details className="pl-5" data-testid="cash-sums">
                  <summary className="cursor-pointer font-medium underline underline-offset-2">Show the sums</summary>
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
