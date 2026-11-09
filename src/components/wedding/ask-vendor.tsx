"use client";

/**
 * "Ask the vendor for a later date", on the couple's side. The couple share a link with the drafted
 * note (the app sends nothing itself); the vendor answers on their phone; the reply agent reads it
 * and the move waits for the couple's approval. "They agreed" stays for a vendor who answers some
 * other way. Every date, amount and sentence comes from the server.
 */
import { useEffect, useRef, useState } from "react";
import { CalendarClock, CircleCheck, Copy, Link2, MessageSquareText, Sparkles } from "lucide-react";
import { ApprovalPrompt } from "@/components/agent/approval-prompt";
import { ApiError, useKit } from "@/components/kit/kit-provider";
import { useToast } from "@/components/toast";
import { Badge, Button, Input, Textarea } from "@/components/ui";
import { READ_FAILED, readOutcome, type RunStatus } from "@/lib/agent/read-outcome";
import { retryIfDropped } from "@/lib/gateway-retry";
import { formatDay, localToday } from "@/lib/wedding/dates";
import type { CashMove, TimelineItem } from "@/lib/wedding/types";

/** How often the card looks for the vendor's answer, or the agent's proposal, while it waits. */
const POLL_MS = 2000;

type Stage = "draft" | "shared" | "replied" | "reading" | "failed" | "approve" | "refused" | "moved";

function stageOf(item: TimelineItem | undefined, reading: boolean, failed: boolean): Stage {
  const ask = item?.ask;
  if (ask?.movedTo) return "moved";
  if (!ask) return "draft";
  if (ask.approval) return "approve";
  if (ask.verdict && !ask.verdict.ok) return "refused";
  if (failed && ask.reply) return "failed";
  if (reading && ask.reply) return "reading";
  if (ask.reply) return "replied";
  return "shared";
}

const STAGE_LABEL: Record<Stage, string> = { draft: "Not shared yet", shared: "Shared, waiting for a reply", replied: "Replied", reading: "Agent reading", failed: "Couldn't read", approve: "Your approval", refused: "Reply checked", moved: "Moved" };

export function AskVendor({ move, item, onDone, onRun }: { move: CashMove; item?: TimelineItem; onDone: () => void; onRun?: (runId: string) => void }) {
  const { kitFetch } = useKit();
  const { toast } = useToast();
  const [copied, setCopied] = useState<"message" | "link" | null>(null);
  const [busy, setBusy] = useState<"share" | "agreed" | "read" | null>(null);
  const [reading, setReading] = useState(false);
  const [failed, setFailed] = useState(false);
  /** The agent run reading the reply. */
  const [readRunId, setReadRunId] = useState<string | null>(null);
  /** When that run started, and when the page first saw it finished. */
  const readTimes = useRef<{ startedAt: number; completedSeenAt: number | null }>({ startedAt: 0, completedSeenAt: null });
  const ask = item?.ask ?? null;
  const stage = stageOf(item, reading, failed);
  const link = ask ? `${typeof window === "undefined" ? "" : window.location.origin}/vendor/${ask.token}` : "";
  const legacyMoved = !ask?.movedTo && item?.due === move.to;

  // While the vendor or the agent has the next step, keep looking.
  const waiting = stage === "shared" || stage === "reading";
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(onDone, POLL_MS);
    return () => clearInterval(timer);
  }, [waiting, onDone]);

  // While the agent reads, watch its run too: a run that failed, vanished, finished without an
  // answer or stalled shows "Couldn't read the reply" with a retry, never an endless "reading".
  const runId = stage === "reading" ? readRunId : null;
  useEffect(() => {
    if (!runId) return;
    let stopped = false;
    const look = async () => {
      let run: { status: RunStatus; error?: string } | null;
      try {
        run = (await kitFetch<{ run: { status: RunStatus; error?: string } }>(`/api/agent/runs/${runId}`)).run;
      } catch (e) {
        if (!(e instanceof ApiError && e.status === 404)) return; // a dropped poll: look again next time
        run = null;
      }
      if (stopped) return;
      const now = Date.now();
      const times = readTimes.current;
      if (run?.status === "completed" && times.completedSeenAt === null) times.completedSeenAt = now;
      if (readOutcome({ run, answered: false, startedAt: times.startedAt, completedSeenAt: times.completedSeenAt, now }) === "failed") {
        console.warn(`Reply read ${runId}: ${run ? `${run.status}${run.error ? `, ${run.error}` : ""}` : "the server has no such run"}`);
        setReading(false);
        setFailed(true);
      }
    };
    const timer = setInterval(() => void look(), POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [runId, kitFetch]);

  async function copy(text: string, what: "message" | "link") {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
    } catch {
      toast({ title: "Couldn't copy", description: "Select the text and copy it yourself." });
    }
  }

  async function share() {
    setBusy("share");
    try {
      const { path } = await retryIfDropped(() => kitFetch<{ path: string }>(`/api/contracts/${move.contractId}/ask`, { json: { kind: move.itemKind, to: move.to, today: localToday() } }));
      await copy(`${move.message ?? ""}\n\nAnswer here: ${window.location.origin}${path}`, "link");
      onDone();
    } catch (e) {
      toast({ title: "Could not make the link", description: (e as Error).message, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function agreed() {
    setBusy("agreed");
    try {
      // Moving to the same date twice changes nothing, so a request the hosting proxy dropped is sent again.
      await retryIfDropped(() => kitFetch(`/api/contracts/${move.contractId}/move`, { json: { kind: move.itemKind, due: move.to, today: localToday() } }));
      onDone();
    } catch (e) {
      toast({ title: "Could not move that date", description: (e as Error).message, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function read() {
    setBusy("read");
    setFailed(false);
    try {
      const { runId } = await kitFetch<{ runId: string }>(`/api/contracts/${move.contractId}/ask/read`, { json: { kind: move.itemKind, today: localToday() } });
      readTimes.current = { startedAt: Date.now(), completedSeenAt: null };
      setReadRunId(runId);
      setReading(true);
      onRun?.(runId);
      onDone();
    } catch (e) {
      setFailed(true);
      toast({ title: "Could not read the reply", description: (e as Error).message, variant: "error" });
    } finally {
      setBusy(null);
    }
  }

  if (stage === "moved" || legacyMoved) {
    const by = ask?.movedTo ? ` on ${move.vendorName}'s reply` : "";
    return (
      <div className="mt-2 space-y-1 text-sm text-emerald-800" data-testid="move-done">
        <p className="flex items-center gap-2"><CircleCheck className="size-4 shrink-0" /> Moved to {formatDay(ask?.movedTo ?? move.to)}{by}. The contract said {formatDay(item?.movedFrom ?? move.due)}.</p>
        {ask?.reply?.paypalEmail ? <p className="pl-6 text-xs text-emerald-900" data-testid="move-payee">Now paid to {move.vendorName}&apos;s own PayPal: {ask.reply.paypalEmail}</p> : null}
      </div>
    );
  }

  const reply = ask?.reply;
  return (
    <div className="mt-2 space-y-2" data-testid="ask-vendor" data-stage={stage}>
      <span data-testid="ask-stage"><Badge tone={stage === "approve" ? "warning" : stage === "replied" ? "brand" : "neutral"}>{STAGE_LABEL[stage]}</Badge></span>
      {stage === "draft" ? <Textarea readOnly aria-label={`Message to ${move.vendorName}`} className="min-h-32 text-xs" value={move.message} data-testid="move-message" /> : null}

      {ask && !reply ? (
        <div className="space-y-1">
          <Input readOnly aria-label={`Link for ${move.vendorName}`} value={link} className="text-xs" data-testid="move-link" />
          <p className="text-xs text-zinc-600" data-testid="move-share-note">You send this link yourself, by text or email. The app doesn&apos;t send it. {move.vendorName} answers on their phone, and nothing moves until you approve.</p>
        </div>
      ) : null}

      {reply ? (
        <blockquote className="rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2 text-sm text-zinc-800" data-testid="vendor-reply">
          <span className="flex items-center gap-1.5 text-xs font-medium text-zinc-500"><MessageSquareText className="size-3.5" /> {move.vendorName} replied</span>
          <span className="mt-0.5 block" data-testid="vendor-reply-text">&ldquo;{reply.text || (reply.answer === "agreed" ? `Yes, ${formatDay(ask!.askedTo)} works` : "No, keep the date")}&rdquo;</span>
          {reply.paypalEmail ? <span className="mt-0.5 block text-xs text-zinc-600" data-testid="vendor-reply-email">Pay them at {reply.paypalEmail}</span> : null}
        </blockquote>
      ) : null}

      {stage === "approve" && ask?.approval ? (
        <ApprovalPrompt approvalId={ask.approval.id} summary={ask.approval.summary} reason="The vendor's words were read by the agent; code checked the date against the contract. Nothing moves until you approve." approveLabel="Approve the move" onDecided={() => { setReading(false); onDone(); }} />
      ) : null}
      {stage === "refused" ? <p className="text-sm text-amber-800" data-testid="move-refused">{ask!.verdict!.reason}</p> : null}
      {stage === "failed" ? <p className="text-sm text-amber-800" role="alert" data-testid="move-read-failed">{READ_FAILED}</p> : null}

      <div className="flex flex-wrap gap-2">
        {stage === "draft" ? (
          <Button size="sm" icon={<Link2 className="size-3.5" />} loading={busy === "share"} disabled={!!busy || !item} onClick={() => void share()} data-testid="move-share">
            Share the ask
          </Button>
        ) : null}
        {ask && !reply ? (
          <Button size="sm" variant="secondary" icon={<Copy className="size-3.5" />} onClick={() => void copy(`${move.message ?? ""}\n\nAnswer here: ${link}`, "link")} data-testid="move-copy-link">
            {copied === "link" ? "Copied" : "Copy link and message"}
          </Button>
        ) : null}
        {stage === "draft" ? (
          <Button size="sm" variant="secondary" icon={<Copy className="size-3.5" />} onClick={() => void copy(move.message ?? "", "message")} data-testid="move-copy">
            {copied === "message" ? "Copied" : "Copy message"}
          </Button>
        ) : null}
        {stage === "failed" ? (
          <Button size="sm" icon={<Sparkles className="size-3.5" />} loading={busy === "read"} disabled={!!busy} onClick={() => void read()} data-testid="move-read-retry">
            Try again
          </Button>
        ) : null}
        {stage === "replied" ? (
          <Button size="sm" icon={<Sparkles className="size-3.5" />} loading={busy === "read"} disabled={!!busy} onClick={() => void read()} data-testid="move-read">
            Let the agent read it
          </Button>
        ) : null}
        {stage === "draft" || stage === "shared" || stage === "refused" || stage === "failed" ? (
          <Button size="sm" variant="secondary" icon={<CalendarClock className="size-3.5" />} loading={busy === "agreed"} disabled={!!busy || !item} onClick={() => void agreed()} data-testid="move-approve">
            They agreed: move it to {formatDay(move.to)}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
