"use client";

/**
 * Month by month: what leaves each month against the monthly budget line. A month over the line is
 * marked in red with how much it's over. When a date moves or a payment is made early, the bars
 * slide to their new heights and a line says what changed. Plain bars, no chart library. Every
 * number is the cash check's own (cash-chart.ts).
 */
import { useState } from "react";
import { formatCents } from "@/lib/wedding/cents";
import { chartChanges, chartMonths, chartTopCents, type ChartChange, type ChartMonth } from "@/lib/wedding/cash-chart";
import type { CashPlan } from "@/lib/wedding/types";

const pct = (cents: number, top: number) => `${Math.min(100, (cents / top) * 100)}%`;
const short = (cents: number) => formatCents(cents).replace(/\.00$/, "");

/** The months as last drawn, and what changed from the drawing before. Kept across refreshes. */
function useChanges(months: ChartMonth[]) {
  const key = months.map((m) => `${m.month}:${m.totalCents}`).join(",");
  const [state, setState] = useState<{ key: string; months: ChartMonth[]; changes: ChartChange[] }>({ key, months, changes: [] });
  if (state.key !== key) {
    // A new drawing: compare it with the last one, during render, so the note and the bars change together.
    const changes = chartChanges(state.months, months);
    setState({ key, months, changes });
    return changes;
  }
  return state.changes;
}

export function CashChart({ cash, className }: { cash: CashPlan; className?: string }) {
  const months = chartMonths(cash);
  const changes = useChanges(months);
  if (!months.length) return null;
  const budget = cash.monthlyBudgetCents;
  const top = chartTopCents(months, budget);
  const over = months.filter((m) => m.overByCents > 0);
  return (
    <figure className={className} data-testid="cash-chart">
      <figcaption className="sr-only">
        Each month&apos;s payments against your {formatCents(budget)} monthly budget: {months.map((m) => `${m.label} ${formatCents(m.totalCents)}${m.overByCents ? `, ${formatCents(m.overByCents)} over` : ""}`).join("; ")}.
      </figcaption>
      <div className="relative h-28" aria-hidden>
        <div className="absolute inset-x-0 z-10 border-t border-dashed border-zinc-500" style={{ bottom: pct(budget, top) }} data-testid="cash-chart-budget">
          <span className="absolute -top-4 left-0 bg-white px-1 text-[10px] font-medium text-zinc-600">Budget {short(budget)}</span>
        </div>
        <div className="absolute inset-0 flex items-end gap-1 border-b border-zinc-200">
          {months.map((m) => {
            const changed = changes.some((c) => c.month === m.month);
            return (
              <div
                key={m.month}
                className="relative flex h-full min-w-0 flex-1 flex-col justify-end"
                title={`${m.label}: ${formatCents(m.totalCents)} of your ${formatCents(budget)} budget${m.overByCents ? `, ${formatCents(m.overByCents)} over` : ""}`}
                data-testid="cash-chart-month"
                data-month={m.month}
                data-total-cents={m.totalCents}
                data-over={m.overByCents > 0 ? "true" : "false"}
                data-changed={changed ? "true" : "false"}
              >
                <div className={`relative flex w-full flex-col justify-end overflow-hidden rounded-t transition-[height] duration-700 ease-out ${changed ? "ring-2 ring-brand ring-offset-1" : ""}`} style={{ height: pct(m.totalCents, top) }}>
                  <div className="w-full flex-1 bg-brand-300" />
                  {m.paidCents ? <div className="w-full bg-emerald-500" style={{ height: `${(m.paidCents / Math.max(m.totalCents, 1)) * 100}%` }} /> : null}
                  {/* The part above the budget line, in red. */}
                  {m.overByCents ? <div className="absolute inset-x-0 top-0 bg-red-500/85 transition-[height] duration-700 ease-out" style={{ height: `${(m.overByCents / m.totalCents) * 100}%` }} /> : null}
                </div>
                {m.overByCents ? (
                  <span className="absolute inset-x-0 z-20 text-center text-[10px] font-semibold leading-none text-red-700" style={{ bottom: `calc(${pct(m.totalCents, top)} + 3px)` }} data-testid="cash-chart-over">
                    +{short(m.overByCents)}
                  </span>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex gap-1" aria-hidden>
        {months.map((m) => (
          <span key={m.month} className={`min-w-0 flex-1 truncate text-center text-[10px] leading-tight ${m.overByCents ? "font-semibold text-red-700" : "text-zinc-500"}`}>{m.short}</span>
        ))}
      </div>
      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-zinc-500" aria-hidden>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-brand-300" /> To pay</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-emerald-500" /> Paid</span>
        <span className="inline-flex items-center gap-1"><span className="size-2 rounded-sm bg-red-500" /> Over budget</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 border-t border-dashed border-zinc-500" /> Monthly budget</span>
      </p>
      <p className={`mt-1 text-xs ${over.length ? "text-red-700" : "text-emerald-700"}`} data-testid="cash-chart-summary">
        {over.length ? `Over budget: ${over.map((m) => `${m.label} by ${formatCents(m.overByCents)}`).join(", ")}.` : "Every month fits your budget."}
      </p>
      {changes.length ? (
        <p className="mt-1 rounded-md bg-brand-50 px-2 py-1 text-xs text-brand-900" data-testid="cash-chart-change">
          Just changed: {changes.map((c) => `${c.label} ${formatCents(c.fromCents)} → ${formatCents(c.toCents)}`).join(", ")}.
        </p>
      ) : null}
    </figure>
  );
}
