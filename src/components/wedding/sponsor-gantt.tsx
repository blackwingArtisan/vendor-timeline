"use client";

/**
 * Bryntum Gantt: each vendor is a row with its deposit and balance bars under it. Reached only
 * through the next/dynamic in payment-chart.tsx, and only when the sponsor switch is on.
 *
 * cacheComponents hides routes with <Activity>, so leaving the page destroys this widget and it is
 * rebuilt from props on return. A drag therefore goes straight to the server, and the bars always
 * come from the server's timeline. Config sits outside the component so re-renders don't touch it.
 */
import { useCallback, useMemo, useRef, useState } from "react";
import { TaskModel } from "@bryntum/gantt";
import { BryntumGantt, BryntumGanttProjectModel, type BryntumGanttProps } from "@bryntum/gantt-react";
import "@bryntum/gantt/fontawesome/css/fontawesome.css";
import "@bryntum/gantt/fontawesome/css/solid.css";
import "@bryntum/gantt/gantt.css";
import "@bryntum/gantt/svalbard-light.css";
import { Card, CardBody, CardHeader } from "@/components/ui";
import { formatCents } from "@/lib/wedding/cents";
import { addDays } from "@/lib/wedding/dates";
import type { ItemStatus, TimelineItem } from "@/lib/wedding/types";
import type { PaymentChartProps } from "./payment-chart";

const BAR_DAYS = 7;
const ROW_HEIGHT = 40;
const HEADER_HEIGHT = 92;
const COLOR: Partial<Record<ItemStatus, string>> = { paid: "green", overdue: "red", sending: "blue", awaiting_approval: "amber" };

const GANTT_CONFIG: BryntumGanttProps = {
  // Month columns so the whole wedding fits on one screen; bars still move a day at a time.
  viewPreset: { base: "monthAndYear", tickWidth: 72, timeResolution: { unit: "day", increment: 1 } },
  rowHeight: ROW_HEIGHT,
  barMargin: 8,
  snap: true,
  columns: [
    { type: "name", text: "Vendor", width: 240 },
    { type: "date", text: "Due", field: "startDate", format: "MMM D, YYYY", width: 130 },
  ],
  // Bars move in time and nothing else: amounts and links stay out of the chart's reach.
  cellEditFeature: false,
  taskEditFeature: false,
  taskResizeFeature: false,
  taskMenuFeature: false,
  cellMenuFeature: false,
  headerMenuFeature: false,
  percentBarFeature: false,
  dependenciesFeature: false,
  dependencyEditFeature: false,
  projectLinesFeature: false,
  timeRangesFeature: { showCurrentTimeLine: true },
};

const canMove = (item: TimelineItem) => item.status === "upcoming" || item.status === "overdue" || item.status === "due_today";

/** Dates stay calendar days: the widget works in local time, so read them back in local time. */
function ymd(date: Date) {
  return date.toLocaleDateString("en-CA");
}

function toTasks(items: TimelineItem[]) {
  const vendors = new Map<string, TimelineItem[]>();
  for (const item of items) vendors.set(item.contractId, [...(vendors.get(item.contractId) ?? []), item]);
  return [...vendors.entries()].map(([contractId, payments]) => ({
    id: contractId,
    name: payments[0].vendorName,
    expanded: true,
    readOnly: true,
    children: payments.map((item) => ({
      id: item.id,
      name: `${item.kind === "deposit" ? "Deposit" : "Balance"} ${formatCents(item.cents)}`,
      startDate: item.due,
      endDate: addDays(item.due, BAR_DAYS),
      eventColor: COLOR[item.status] ?? (item.kind === "deposit" ? "violet" : "indigo"),
      readOnly: !canMove(item),
    })),
  }));
}

export default function SponsorGantt({ view, onMove }: PaymentChartProps) {
  const projectRef = useRef<BryntumGanttProjectModel>(null);
  const [lastMove, setLastMove] = useState("Drag a bar to move a payment.");
  // A poll with the same dates must not reload the widget, or it would drop a drag in progress.
  const serialized = JSON.stringify(toTasks(view.items));
  const tasks = useMemo(() => JSON.parse(serialized) as ReturnType<typeof toTasks>, [serialized]);
  const dates = [view.today, ...view.items.map((i) => i.due)].sort();
  const [startDate, endDate] = [addDays(dates[0], -14), addDays(dates.at(-1)!, 28)];
  const rows = tasks.length + view.items.length;

  const items = view.items;
  const onTaskDrop = useCallback(
    (event: { taskRecords: TaskModel[]; valid?: boolean }) => {
      const task = event.taskRecords[0];
      const item = items.find((i) => i.id === task.id);
      if (!item || event.valid === false) return;
      const due = ymd(task.startDate as Date);
      setLastMove(`${item.vendorName} ${item.kind} moved to ${due}`);
      onMove(item, due);
    },
    [items, onMove],
  );

  return (
    <Card className="mb-6" data-testid="sponsor-gantt">
      <CardHeader title="Payment Gantt" description={<span data-testid="gantt-last-move">{lastMove}</span>} />
      <CardBody className="p-0">
        <div data-testid="gantt-host" style={{ height: HEADER_HEIGHT + rows * ROW_HEIGHT }}>
          <BryntumGanttProjectModel ref={projectRef} autoSetConstraints tasks={tasks} />
          <BryntumGantt {...GANTT_CONFIG} startDate={startDate} endDate={endDate} project={projectRef} onTaskDrop={onTaskDrop} />
        </div>
      </CardBody>
      <p className="border-t border-zinc-100 px-5 py-2 text-xs text-zinc-500" data-testid="sponsor-notice">
        Portions of this software are copyright 2015-{new Date().getFullYear()} by Bryntum AB
      </p>
    </Card>
  );
}
