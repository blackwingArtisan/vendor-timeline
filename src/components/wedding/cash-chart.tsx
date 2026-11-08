"use client";

/**
 * Month by month: what leaves each month against the monthly budget line. Plain bars, no chart
 * library. Every number is the cash check's own (cash-chart.ts).
 */
import { formatCents } from "@/lib/wedding/cents";
import { chartMonths, chartTopCents } from "@/lib/wedding/cash-chart";
import type { CashPlan } from "@/lib/wedding/types";

const pct = (cents: number, top: number) => `${Math.min(100, (cents / top) * 100)}%`;

export function CashChart({ cash, className }: { cash: CashPlan; className?: string }) {
  const months = chartMonths(cash);
  if (!months.length) return null;
  const budget = cash.monthlyBudgetCents;
  const top = chartTopCents(months, budget);
  return (
    <figure className={className} data-testid="cash-chart">
      <figcaption className="sr-only">
        Each month&apos;s payments against your {formatCents(budget)} monthly budget: {months.map((m) => `${m.label} ${formatCents(m.totalCents)}`).join(", ")}.
      </figcaption>
      <div className="relative h-32" aria-hidden>
        <div className="absolute inset-x-0 z-10 border-t border-dashed border-zinc-500" style={{ bottom: pct(budget, top) }} data-testid="cash-chart-budget">
          <span className="absolute -top-4 right-0 bg-white px-1 text-[10px] font-medium text-zinc-600">Budget {formatCents(budget)}</span>
        </div>
        <div className="absolute inset-0 flex items-end gap-1 border-b border-zinc-200">
          {months.map((m) => (
            <div key={m.month} className="relative flex h-full min-w-0 flex-1 flex-col justify-end" title={`${m.label}: ${formatCents(m.totalCents)} of your ${formatCents(budget)} budget`} data-testid="cash-chart-month" data-month={m.month} data-total-cents={m.totalCents}>
              <div className="flex w-full flex-col justify-end overflow-hidden rounded-t transition-[height] duration-700 ease-out" style={{ height: pct(m.totalCents, top) }}>
                <div className="w-full flex-1 bg-brand-300" />
                {m.paidCents ? <div className="w-full bg-emerald-500" style={{ height: `${(m.paidCents / Math.max(m.totalCents, 1)) * 100}%` }} /> : null}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex gap-1" aria-hidden>
        {months.map((m) => (
          <span key={m.month} className="min-w-0 flex-1 truncate text-center text-[10px] leading-tight text-zinc-500">{m.short}</span>
        ))}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500" aria-hidden>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-brand-300" /> To pay</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-emerald-500" /> Paid</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 border-t border-dashed border-zinc-500" /> Monthly budget</span>
      </p>
    </figure>
  );
}
