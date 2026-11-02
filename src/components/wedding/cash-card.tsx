"use client";

import { useState } from "react";
import { AlertTriangle, CircleCheck } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { useToast } from "@/components/toast";
import { Button, Card, CardBody, CardHeader, Field, MoneyInput } from "@/components/ui";
import { centsToDollars, parseDollars } from "@/lib/wedding/cents";
import type { CashPlan } from "@/lib/wedding/types";

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
      <CardHeader title="Cash check" description="Payments that land together against your monthly budget. Worked out by code." />
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
              <li key={`${w.kind}-${w.from}`} className="flex items-start gap-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="cash-warning" data-kind={w.kind}>
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {w.message}
              </li>
            ))}
          </ul>
        ) : (
          <p className="flex items-center gap-2 text-sm text-zinc-600" data-testid="cash-clear">
            <CircleCheck className="size-4 text-emerald-600" /> Nothing clashes with your budget.
          </p>
        )}
      </CardBody>
    </Card>
  );
}
