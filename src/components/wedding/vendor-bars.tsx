"use client";

/**
 * The free chart: no sponsor code. Each payment's bar sits in its own row of the payment table, on
 * one shared month axis, so the list and the bars read as one. A bar starts on its due date. Dates
 * move with each row's "Change date".
 */
import { formatCents } from "@/lib/wedding/cents";
import { daysBetween, formatDay, formatMonth } from "@/lib/wedding/dates";
import type { ItemStatus, TimelineItem, TimelineView } from "@/lib/wedding/types";

const BAR_DAYS = 7;

const BAR_COLOR: Record<TimelineItem["kind"], string> = { deposit: "bg-brand", balance: "bg-brand-300" };
const STATUS_COLOR: Partial<Record<ItemStatus, string>> = { paid: "bg-emerald-500", overdue: "bg-red-500", sending: "bg-sky-500", awaiting_approval: "bg-amber-500" };

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

export interface Axis {
  first: string;
  last: string;
  left: (day: string) => string;
  width: string;
}

/** One axis for every row: today to the last payment, plus a bar's width. */
export function axisFor(view: TimelineView): Axis {
  const dates = [view.today, ...view.items.map((i) => i.due)].sort();
  const [first, last] = [dates[0], dates.at(-1)!];
  const span = Math.max(daysBetween(first, last) + BAR_DAYS, 1);
  return { first, last, left: (day) => `${(daysBetween(first, day) / span) * 100}%`, width: `${(BAR_DAYS / span) * 100}%` };
}

/** Month names over the bar column. */
export function AxisHeader({ axis, today }: { axis: Axis; today: string }) {
  return (
    <div className="relative h-4" aria-hidden>
      {monthStarts(axis.first, axis.last).map((month) => (
        <span key={month} className="absolute top-0 pl-0.5 text-[10px] leading-none text-zinc-400" style={{ left: axis.left(month) }}>
          {formatMonth(month).split(" ")[0].slice(0, 3)}
        </span>
      ))}
      <span className="absolute -bottom-1 h-2 w-px bg-brand" style={{ left: axis.left(today) }} title={`Today, ${formatDay(today)}`} />
    </div>
  );
}

/** A payment's bar, in its row, with the month lines and today behind it. */
export function VendorBar({ item, axis, today }: { item: TimelineItem; axis: Axis; today: string }) {
  return (
    <div className="relative h-4 rounded-full bg-zinc-50">
      {monthStarts(axis.first, axis.last).map((month) => (
        <span key={month} className="absolute inset-y-0 border-l border-zinc-100" style={{ left: axis.left(month) }} aria-hidden />
      ))}
      <span className="absolute -inset-y-1 w-px bg-brand/50" style={{ left: axis.left(today) }} aria-hidden />
      <span
        className={`absolute inset-y-0.5 min-w-2 rounded transition-[left] duration-700 ease-out ${STATUS_COLOR[item.status] ?? BAR_COLOR[item.kind]}`}
        style={{ left: axis.left(item.due), width: axis.width }}
        title={`${item.vendorName} ${item.kind}: ${formatCents(item.cents)}, ${formatDay(item.due)}`}
        data-testid="vendor-bar"
        data-role={item.vendorRole}
        data-kind={item.kind}
      />
    </div>
  );
}
