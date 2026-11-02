"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CalendarDays, CircleCheck, FileText, Send, Wallet } from "lucide-react";
import { ToolCallTimeline } from "@/components/agent/tool-call-timeline";
import { useKit } from "@/components/kit/kit-provider";
import { useTimeline } from "@/components/kit/use-timeline";
import { PageHeader } from "@/components/shell/app-shell";
import { useToast } from "@/components/toast";
import { Badge, Button, ButtonLink, Card, CardBody, CardHeader, EmptyState, Input, SkeletonCard, Stat, type Tone } from "@/components/ui";
import { formatCents, sumCents } from "@/lib/wedding/cents";
import { formatDay, formatMonth, localToday } from "@/lib/wedding/dates";
import { payLabel } from "@/lib/wedding/timeline";
import type { ItemStatus, TimelineItem, TimelineView } from "@/lib/wedding/types";
import { AgentPanel } from "./agent-panel";
import { CashCard } from "./cash-card";
import { PayApproval } from "./pay-approval";
import { PaymentChart } from "./payment-chart";

const STATUS: Record<ItemStatus, { label: string; tone: Tone; dot: string }> = {
  paid: { label: "Paid", tone: "success", dot: "bg-emerald-500" },
  sending: { label: "Sending", tone: "info", dot: "bg-sky-500" },
  awaiting_approval: { label: "Waiting for your approval", tone: "warning", dot: "bg-amber-500" },
  overdue: { label: "Overdue", tone: "danger", dot: "bg-red-500" },
  due_today: { label: "Due today", tone: "warning", dot: "bg-amber-500" },
  upcoming: { label: "Upcoming", tone: "neutral", dot: "bg-zinc-300" },
};

function whenLabel(item: TimelineItem) {
  if (item.status === "paid") return null;
  if (item.daysUntil < 0) return item.daysUntil === -1 ? "1 day overdue" : `${-item.daysUntil} days overdue`;
  if (item.daysUntil === 0) return "due today";
  return item.daysUntil === 1 ? "in 1 day" : `in ${item.daysUntil} days`;
}

const itemName = (item: TimelineItem) => `${item.vendorName} ${item.kind}`;

function PayPalProof({ item, standIn }: { item: TimelineItem; standIn: boolean }) {
  const p = item.payment;
  if (!p?.batchId) return null;
  return (
    <div className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600" data-testid="paypal-proof">
      <p>
        PayPal status: <span className="font-semibold text-zinc-900" data-testid="paypal-status">{p.itemStatus ?? p.batchStatus}</span>
      </p>
      <p className="mt-0.5 break-all">
        Batch <span className="font-mono" data-testid="paypal-batch-id">{p.batchId}</span>
        {p.transactionId ? (
          <>
            {" · "}Transaction <span className="font-mono" data-testid="paypal-transaction-id">{p.transactionId}</span>
          </>
        ) : null}
      </p>
      {p.paidBy === "webhook" ? (
        <p className="mt-0.5" data-testid="paid-by">
          Confirmed by PayPal webhook <span className="break-all font-mono" data-testid="paid-by-event">{p.webhook?.eventId}</span>
        </p>
      ) : null}
      {p.paidBy === "re-read" ? <p className="mt-0.5" data-testid="paid-by">Confirmed by re-reading PayPal. No webhook reached this copy of the app.</p> : null}
      {p.itemStatus === "UNCLAIMED" ? <p className="mt-0.5">PayPal is holding this until the vendor claims it.</p> : null}
      {standIn ? <p className="mt-0.5 text-zinc-500">Sandbox: sent to a PayPal test account standing in for this fictional vendor.</p> : null}
    </div>
  );
}

/** The free way to move a date, so the public copy can do what the chart's drag does. */
function MoveDate({ item, onMove }: { item: TimelineItem; onMove: (item: TimelineItem, due: string) => void }) {
  const [open, setOpen] = useState(false);
  const [due, setDue] = useState(item.due);
  if (!open) {
    return (
      <button type="button" className="inline-flex items-center gap-1 text-xs text-zinc-500 hover:text-zinc-900" onClick={() => setOpen(true)} data-testid="move-date">
        <CalendarDays className="size-3.5" /> Change date
      </button>
    );
  }
  return (
    <form
      className="flex items-center gap-1"
      onSubmit={(e) => {
        e.preventDefault();
        if (due) onMove(item, due);
        setOpen(false);
      }}
    >
      <Input type="date" aria-label={`New date for the ${item.vendorName} ${item.kind}`} className="h-8 w-36 text-xs" value={due} onChange={(e) => setDue(e.target.value)} data-testid="move-date-input" />
      <Button type="submit" size="sm" variant="secondary" data-testid="move-date-save">Save</Button>
    </form>
  );
}

function Row({ item, view, onPay, onMove, busy, onDecided, agentRunId }: { item: TimelineItem; view: TimelineView; onPay: (item: TimelineItem) => void; onMove: (item: TimelineItem, due: string) => void; busy: boolean; onDecided: () => void; agentRunId: string | null }) {
  const status = STATUS[item.status];
  const isNext = view.nextDue?.id === item.id;
  const canPay = item.status === "overdue" || item.status === "due_today" || item.status === "upcoming";
  // The agent's panel shows the approval for its own run, up where the couple are reading.
  const approval = item.payment?.runId === agentRunId ? null : item.approval;
  const when = whenLabel(item);
  return (
    <li className="relative pb-4 pl-7 last:pb-0" data-testid="timeline-item" data-role={item.vendorRole} data-kind={item.kind} data-status={item.status}>
      <span className={`absolute left-0 top-5 size-3.5 rounded-full ring-4 ring-background ${status.dot}`} aria-hidden />
      <div className={`rounded-xl border bg-white px-4 py-3 shadow-[0_1px_2px_rgba(0,0,0,0.04)] ${item.status === "overdue" ? "border-red-200" : isNext ? "border-brand-300" : "border-zinc-200/80"}`}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 sm:grid-cols-[minmax(0,1fr)_auto_10.5rem]">
          <div className="min-w-0">
            <p className="text-sm font-semibold text-zinc-900" data-testid="item-due">{formatDay(item.due)}</p>
            <p className="truncate text-sm text-zinc-600">
              {item.vendorName} <span className="text-zinc-400">·</span> {item.kind === "deposit" ? "Deposit" : "Balance"}
            </p>
            {item.movedFrom ? <p className="text-xs text-zinc-500" data-testid="item-moved">Contract says {formatDay(item.movedFrom)}</p> : null}
          </div>
          <div className="text-right">
            <p className="font-mono text-base font-semibold tabular-nums text-zinc-900" data-testid="item-amount">{formatCents(item.cents)}</p>
            {when ? <p className="text-xs text-zinc-500">{when}</p> : null}
          </div>
          <div className="col-span-2 flex flex-col gap-1.5 sm:col-span-1 sm:items-end">
            <div className="flex flex-wrap gap-1 sm:justify-end">
              {isNext ? <Badge tone="brand">Due next</Badge> : null}
              <span data-testid="item-status"><Badge tone={status.tone}>{status.label}</Badge></span>
            </div>
            {canPay ? (
              <Button size="sm" icon={<Send className="size-3.5" />} onClick={() => onPay(item)} loading={busy} disabled={busy} data-testid="pay-item">
                {payLabel(item.vendorRole)}
              </Button>
            ) : null}
            {canPay ? <MoveDate key={item.due} item={item} onMove={onMove} /> : null}
          </div>
        </div>
        {item.status === "awaiting_approval" && approval ? (
          <PayApproval className="mt-3" item={item} approval={approval} cash={view.cash} sandbox={view.sandboxStandIn} onDecided={onDecided} />
        ) : null}
        {item.status === "awaiting_approval" && !approval ? <p className="mt-2 text-sm text-zinc-500">{item.approval ? "Waiting for your approval in the agent panel." : "Working with PayPal."}</p> : null}
        {item.payment?.state === "failed" ? (
          <p className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="item-error">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {item.payment.error}
          </p>
        ) : null}
        <PayPalProof item={item} standIn={view.sandboxStandIn} />
      </div>
    </li>
  );
}

function TodayMarker({ day }: { day: string }) {
  return (
    <p className="relative mb-4 flex items-center pl-7 text-xs font-semibold text-brand" data-testid="today-marker">
      <span className="absolute left-0 size-3.5 rounded-full bg-brand ring-4 ring-background" aria-hidden />
      Today, {formatDay(day)}
    </p>
  );
}

function monthsOf(items: TimelineItem[]) {
  const months: { label: string; items: TimelineItem[] }[] = [];
  for (const item of items) {
    const label = formatMonth(item.due);
    const current = months.at(-1);
    if (current?.label === label) current.items.push(item);
    else months.push({ label, items: [item] });
  }
  return months;
}

export function TimelineScreen() {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const { steps } = useTimeline();
  const [view, setView] = useState<TimelineView | null>(null);
  const [paying, setPaying] = useState<string | null>(null);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [agentRunId, setAgentRunId] = useState<string | null>(null);
  const [agentRunning, setAgentRunning] = useState(false);

  const load = useCallback(() => kitFetch<TimelineView>(`/api/timeline?today=${localToday()}`), [kitFetch]);
  const refresh = useCallback(() => load().then(setView), [load]);

  useEffect(() => {
    load()
      .then(setView)
      .catch(() => undefined);
  }, [load]);

  // A payment waits on a person, then on PayPal, so follow it until it stops.
  const moving = agentRunning || view?.items.some((i) => i.status === "awaiting_approval" || i.status === "sending");
  useEffect(() => {
    if (!moving) return;
    const timer = setInterval(() => void refresh().catch(() => undefined), 1200);
    return () => clearInterval(timer);
  }, [moving, refresh]);

  async function pay(item: TimelineItem) {
    setPaying(item.id);
    try {
      await kitFetch(`/api/contracts/${item.contractId}/pay`, { json: { kind: item.kind } });
      await refresh();
    } catch (e) {
      toast({ title: "Could not start that payment", description: (e as Error).message, variant: "error" });
    } finally {
      setPaying(null);
    }
  }

  async function loadSamples() {
    setLoadingSamples(true);
    try {
      await kitFetch("/api/contracts/samples", { method: "POST" });
      await refresh();
    } catch (e) {
      toast({ title: "Could not load the samples", description: (e as Error).message, variant: "error" });
    } finally {
      setLoadingSamples(false);
    }
  }

  const move = useCallback(
    (item: TimelineItem, due: string) => {
      kitFetch(`/api/contracts/${item.contractId}/move`, { json: { kind: item.kind, due } })
        .catch((e) => toast({ title: "Could not move that date", description: (e as Error).message, variant: "error" }))
        .finally(() => void refresh().catch(() => undefined)); // On a refusal this puts the bar back.
    },
    [kitFetch, refresh, toast],
  );

  const activity = useMemo(() => steps.filter((s) => s.channel !== "global" || s.kind === "webhook").map((s) => (s.approval?.state === "pending" ? { ...s, approval: undefined } : s)), [steps]);

  if (!view) return <SkeletonCard />;

  const { items, nextDue, overdue } = view;
  const overdueCents = sumCents(overdue.map((i) => i.cents));
  const unpaidCount = items.filter((i) => i.status !== "paid").length;
  const firstUpcoming = items.findIndex((i) => i.daysUntil >= 0);
  const todayBefore = firstUpcoming > 0 ? items[firstUpcoming].id : undefined;

  return (
    <>
      <PageHeader title="Your timeline" description="Every vendor's deposit and balance, by date." actions={<ButtonLink href="/contracts" variant="secondary">Add a contract</ButtonLink>} />
      {items.length === 0 ? (
        <EmptyState
          icon={<FileText className="size-5" />}
          title="Nothing confirmed yet"
          description="Add a vendor contract and confirm its terms. Its deposit and balance will show up here."
          action={
            <div className="flex flex-wrap justify-center gap-2">
              <ButtonLink href="/contracts" size="sm">Add a contract</ButtonLink>
              <Button size="sm" variant="secondary" onClick={() => void loadSamples()} loading={loadingSamples} disabled={loadingSamples} data-testid="load-samples">
                Load the five sample contracts
              </Button>
            </div>
          }
        />
      ) : (
        <>
          <div className="mb-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <div data-testid="stat-next">
              <Stat label="Due next" icon={<CalendarClock className="size-4" />} value={nextDue ? formatCents(nextDue.cents) : "Nothing"} hint={nextDue ? `${itemName(nextDue)}, ${formatDay(nextDue.due)}` : "No upcoming payments"} />
            </div>
            <div data-testid="stat-total">
              <Stat label="Total due" icon={<Wallet className="size-4" />} value={formatCents(view.totalDueCents)} hint={unpaidCount === 1 ? "1 payment left" : `${unpaidCount} payments left`} />
            </div>
            <div data-testid="stat-overdue">
              <Stat label="Overdue" icon={<AlertTriangle className="size-4" />} value={formatCents(overdueCents)} hint={overdue.length ? overdue.map(itemName).join(", ") : "Nothing overdue"} className={overdue.length ? "border-red-200 bg-red-50/40" : undefined} />
            </div>
            <div data-testid="stat-paid">
              <Stat label="Paid" icon={<CircleCheck className="size-4" />} value={formatCents(view.paidCents)} hint={`of ${formatCents(view.contractedCents)} in contracts`} />
            </div>
          </div>
          <div className="mb-6 grid items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <AgentPanel steps={steps} items={items} cash={view.cash} sandbox={view.sandboxStandIn} onRun={setAgentRunId} onRunning={setAgentRunning} onDecided={() => void refresh().catch(() => undefined)} />
            <CashCard key={view.cash.monthlyBudgetCents} cash={view.cash} onChanged={() => void refresh().catch(() => undefined)} />
          </div>
          <PaymentChart view={view} onMove={move} />
          <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)]">
            <div className="relative" data-testid="vendor-timeline">
              <span className="absolute bottom-3 left-[6px] top-3 w-px bg-zinc-200" aria-hidden />
              {monthsOf(items).map((month) => (
                <section key={month.label} className="mb-5 last:mb-0">
                  {month.items[0].id === todayBefore ? <TodayMarker day={view.today} /> : null}
                  <h2 className="relative mb-3 pl-7 text-xs font-semibold uppercase tracking-wider text-zinc-500">{month.label}</h2>
                  <ol>
                    {month.items.map((item, index) => (
                      <Fragment key={item.id}>
                        {index > 0 && item.id === todayBefore ? <TodayMarker day={view.today} /> : null}
                        <Row item={item} view={view} onPay={pay} onMove={move} busy={paying === item.id} onDecided={() => void refresh().catch(() => undefined)} agentRunId={agentRunId} />
                      </Fragment>
                    ))}
                  </ol>
                </section>
              ))}
            </div>
            <Card className="xl:sticky xl:top-6">
              <CardHeader title="What's happening" description="Each AI read, approval and PayPal call." />
              <CardBody>
                <ToolCallTimeline steps={activity} className="max-h-[620px]" emptyTitle="Nothing yet" emptyDescription="Pay a vendor to see each step here." />
              </CardBody>
            </Card>
          </div>
        </>
      )}
    </>
  );
}
