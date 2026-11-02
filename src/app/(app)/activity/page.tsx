"use client";

import { useCallback, useEffect, useState, type ReactNode } from "react";
import { RefreshCw, ShieldCheck, ShieldX, Webhook } from "lucide-react";
import { useKit } from "@/components/kit/kit-provider";
import { PageHeader } from "@/components/shell/app-shell";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardBody, CardHeader, EmptyState } from "@/components/ui";
import type { AuditEntry } from "@/lib/agent/audit";
import { formatMoney } from "@/lib/money";
import type { WebhookEventEnvelope } from "@/lib/paypal/types";

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
  const { toast } = useToast();
  const [audit, setAudit] = useState<{ entries: AuditEntry[]; integrity: { ok: boolean; count: number; brokenAt?: number } } | null>(null);
  const [events, setEvents] = useState<WebhookEventEnvelope[] | null>(null);
  const isMock = status?.paypal.mode === "mock";

  const fetchAll = useCallback(async () => {
    const auditRes = await kitFetch<NonNullable<typeof audit>>("/api/audit");
    const eventsRes = isMock ? (await kitFetch<{ events: WebhookEventEnvelope[] }>("/api/dev/webhooks")).events.reverse() : null;
    return { auditRes, eventsRes };
  }, [kitFetch, isMock]);

  const load = useCallback(async () => {
    const { auditRes, eventsRes } = await fetchAll();
    setAudit(auditRes);
    setEvents(eventsRes);
  }, [fetchAll]);

  useEffect(() => {
    let cancelled = false;
    fetchAll()
      .then(({ auditRes, eventsRes }) => {
        if (cancelled) return;
        setAudit(auditRes);
        setEvents(eventsRes);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [fetchAll]);

  async function replay(eventId: string) {
    try {
      await kitFetch("/api/dev/webhooks/replay", { json: { eventId } });
      toast({ title: "Webhook replayed", description: eventId, variant: "success" });
    } catch (e) {
      toast({ title: "Replay failed", description: (e as Error).message, variant: "error" });
    }
  }

  return (
    <>
      <PageHeader title="Activity" description="Every payment request, approval and result, plus PayPal's webhooks." actions={<Button variant="secondary" icon={<RefreshCw className="size-4" />} onClick={load}>Refresh</Button>} />
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
            <Table head={["#", "Time", "Action", "Tool", "Amount", "Actor", "Reason"]}>
              {[...audit.entries].reverse().map((e) => (
                <tr key={e.seq} data-testid="audit-row">
                  <td className="px-2 py-2 tabular-nums">{e.seq}</td>
                  <td className="whitespace-nowrap px-2 py-2">{when(e.ts)}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-medium text-zinc-900">{e.action}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">{e.tool}</td>
                  <td className="whitespace-nowrap px-2 py-2 tabular-nums">{e.amount ? formatMoney(e.amount) : ""}</td>
                  <td className="px-2 py-2">{e.actor}</td>
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
        <CardHeader title="Webhooks" description={isMock ? "Events the mock PayPal emitted. Replay one to re-run the handlers." : "Events from PayPal's webhook appear on the timeline page."} />
        <CardBody>
          {isMock && events?.length ? (
            <Table head={["Time", "Event", "Summary", ""]}>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="whitespace-nowrap px-2 py-2">{when(e.create_time)}</td>
                  <td className="whitespace-nowrap px-2 py-2 font-mono text-xs">{e.event_type}</td>
                  <td className="px-2 py-2">{e.summary}</td>
                  <td className="px-2 py-2 text-right">
                    <Button size="sm" variant="ghost" onClick={() => replay(e.id)}>Replay</Button>
                  </td>
                </tr>
              ))}
            </Table>
          ) : (
            <EmptyState
              icon={<Webhook className="size-5" />}
              title={isMock ? "No webhook events yet" : "Sandbox webhooks"}
              description={isMock ? "Pay a vendor to see PayPal's events." : status?.paypal.webhookConfigured ? "PayPal's webhook is connected." : "PayPal's webhook isn't connected on this copy, so the app reads each payment's status from PayPal directly."}
            />
          )}
        </CardBody>
      </Card>
    </>
  );
}
