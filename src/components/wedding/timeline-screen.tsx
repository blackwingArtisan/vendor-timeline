"use client";

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CalendarClock, CalendarDays, CircleCheck, FileText, ReceiptText, Send, Wallet } from "lucide-react";
import { ToolCallTimeline } from "@/components/agent/tool-call-timeline";
import { useKit } from "@/components/kit/kit-provider";
import { useTimeline } from "@/components/kit/use-timeline";
import { useToast } from "@/components/toast";
import { Badge, Button, ButtonLink, Card, EmptyState, Input, type Tone } from "@/components/ui";
import { formatCents, sumCents } from "@/lib/wedding/cents";
import { formatDay, localToday } from "@/lib/wedding/dates";
import { dayProblem, moveDayRange } from "@/lib/wedding/limits";
import { payLabel } from "@/lib/wedding/timeline";
import type { CashMove, ItemStatus, TimelineItem, TimelineView } from "@/lib/wedding/types";
import { AgentPanel } from "./agent-panel";
import { CashCard } from "./cash-card";
import { CashPlanMoves } from "./cash-plan";
import { PageLoading } from "./page-loading";
import { PayApproval } from "./pay-approval";
import { PayPalCheckout, StandInLine } from "./paypal-checkout";
import { SamplePlanBanner } from "@/components/wedding/sample-plan-banner";
import { PaymentChart, SPONSOR_UI } from "./payment-chart";
import { ReceiptView } from "./receipt-view";
import { AxisHeader, axisFor, VendorBar, type Axis } from "./vendor-bars";

const STATUS: Record<ItemStatus, { label: string; tone: Tone; dot: string }> = {
  paid: { label: "Paid", tone: "success", dot: "bg-emerald-500" },
  sending: { label: "Confirming with PayPal", tone: "info", dot: "bg-sky-500" },
  awaiting_checkout: { label: "Approved: pay in PayPal", tone: "info", dot: "bg-sky-500" },
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

/** PayPal's own record of the payment: its order, its capture, and what confirmed it. */
function PayPalProof({ item, standIn }: { item: TimelineItem; standIn: boolean }) {
  const p = item.payment;
  if (!p?.captureId) return null;
  return (
    <div className="mt-2 rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600" data-testid="paypal-proof">
      <p>
        PayPal capture status: <span className="font-semibold text-zinc-900" data-testid="paypal-status">{p.captureStatus ?? p.orderStatus}</span>
      </p>
      <p className="mt-0.5 break-all">
        Capture <span className="font-mono" data-testid="paypal-capture-id">{p.captureId}</span>
        {" · "}Order <span className="font-mono" data-testid="paypal-order-id">{p.orderId}</span>
        {" · "}Paid to <span data-testid="paypal-payee">{p.payee}</span>
      </p>
      {p.paidBy === "webhook" ? (
        <p className="mt-0.5" data-testid="paid-by">
          Confirmed by PayPal webhook <span className="break-all font-mono" data-testid="paid-by-event">{p.webhook?.eventId}</span> for this capture
        </p>
      ) : null}
      {p.method === "saved" ? <p className="mt-0.5" data-testid="paid-saved">Charged to your saved PayPal with one approval, no checkout window.</p> : null}
      {p.paidBy === "re-read" ? <p className="mt-0.5" data-testid="paid-by">Confirmed by re-reading the capture from PayPal. PayPal can&apos;t send webhooks to this copy of the app.</p> : null}
      {standIn ? <StandInLine item={item} className="mt-0.5 text-zinc-500" /> : null}
    </div>
  );
}

/** The free way to move a date, so the public copy can do what the chart's drag does. */
function MoveDateForm({ item, onMove, onClose }: { item: TimelineItem; onMove: (item: TimelineItem, due: string) => void; onClose: () => void }) {
  const [due, setDue] = useState(item.due);
  const [tried, setTried] = useState(false);
  // From today to a year after the wedding: the same rule the server holds to.
  const range = moveDayRange(localToday(), item.weddingDay);
  const problem = dayProblem(due, "The new date", range);
  return (
    <form
      // The app says what's wrong in its own words, rather than the browser's bubble.
      noValidate
      className="mt-2 flex flex-wrap items-center justify-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setTried(true);
        if (problem) return;
        onMove(item, due);
        onClose();
      }}
    >
      {tried && problem ? <span className="text-xs text-red-700" role="alert" data-testid="move-date-error">{problem}</span> : null}
      <span className="text-xs text-zinc-500">New date</span>
      <Input type="date" min={range.from} max={range.to} aria-label={`New date for the ${item.vendorName} ${item.kind}`} aria-invalid={tried && !!problem} className="h-8 w-36 text-xs" value={due} onChange={(e) => setDue(e.target.value)} data-testid="move-date-input" />
      <Button type="submit" size="sm" variant="secondary" data-testid="move-date-save">Save</Button>
      <Button type="button" size="sm" variant="ghost" onClick={onClose}>Cancel</Button>
    </form>
  );
}

/**
 * One payment, one line of the table: date, vendor, amount, its bar on the shared axis, status and
 * actions. Approvals, checkout and PayPal's record open underneath it.
 */
function Row({ item, view, axis, onPay, onMove, busy, onDecided, panelRuns }: { item: TimelineItem; view: TimelineView; axis: Axis | null; onPay: (item: TimelineItem) => void; onMove: (item: TimelineItem, due: string) => void; busy: boolean; onDecided: () => void; panelRuns: string[] }) {
  const [moving, setMoving] = useState(false);
  const [receipt, setReceipt] = useState(false);
  const status = STATUS[item.status];
  const isNext = view.nextDue?.id === item.id;
  // The most urgent payment is tagged, overdue or not. One tag at most, beside its status.
  const isFirst = view.payFirst?.id === item.id;
  const tag = isFirst ? "Pay first" : isNext ? "Due next" : null;
  const canPay = item.status === "overdue" || item.status === "due_today" || item.status === "upcoming";
  // The agent's panel shows the approval for its own run and its cash plan, up where the couple are reading.
  const ownedByAgent = !!item.payment && panelRuns.includes(item.payment.runId);
  const approval = ownedByAgent ? null : item.approval;
  const when = whenLabel(item);
  const cols = axis ? "xl:grid-cols-[8.75rem_minmax(0,12rem)_5.75rem_minmax(0,1fr)_9.5rem_11rem]" : "xl:grid-cols-[8.75rem_minmax(0,1fr)_5.75rem_9.5rem_11rem]";
  return (
    <li className={`border-b border-zinc-100 px-4 py-1.5 last:border-b-0 ${isFirst ? "bg-brand-50/50" : item.status === "overdue" ? "bg-red-50/40" : ""}`} data-testid="timeline-item" data-role={item.vendorRole} data-kind={item.kind} data-status={item.status}>
      <div className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 md:grid-cols-[8.75rem_minmax(0,1fr)_5.75rem_auto] ${cols}`}>
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm font-medium text-zinc-900">
            <span className={`size-2 shrink-0 rounded-full ${status.dot}`} aria-hidden />
            <span data-testid="item-due">{formatDay(item.due)}</span>
          </p>
          {when ? <p className="pl-3.5 text-xs text-zinc-500">{when}</p> : null}
        </div>
        <div className="order-3 col-span-2 min-w-0 md:order-none md:col-span-1">
          {/* On a phone the vendor's name gives way, never the deposit or balance. */}
          <p className="flex min-w-0 text-sm text-zinc-700" data-testid="item-name">
            <span className="truncate">{item.vendorName}</span>
            <span className="shrink-0">
              <span className="px-1 text-zinc-400">·</span>
              {item.kind === "deposit" ? "Deposit" : "Balance"}
            </span>
          </p>
          {item.movedFrom ? <p className="text-xs text-zinc-500" data-testid="item-moved">Contract says {formatDay(item.movedFrom)}</p> : null}
        </div>
        <p className="text-right font-mono text-sm font-semibold tabular-nums text-zinc-900" data-testid="item-amount">{formatCents(item.cents)}</p>
        {axis ? <div className="hidden xl:block"><VendorBar item={item} axis={axis} today={view.today} /></div> : null}
        <div className="order-4 flex flex-wrap gap-1 md:order-none xl:justify-start">
          {tag ? <span data-testid="item-tag"><Badge tone="brand">{tag}</Badge></span> : null}
          {/* "Upcoming" says nothing a tag doesn't, so a tagged row shows the tag alone. */}
          <span data-testid="item-status" className={tag && item.status === "upcoming" ? "sr-only" : undefined}><Badge tone={status.tone}>{status.label}</Badge></span>
        </div>
        <div className="order-5 flex items-center justify-end gap-1 md:order-none">
          {canPay ? (
            <>
              <Button size="sm" variant="ghost" className="px-2" icon={<CalendarDays className="size-3.5" />} onClick={() => setMoving((m) => !m)} aria-label={`Change the date of the ${item.vendorName} ${item.kind}`} title="Change date" data-testid="move-date">
                <span className="sr-only">Change date</span>
              </Button>
              <Button size="sm" icon={<Send className="size-3.5" />} onClick={() => onPay(item)} loading={busy} disabled={busy} data-testid="pay-item">
                {payLabel(item.vendorRole)}
              </Button>
            </>
          ) : null}
          {item.status === "paid" && item.payment?.captureId ? (
            <Button size="sm" variant="secondary" icon={<ReceiptText className="size-3.5" />} onClick={() => setReceipt((r) => !r)} aria-expanded={receipt} data-testid="receipt-open">
              Receipt
            </Button>
          ) : null}
        </div>
      </div>
      {canPay && moving ? <MoveDateForm key={item.due} item={item} onMove={onMove} onClose={() => setMoving(false)} /> : null}
      {item.status === "awaiting_approval" && approval ? (
        <PayApproval className="mt-2" item={item} approval={approval} cash={view.cash} sandbox={view.sandboxStandIn} wallet={view.wallet} onDecided={onDecided} />
      ) : null}
      {item.status === "awaiting_approval" && !approval ? <p className="mt-1 text-xs text-zinc-500">{item.approval ? "Waiting for your approval in the agent panel." : "Working with PayPal."}</p> : null}
      {item.status === "awaiting_checkout" && !ownedByAgent ? <PayPalCheckout className="mt-2" item={item} sandbox={view.sandboxStandIn} onPaid={onDecided} /> : null}
      {item.status === "awaiting_checkout" && ownedByAgent ? <p className="mt-1 text-xs text-zinc-500">Pay it from the agent panel above.</p> : null}
      {item.payment?.state === "failed" ? (
        <p className="mt-2 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800" data-testid="item-error">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {item.payment.error}
        </p>
      ) : null}
      <PayPalProof item={item} standIn={view.sandboxStandIn} />
      {receipt && item.status === "paid" ? <ReceiptView item={item} onClose={() => setReceipt(false)} /> : null}
    </li>
  );
}

function TodayMarker({ day }: { day: string }) {
  return (
    <li className="flex items-center gap-2 border-b border-zinc-100 bg-brand-50/30 px-4 py-1 text-xs font-semibold text-brand" data-testid="today-marker">
      <span className="h-px w-4 bg-brand" aria-hidden />
      Today, {formatDay(day)}
    </li>
  );
}

function StatTile({ label, icon, value, hint, testId, className }: { label: string; icon: ReactNode; value: string; hint: string; testId: string; className?: string }) {
  return (
    <div className={`min-w-0 rounded-xl border border-zinc-200/80 bg-white px-3 py-2 ${className ?? ""}`} data-testid={testId}>
      <p className="flex items-center justify-between text-xs text-zinc-500">
        {label}
        <span className="text-zinc-400">{icon}</span>
      </p>
      <p className="mt-0.5 text-lg font-semibold tracking-tight tabular-nums text-zinc-900">{value}</p>
      <p className="truncate text-xs text-zinc-500" title={hint}>{hint}</p>
    </div>
  );
}

/** The last timeline this tab loaded, so coming back to the page shows it at once while it refreshes. */
let lastView: TimelineView | null = null;

function TimelineHeader() {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-zinc-900">Your timeline</h1>
      </div>
      <ButtonLink href="/contracts" variant="secondary" size="sm">Add a contract</ButtonLink>
    </div>
  );
}

export function TimelineScreen() {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  // This tab's own steps plus this couple's webhooks (their plan channel). No one else's events.
  const { steps } = useTimeline({ includeGlobal: false });
  const [view, setView] = useState<TimelineView | null>(lastView);
  const [paying, setPaying] = useState<string | null>(null);
  const [loadingSamples, setLoadingSamples] = useState(false);
  const [agentRun, setAgentRun] = useState<string | null>(null);
  // Code's cash plan shows once the agent has given it. Moves the couple started stay on screen,
  // with the payments they started, even after the plan moves on.
  const [planned, setPlanned] = useState(false);
  const [planStarted, setPlanStarted] = useState<CashMove[]>([]);
  const [planRuns, setPlanRuns] = useState<string[]>([]);
  const panelRuns = useMemo(() => [...(agentRun ? [agentRun] : []), ...planRuns], [agentRun, planRuns]);
  const [agentRunning, setAgentRunning] = useState(false);
  const [capturing, setCapturing] = useState(false);

  const load = useCallback(() => kitFetch<TimelineView>(`/api/timeline?today=${localToday()}`), [kitFetch]);
  const refresh = useCallback(() => load().then(setView), [load]);
  useEffect(() => {
    lastView = view;
  }, [view]);

  useEffect(() => {
    load()
      .then(setView)
      .catch(() => undefined);
  }, [load]);

  // A payment waits on a person, then on PayPal, so follow it until it stops.
  const moving = agentRunning || capturing || view?.items.some((i) => i.status === "awaiting_approval" || i.status === "sending");
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

  // PayPal sends the couple back here from its checkout. Capture that order, then tidy the address.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const back = params.get("checkout");
    const cancelled = params.get("cancelled");
    const orderId = params.get("token");
    if (!back && !cancelled) return;
    window.history.replaceState(null, "", "/timeline");
    if (cancelled) {
      toast({ title: "PayPal checkout cancelled", description: "Nothing was paid. You can pay it from the timeline whenever you're ready." });
      return;
    }
    const [contractId, kind] = back!.split(".");
    if (!orderId || !contractId || (kind !== "deposit" && kind !== "balance")) {
      toast({ title: "Nothing was paid", description: "That link back from PayPal is missing its order, so nothing was taken. Pay from the timeline to open PayPal's checkout again.", variant: "error" });
      return;
    }
    void (async () => {
      setCapturing(true);
      try {
        await kitFetch(`/api/contracts/${contractId}/capture`, { json: { kind, orderId } });
      } catch (e) {
        toast({ title: "PayPal didn't take that payment", description: (e as Error).message, variant: "error" });
      } finally {
        setCapturing(false);
        await refresh().catch(() => undefined);
      }
    })();
  }, [kitFetch, refresh, toast]);

  const move = useCallback(
    (item: TimelineItem, due: string) => {
      kitFetch(`/api/contracts/${item.contractId}/move`, { json: { kind: item.kind, due, today: localToday() } })
        .catch((e) => toast({ title: "Could not move that date", description: (e as Error).message, variant: "error" }))
        .finally(() => void refresh().catch(() => undefined)); // On a refusal this puts the bar back.
    },
    [kitFetch, refresh, toast],
  );

  const activity = useMemo(() => steps.map((s) => (s.approval?.state === "pending" ? { ...s, approval: undefined } : s)), [steps]);

  if (!view) return <PageLoading title="Your timeline" doing="Reading your confirmed contracts and checking each payment with PayPal…" testId="timeline-loading" />;

  const { items, nextDue, overdue } = view;
  const overdueCents = sumCents(overdue.map((i) => i.cents));
  const unpaidCount = items.filter((i) => i.status !== "paid").length;
  const firstUpcoming = items.findIndex((i) => i.daysUntil >= 0);
  const todayBefore = firstUpcoming > 0 ? items[firstUpcoming].id : undefined;
  const axis = SPONSOR_UI || !items.length ? null : axisFor(view);
  const cols = axis ? "xl:grid-cols-[8.75rem_minmax(0,12rem)_5.75rem_minmax(0,1fr)_9.5rem_11rem]" : "xl:grid-cols-[8.75rem_minmax(0,1fr)_5.75rem_9.5rem_11rem]";

  return (
    <>
      <TimelineHeader />
      {view.samplePlan ? <SamplePlanBanner className="mb-4" /> : null}
      {capturing ? <p className="mb-4 rounded-lg bg-sky-50 px-4 py-3 text-sm text-sky-900" data-testid="capturing">Back from PayPal. Capturing your payment and reading it back from PayPal…</p> : null}
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
          <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
            <StatTile testId="stat-next" label="Due next" icon={<CalendarClock className="size-3.5" />} value={nextDue ? formatCents(nextDue.cents) : "Nothing"} hint={nextDue ? `${itemName(nextDue)}, ${formatDay(nextDue.due)}` : "No upcoming payments"} />
            <StatTile testId="stat-total" label="Total due" icon={<Wallet className="size-3.5" />} value={formatCents(view.totalDueCents)} hint={unpaidCount === 1 ? "1 payment left" : `${unpaidCount} payments left`} />
            <StatTile testId="stat-overdue" label="Overdue" icon={<AlertTriangle className="size-3.5" />} value={formatCents(overdueCents)} hint={overdue.length ? overdue.map(itemName).join(", ") : "Nothing overdue"} className={overdue.length ? "border-red-200 bg-red-50/40" : undefined} />
            <StatTile testId="stat-paid" label="Paid" icon={<CircleCheck className="size-3.5" />} value={formatCents(view.paidCents)} hint={`of ${formatCents(view.contractedCents)} in contracts`} />
          </div>
          <div className="mb-4 grid items-start gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
            <AgentPanel steps={steps} items={items} cash={view.cash} fix={view.cashFix} sandbox={view.sandboxStandIn} wallet={view.wallet} onRun={setAgentRun} onPlanned={setPlanned} onRunning={setAgentRunning} onDecided={() => void refresh().catch(() => undefined)} />
            <div className="grid gap-4">
              <CashCard key={view.cash.monthlyBudgetCents} cash={view.cash} onChanged={() => void refresh().catch(() => undefined)} />
              {planned || planStarted.length ? (
                <CashPlanMoves
                  fix={view.cashFix}
                  started={planStarted}
                  items={items}
                  cash={view.cash}
                  sandbox={view.sandboxStandIn}
                  onStarted={(m, paymentRun) => {
                    setPlanStarted((moves) => [...moves.filter((s) => s.itemId !== m.itemId), m]);
                    if (paymentRun) setPlanRuns((runs) => [...runs, paymentRun]);
                  }}
                  onDone={() => void refresh().catch(() => undefined)}
                />
              ) : null}
            </div>
          </div>
          <PaymentChart view={view} onMove={move} />
          <Card className="mb-4 overflow-hidden" data-testid="vendor-timeline">
            <div className={`hidden items-end gap-x-3 border-b border-zinc-100 bg-zinc-50/60 px-4 py-2 text-xs font-medium text-zinc-500 md:grid md:grid-cols-[8.75rem_minmax(0,1fr)_5.75rem_auto] ${cols}`}>
              <span>Due</span>
              <span>Vendor</span>
              <span className="text-right">Amount</span>
              {axis ? <div className="hidden xl:block" data-testid="free-bars"><AxisHeader axis={axis} today={view.today} /></div> : null}
              <span className="hidden xl:block">Status</span>
              <span className="hidden xl:block" />
            </div>
            <ol>
              {items.map((item) => (
                <Fragment key={item.id}>
                  {item.id === todayBefore ? <TodayMarker day={view.today} /> : null}
                  <Row item={item} view={view} axis={axis} onPay={pay} onMove={move} busy={paying === item.id} onDecided={() => void refresh().catch(() => undefined)} panelRuns={panelRuns} />
                </Fragment>
              ))}
            </ol>
          </Card>
          <details className="group rounded-2xl border border-zinc-200/80 bg-white" data-testid="activity-panel">
            <summary className="cursor-pointer px-5 py-3 text-sm font-semibold text-zinc-900">
              What&apos;s happening <span className="font-normal text-zinc-500">: each AI read, approval and PayPal call ({activity.length} {activity.length === 1 ? "step" : "steps"})</span>
            </summary>
            <div className="border-t border-zinc-100 px-5 py-4">
              <ToolCallTimeline steps={activity} className="max-h-[420px]" emptyTitle="Nothing yet" emptyDescription="Pay a vendor to see each step here." />
            </div>
          </details>
        </>
      )}
    </>
  );
}
