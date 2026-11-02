"use client";

import { Card, CardBody, CardHeader } from "@/components/ui";
import { formatCents } from "@/lib/wedding/cents";
import { daysBetween, formatDay, formatMonth } from "@/lib/wedding/dates";
import type { ItemStatus, TimelineItem, TimelineView } from "@/lib/wedding/types";

const BAR_DAYS = 7;

const BAR_COLOR: Record<TimelineItem["kind"], string> = { deposit: "bg-brand", balance: "bg-brand-300" };
const STATUS_COLOR: Partial<Record<ItemStatus, string>> = { paid: "bg-emerald-500", overdue: "bg-red-500", sending: "bg-sky-500", awaiting_approval: "bg-amber-500" };

function vendorRows(items: TimelineItem[]) {
  const rows = new Map<string, TimelineItem[]>();
  for (const item of items) rows.set(item.contractId, [...(rows.get(item.contractId) ?? []), item]);
  return [...rows.values()];
}

function monthStarts(first: string, last: string) {
  const months: string[] = [];
  let [year, month] = first.split("-").map(Number);
  for (;;) {
    const start = `${year}-${String(month).padStart(2, "0")}-01`;
    if (start > last) return months;
    if (start >= first) months.push(start);
    [year, month] = month === 12 ? [year + 1, 1] : [year, month + 1];
  }
}

/** The free chart: no sponsor code. A bar starts on its due date. Dates move from the list below. */
export function VendorBars({ view }: { view: TimelineView }) {
  const dates = [view.today, ...view.items.map((i) => i.due)].sort();
  const [first, last] = [dates[0], dates.at(-1)!];
  const span = Math.max(daysBetween(first, last) + BAR_DAYS, 1);
  const left = (day: string) => `${(daysBetween(first, day) / span) * 100}%`;
  return (
    <Card className="mb-6" data-testid="free-bars">
      <CardHeader title="Vendor bars" description="Each vendor's deposit and balance, on one line." />
      <CardBody>
        <div className="relative">
          <div className="pointer-events-none absolute inset-y-0 left-40 right-0 hidden sm:block" aria-hidden>
            {monthStarts(first, last).map((month) => (
              <span key={month} className="absolute inset-y-0 border-l border-zinc-100 pl-1 text-[11px] leading-none text-zinc-400" style={{ left: left(month) }}>
                {formatMonth(month).split(" ")[0].slice(0, 3)}
              </span>
            ))}
            <span className="absolute inset-y-0 w-px bg-brand" style={{ left: left(view.today) }} title={`Today, ${formatDay(view.today)}`} />
          </div>
          <ul className="relative space-y-2 pt-5">
            {vendorRows(view.items).map((row) => (
              <li key={row[0].contractId} className="grid items-center gap-x-3 sm:grid-cols-[9.25rem_minmax(0,1fr)]">
                <p className="truncate text-sm text-zinc-700">{row[0].vendorName}</p>
                <div className="relative h-5 rounded-full bg-zinc-50">
                  {row.map((item) => (
                    <span
                      key={item.id}
                      className={`absolute inset-y-0.5 min-w-3 rounded ${STATUS_COLOR[item.status] ?? BAR_COLOR[item.kind]}`}
                      style={{ left: left(item.due), width: `${(BAR_DAYS / span) * 100}%` }}
                      title={`${item.vendorName} ${item.kind}: ${formatCents(item.cents)}, ${formatDay(item.due)}`}
                      data-testid="vendor-bar"
                      data-role={item.vendorRole}
                      data-kind={item.kind}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </div>
      </CardBody>
    </Card>
  );
}
