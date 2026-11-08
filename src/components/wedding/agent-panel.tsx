"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, Bot, Send, ShieldX } from "lucide-react";
import { PacedWait } from "@/components/wedding/paced-wait";
import { PayApproval } from "@/components/wedding/pay-approval";
import { PayPalCheckout } from "@/components/wedding/paypal-checkout";
import { usePaced, WaitStopped } from "@/components/wedding/use-paced";
import { ApiError, useKit } from "@/components/kit/kit-provider";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardBody, CardHeader, Input, type Tone } from "@/components/ui";
import type { TimelineStep } from "@/lib/events/types";
import { localToday } from "@/lib/wedding/dates";
import type { CashFix, CashPlan, TimelineItem } from "@/lib/wedding/types";
import { agentChain, firstSentences } from "@/lib/wedding/agent-chain";
import { VENDOR_ORDER_TOOL } from "@/lib/wedding/tool-names";
import { dollarsToCents, formatCents } from "@/lib/wedding/cents";
import { APP_MESSAGE_TITLES, CASH_PLAN_TITLE, PAY_FIRST_TITLE } from "@/lib/wedding/urgency";
import { plainText } from "@/lib/plain-text";

const DEFAULT_GOAL = "Tell me what's most urgent, warn me about any cash clashes, and set up that payment for my approval.";

type Phase = "idle" | "working" | "waiting" | "finished" | "failed";

const PHASE: Record<Exclude<Phase, "idle">, { label: string; tone: Tone }> = {
  working: { label: "Working", tone: "info" },
  waiting: { label: "Stopped for your approval", tone: "warning" },
  finished: { label: "Finished", tone: "success" },
  failed: { label: "Stopped", tone: "danger" },
};

function Message({ m, text, testId = "agent-message" }: { m: TimelineStep; text?: string; testId?: string }) {
  const fromApp = APP_MESSAGE_TITLES.includes(m.title);
  return (
    <li className={fromApp ? "whitespace-pre-line font-medium text-zinc-900" : "whitespace-pre-line"} data-testid={testId} data-from={fromApp ? "app" : "agent"}>
      {text ?? plainText(m.detail)}
    </li>
  );
}

/** The run so far, one short link per step, all written by code. */
function Chain({ links }: { links: string[] }) {
  return (
    <ol className="mt-2.5 flex flex-wrap items-center gap-x-0.5 gap-y-1 text-[11px] font-medium leading-4" data-testid="agent-chain" aria-label="What the agent has done">
      {links.map((link, i) => (
        <li key={link} className="inline-flex items-center gap-0.5">
          {i ? <ArrowRight className="size-3 text-zinc-400" aria-hidden /> : null}
          <span className={`whitespace-nowrap rounded-full py-0.5 ${i === links.length - 1 ? "bg-brand px-2 text-white" : "px-0.5 text-zinc-600"}`} data-testid="agent-chain-step">{link}</span>
        </li>
      ))}
    </ol>
  );
}

/** How a payment is named in the chain: by the vendor's role, or by name for "other". */
const paymentName = (i: TimelineItem) => `${i.vendorRole === "other" ? i.vendorName : i.vendorRole} ${i.kind}`;

/** The model's reply is two sentences at most. Code cuts it, whatever the model wrote. */
const REPLY_SENTENCES = 2;

/**
 * The agent names what's due, shows code's cash plan, and asks to pay. A person answers here, and
 * only then can money move. `onRun` tells the timeline which payment this panel shows, and
 * `onPlanned` that code's cash plan is out, for the cash card to show its moves.
 */
export function AgentPanel({ steps, items, cash, fix, sandbox, onRun, onPlanned, onRunning, onDecided }: { steps: TimelineStep[]; items: TimelineItem[]; cash: CashPlan; fix: CashFix | null; sandbox: boolean; onRun: (runId: string | null) => void; onPlanned: (planned: boolean) => void; onRunning: (running: boolean) => void; onDecided: () => void }) {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const { paced, waitSeconds, stopWaiting } = usePaced();
  const [blocked, setBlocked] = useState<string | null>(null);

  const runSteps = useMemo(() => steps.filter((s) => s.runId === runId), [steps, runId]);
  const said = runSteps.filter((s) => s.kind === "agent.message");
  // Code's "Pay first" leads, then the model's last reply, cut to two sentences. The cash check and
  // plan in numbers, anything the model said on the way, and the rest of its reply wait under
  // Details. The cash card beside the panel shows the same numbers as a chart.
  const payFirst = said.filter((m) => m.title === PAY_FIRST_TITLE);
  const modelSaid = said.filter((m) => !APP_MESSAGE_TITLES.includes(m.title));
  const reply = modelSaid.at(-1);
  const cut = reply ? firstSentences(plainText(reply.detail) ?? "", REPLY_SENTENCES) : null;
  const details = [...said.filter((m) => APP_MESSAGE_TITLES.includes(m.title) && m.title !== PAY_FIRST_TITLE), ...modelSaid.slice(0, -1)];
  const run = runSteps.find((s) => s.kind === "run");
  const pending = items.find((i) => runId && i.payment?.runId === runId && i.approval);
  const checkout = items.find((i) => runId && i.payment?.runId === runId && i.status === "awaiting_checkout");
  const running = !!runId && (!run || run.status === "running");
  const phase: Phase = !runId ? "idle" : pending ? "waiting" : running ? "working" : run?.status === "failed" ? "failed" : "finished";

  // The payment tool's step: refused by the Guard (no approval was ever asked), or declined by a person.
  const order = runSteps.findLast((s) => s.kind === "tool" && s.tool?.name === VENDOR_ORDER_TOOL);
  const refused = order?.status === "denied" && !order.approval ? order : undefined;
  // What it asked for, from the tool's own input: the Guard refused before working out any amount.
  const askedFor = (() => {
    const amount = (refused?.tool?.input as { amount?: string } | undefined)?.amount;
    return amount && /^\d{1,9}(\.\d{1,2})?$/.test(amount) ? formatCents(dollarsToCents(amount)) : undefined;
  })();
  const ordered = pending ?? checkout ?? items.find((i) => runId && i.payment?.runId === runId);
  const links = runId
    ? agentChain({
        reviewed: payFirst.length > 0,
        contracts: new Set(items.map((i) => i.contractId)).size,
        clashes: cash.warnings.length,
        moves: fix?.moves.length ?? 0,
        payment: ordered ? paymentName(ordered) : undefined,
        stage: refused ? "refused" : pending ? "waiting" : checkout ? "checkout" : running ? "working" : run?.status === "failed" ? "failed" : "finished",
        refusedAmount: askedFor,
      })
    : [];

  const planned = said.some((m) => m.title === CASH_PLAN_TITLE);

  useEffect(() => onRunning(running), [running, onRunning]);
  useEffect(() => onRun(runId), [runId, onRun]);
  useEffect(() => onPlanned(planned), [planned, onPlanned]);

  async function ask() {
    setStarting(true);
    setBlocked(null);
    try {
      const { run: started } = await paced(() => kitFetch<{ run: { id: string } }>("/api/agent/runs", { json: { agentId: "payments", goal, today: localToday() } }));
      setRunId(started.id);
    } catch (e) {
      if (e instanceof ApiError && (e.status === 402 || e.status === 429)) setBlocked(`${e.message} The agent can't start, and no money has moved. You can still pay from the timeline.`);
      else if (!(e instanceof WaitStopped)) toast({ title: "The agent couldn't start", description: (e as Error).message, variant: "error" });
    } finally {
      setStarting(false);
    }
  }

  return (
    <Card data-testid="agent-panel">
      <CardHeader
        title={<span className="inline-flex items-center gap-2"><Bot className="size-4 text-brand" /> Payment agent</span>}
        className="py-3!"
        action={phase === "idle" ? null : <span data-testid="agent-phase"><Badge tone={PHASE[phase].tone}>{PHASE[phase].label}</Badge></span>}
      />
      <CardBody>
        <form
          className="flex flex-col gap-2 sm:flex-row"
          onSubmit={(e) => {
            e.preventDefault();
            void ask();
          }}
        >
          <Input aria-label="What should the agent do?" value={goal} maxLength={500} onChange={(e) => setGoal(e.target.value)} data-testid="agent-goal" />
          <Button type="submit" icon={<Send className="size-3.5" />} className="shrink-0" loading={starting} disabled={starting || running || goal.trim().length < 3} data-testid="ask-agent">
            Ask the agent
          </Button>
        </form>
        {waitSeconds !== null ? <PacedWait className="mt-3" seconds={waitSeconds} what="agent" onStop={stopWaiting} testId="agent-wait" /> : null}
        {blocked ? <p className="mt-3 text-sm text-red-700" data-testid="agent-blocked">{blocked}</p> : null}
        {links.length ? <Chain links={links} /> : null}
        {said.length ? (
          <ul className="mt-3 space-y-1.5 text-sm text-zinc-700" data-testid="agent-messages">
            {payFirst.map((m) => <Message key={m.stepId} m={m} />)}
            {reply && cut ? <Message key={reply.stepId} m={reply} text={cut.lead} testId="agent-reply" /> : null}
            {details.length || cut?.rest ? (
              <li>
                <details data-testid="agent-details">
                  <summary className="cursor-pointer text-xs font-medium text-zinc-600 underline underline-offset-2">Details: the cash check and the plan, in numbers</summary>
                  <ul className="mt-1.5 space-y-1.5">
                    {details.map((m) => <Message key={m.stepId} m={m} />)}
                    {reply && cut?.rest ? <Message key={`${reply.stepId}-rest`} m={reply} text={cut.rest} /> : null}
                  </ul>
                </details>
              </li>
            ) : null}
          </ul>
        ) : null}
        {refused ? (
          <div className="mt-3 flex items-start gap-3 rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900" data-testid="guard-refusal" role="status">
            <ShieldX className="mt-0.5 size-5 shrink-0 text-red-600" aria-hidden />
            <div className="min-w-0">
              <p className="font-semibold">The Guard refused this payment{askedFor ? ` of ${askedFor}` : ""}</p>
              <p className="mt-0.5" data-testid="guard-reason">{refused.detail}</p>
              <p className="mt-1 text-xs text-red-800">No PayPal order was created and no approval was asked for. Only a confirmed contract term can be paid.</p>
            </div>
          </div>
        ) : null}
        {run?.status === "failed" ? (
          <p className="mt-3 text-sm text-red-700" data-testid="agent-error">
            {`${run.detail} The agent has stopped, and it can't pay anyone without your approval. You can still pay from the timeline.`}
          </p>
        ) : null}
        {pending?.approval ? (
          <PayApproval key={pending.approval.id} className="mt-3" item={pending} approval={pending.approval} cash={cash} sandbox={sandbox} onDecided={onDecided} />
        ) : null}
        {checkout ? <PayPalCheckout className="mt-3" item={checkout} sandbox={sandbox} onPaid={onDecided} /> : null}
      </CardBody>
    </Card>
  );
}
