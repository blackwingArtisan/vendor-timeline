"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { CalendarClock, RefreshCw, ShieldCheck, ShieldX, Webhook } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { PageHeader } from "@/components/shell/app-shell";
import { Badge, Button, ButtonLink, Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import type { AuditEntry } from "@/lib/agent/audit";
import { formatMoney } from "@/lib/money";
import { localToday } from "@/lib/wedding/dates";
import type { TimelineItem, TimelineView } from "@/lib/wedding/types";

/** Plain words for the log's own names. The raw name stays on hover, for anyone checking the chain. */
const ACTIONS: Record<string, string> = {
  "tool.requested": "Asked for",
  "tool.denied": "Refused by the app",
  "tool.failed": "Failed",
  "tool.replayed": "Repeated, not run again",
  "tool.executed": "Done",
  "approval.requested": "Waiting for your approval",
  "approval.approved": "You approved",
  "approval.denied": "You declined",
  "approval.expired": "Approval ran out",
};
const TOOLS: Record<string, string> = {
  create_vendor_order: "Pay a vendor",
  review_payments: "Read your payments",
};
const actorName = (actor: string) => (actor === "couple" || actor === "you" ? "You" : actor.startsWith("agent:") ? "Payment agent" : actor === "system" ? "The app" : actor);

const when = (iso: string) => new Date(iso).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

function Table({ head, children }: { head: string[]; children: ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-zinc-500">
          <tr>
            {head.map((h) => (
              <th key={h} className="whitespace-nowrap border-b border-zinc-200 px-2 py-2 font-medium">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 align-top text-zinc-700">{children}</tbody>
      </table>
    </div>
  );
}

export default function ActivityPage() {
  const { kitFetch, status } = useKit();
  const [audit, setAudit] = useState<{ entries: AuditEntry[]; integrity: { ok: boolean; count: number; brokenAt?: number } } | null>(null);
  const [events, setEvents] = useState<TimelineItem[] | null>(null);
  const [samplePlan, setSamplePlan] = useState(false);
  const webhookReady = status?.paypal.mode === "mock" || !!status?.paypal.webhookConfigured;

  const fetchAll = useCallback(async () => {
    const auditRes = await kitFetch<NonNullable<typeof audit>>("/api/audit");
    // This couple's own payments that PayPal's webhook has confirmed. No other app's or couple's events.
    const view = await kitFetch<TimelineView>(`/api/timeline?today=${localToday()}`);
    const eventsRes = view.items.filter((i) => i.payment?.webhook).sort((a, b) => b.payment!.webhook!.receivedAt.localeCompare(a.payment!.webhook!.receivedAt));
    return { auditRes, eventsRes, sample: !!view.samplePlan };
  }, [kitFetch]);

  const load = useCallback(async () => {
    const { auditRes, eventsRes, sample } = await fetchAll();
    setAudit(auditRes);
    setEvents(eventsRes);
    setSamplePlan(sample);
  }, [fetchAll]);

  useEffect(() => {
    let cancelled = false;
    fetchAll()
      .then(({ auditRes, eventsRes, sample }) => {
        if (cancelled) return;
        setAudit(auditRes);
        setEvents(eventsRes);
        setSamplePlan(sample);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fetchAll]);

  // Nothing asked for, approved or paid on this plan yet: one card that says so, not two empty ones.
  const nothingYet = !!audit && !!events && !audit.entries.length && !events.length;

  return (
    <>
      <PageHeader title="Activity" description="Every payment request, approval and result, plus PayPal's webhooks." actions={<Button variant="secondary" icon={<RefreshCw className="size-4" />} onClick={load}>Refresh</Button>} />
      {nothingYet ? (
        <Card data-testid="activity-empty">
          <CardBody>
            <EmptyState
              icon={<CalendarClock className="size-5" />}
              title={
                <span className="inline-flex flex-wrap items-center justify-center gap-2">
                  {samplePlan ? <span data-testid="activity-sample"><Badge tone="brand">Sample plan</Badge></span> : null}
                  Nothing asked for or paid on this plan yet
                </span>
              }
              description={`${samplePlan ? "The sample contracts are confirmed, and none of their payments has been asked for yet. " : ""}Ask the agent or pay a vendor from the timeline. Each request, your approval, the payment and PayPal's webhook for it then show here.`}
              action={<ButtonLink href="/timeline" size="sm" data-testid="activity-to-timeline">Go to the timeline</ButtonLink>}
            />
          </CardBody>
        </Card>
      ) : (
      <>
      <Card>
        <CardHeader
          title="Audit log"
          description="Hash-chained: editing any line breaks verification."
          action={
            audit ? (
              audit.integrity.ok ? (
                <Badge tone="success"><ShieldCheck className="size-3.5" /> Chain verified · {audit.integrity.count} entries</Badge>
              ) : (
                <Badge tone="danger"><ShieldX className="size-3.5" /> Broken at #{audit.integrity.brokenAt}</Badge>
              )
            ) : null
          }
        />
        <CardBody>
          {audit?.entries.length ? (
            <Table head={["#", "Time", "What happened", "Step", "Amount", "Who", "Why"]}>
              {[...audit.entries].reverse().map((e) => (
                <tr key={e.seq} data-testid="audit-row">
                  <td className="px-2 py-2 tabular-nums">{e.seq}</td>
                  <td className="whitespace-nowrap px-2 py-2">{when(e.ts)}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-medium text-zinc-900" title={e.action} data-testid="audit-action">{ACTIONS[e.action] ?? e.action}</td>
                  <td className="whitespace-nowrap px-2 py-2" title={e.tool} data-testid="audit-tool">{(e.tool && TOOLS[e.tool]) || e.tool}</td>
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums">{e.amount ? formatMoney(e.amount) : ""}</td>
                  <td className="px-2 py-2" title={e.actor}>{actorName(e.actor)}</td>
                  <td className="px-2 py-2">{e.reason}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState title="Nothing yet" description="Payment requests and approvals appear here." />
          )}
        </CardBody>
      </Card>

      <Card className="mt-6">
        <CardHeader title="Webhooks" description="PayPal's verified webhooks for your own payments. Other apps on the same PayPal sandbox never show here." />
        <CardBody>
          {events?.length ? (
            <Table head={["Received", "Event", "Payment", "Capture"]}>
              {events.map((i) => (
                <tr key={i.id} data-testid="webhook-row">
                  <td className="whitespace-nowrap px-2 py-2">{when(i.payment!.webhook!.receivedAt)}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">{i.payment!.webhook!.eventType}</td>
                  <td className="px-2 py-2">{`${i.vendorName} ${i.kind}`}</td>
                  <td className="px-2 py-2 font-mono text-xs">{i.payment!.webhook!.captureId}</td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState
              icon={<Webhook className="size-5" />}
              title="No webhooks for your payments yet"
              description={webhookReady ? "When you pay a vendor, PayPal's PAYMENT.CAPTURE.COMPLETED webhook for that payment shows here and on the timeline." : "PayPal's webhook isn't connected on this copy, so the app reads each payment's status from PayPal directly."}
            />
          )}
        </CardBody>
      </Card>
      </>
      )}
    </>
  );
}
