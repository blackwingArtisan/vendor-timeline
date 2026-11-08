"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, Send } from "lucide-react";
import { PacedWait } from "@/components/wedding/paced-wait";
import { PayApproval } from "@/components/wedding/pay-approval";
import { PayPalCheckout } from "@/components/wedding/paypal-checkout";
import { usePaced, WaitStopped } from "@/components/wedding/use-paced";
import { ApiError, useKit } from "@/components/kit/kit-provider";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, CardBody, CardHeader, Input, type Tone } from "@/components/ui";
import type { TimelineStep } from "@/lib/events/types";
import { localToday } from "@/lib/wedding/dates";
import type { CashPlan, TimelineItem } from "@/lib/wedding/types";
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

function Message({ m }: { m: TimelineStep }) {
  const fromApp = APP_MESSAGE_TITLES.includes(m.title);
  return (
    <li className={fromApp ? "whitespace-pre-line font-medium text-zinc-900" : "whitespace-pre-line"} data-testid="agent-message" data-from={fromApp ? "app" : "agent"}>
      {plainText(m.detail)}
    </li>
  );
}

/**
 * The agent names what's due, shows code's cash plan, and asks to pay. A person answers here, and
 * only then can money move. `onRun` tells the timeline which payment this panel shows, and
 * `onPlanned` that code's cash plan is out, for the cash card to show its moves.
 */
export function AgentPanel({ steps, items, cash, sandbox, onRun, onPlanned, onRunning, onDecided }: { steps: TimelineStep[]; items: TimelineItem[]; cash: CashPlan; sandbox: boolean; onRun: (runId: string | null) => void; onPlanned: (planned: boolean) => void; onRunning: (running: boolean) => void; onDecided: () => void }) {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const [goal, setGoal] = useState(DEFAULT_GOAL);
  const [runId, setRunId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const { paced, waitSeconds, stopWaiting } = usePaced();
  const [blocked, setBlocked] = useState<string | null>(null);

  const runSteps = useMemo(() => steps.filter((s) => s.runId === runId), [steps, runId]);
  // What code said (pay first, then each warning) leads, and the model's explanation follows.
  const said = runSteps.filter((s) => s.kind === "agent.message");
  const messages = [...said.filter((m) => APP_MESSAGE_TITLES.includes(m.title)), ...said.filter((m) => !APP_MESSAGE_TITLES.includes(m.title))];
  // Code's "Pay first" and the model's words lead. The numbers behind them wait under Details,
  // and the cash card beside the panel shows the same numbers as a chart.
  const lead = messages.filter((m) => m.title === PAY_FIRST_TITLE || !APP_MESSAGE_TITLES.includes(m.title));
  const details = messages.filter((m) => !lead.includes(m));
  const run = runSteps.find((s) => s.kind === "run");
  const pending = items.find((i) => runId && i.payment?.runId === runId && i.approval);
  const checkout = items.find((i) => runId && i.payment?.runId === runId && i.status === "awaiting_checkout");
  const running = !!runId && (!run || run.status === "running");
  const phase: Phase = !runId ? "idle" : pending ? "waiting" : running ? "working" : run?.status === "failed" ? "failed" : "finished";

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
        {messages.length ? (
          <ul className="mt-3 space-y-1.5 text-sm text-zinc-700" data-testid="agent-messages">
            {lead.map((m) => <Message key={m.stepId} m={m} />)}
            {details.length ? (
              <li>
                <details data-testid="agent-details">
                  <summary className="cursor-pointer text-xs font-medium text-zinc-600 underline underline-offset-2">Details: the cash check and the plan, in numbers</summary>
                  <ul className="mt-1.5 space-y-1.5">{details.map((m) => <Message key={m.stepId} m={m} />)}</ul>
                </details>
              </li>
            ) : null}
          </ul>
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
