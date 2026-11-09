/**
 * APP-OWNED: the reply agent. A vendor answered the couple's "could this move to a later date?"
 * link. The agent reads the reply (Claude reads the date out of the vendor's own words), code checks
 * that date against the contract, and the only change it can make, move_due_date, waits for the
 * couple's approval in the Guard. It moves no money.
 */
import { z } from "zod";
import { appConfig } from "@/app.config";
import { defineAgent, type AgentInput, type ScriptStep } from "@/lib/agent/define";
import { defineTool } from "@/lib/agent/tool";
import { timeline } from "@/lib/events/bus";
import { formatCents } from "@/lib/wedding/cents";
import { requirePlanContract, termPayee } from "@/lib/wedding/contracts";
import { formatDay } from "@/lib/wedding/dates";
import { applyVendorReply, mockVerdict, readAskReply } from "@/lib/wedding/vendor-move";
import { MOVE_TOOL, READ_REPLY_TOOL } from "@/lib/wedding/tool-names";
import type { ItemKind } from "@/lib/wedding/types";

export const REPLY_AGENT_ID = "vendor-reply";

const SYSTEM = `A wedding vendor answered the couple's request to move one payment to a later date. You act on that answer for the couple.

Call read_vendor_reply first, with the contract_id and kind from the context. It returns what the vendor said, the date read from it, and the app's own verdict on that date. The app decides whether a date may be used, never you.

If the verdict is allowed, call move_due_date with the contract_id, kind and exactly the date it returned. The couple must approve the move; you can't approve it. If the verdict is not allowed, say why in one plain sentence, quoting the app's reason, and stop. Never suggest a different date.

Write plain sentences: no Markdown, no lists, no headings.`;

const Target = z.object({ contract_id: z.string().min(1).max(40).describe("The contract_id from the context"), kind: z.enum(["deposit", "balance"]) });

/** AI mock mode: the same tools, Guard and approval; the reply is read by the fixture in vendor-reply.ts. */
function mockSteps(planId: string, today: string, input: AgentInput): ScriptStep[] {
  const target = { contract_id: String(input.context?.contract_id ?? ""), kind: String(input.context?.kind ?? "") };
  const verdict = mockVerdict(planId, target.contract_id, target.kind as ItemKind, today);
  const steps: ScriptStep[] = [{ say: "Reading the vendor's reply.", tool: READ_REPLY_TOOL, input: target, as: "read" }];
  if (!verdict?.ok) return [...steps, { say: (r) => `Nothing moves: ${r.read?.reason ?? r.read?.error?.reason ?? "the reply gives no date the app can use."}` }];
  return [
    ...steps,
    { say: (r) => `${r.read?.vendor} can do ${r.read?.date_text}. Moving it needs your approval.`, tool: MOVE_TOOL, input: (r) => ({ ...target, due: r.read?.date }), as: "move" },
    { say: (r) => (r.move?.error ? `The date didn't move: ${r.move.error.reason ?? r.move.error.message ?? "it was refused."}` : "Moved. The cash check now uses the new date.") },
  ];
}

export function vendorReplyAgent(planId: string, today: string) {
  const readTool = defineTool({
    name: READ_REPLY_TOOL,
    description: "Read the vendor's reply to the couple's request to move one payment, with the date read from it and the app's verdict on that date.",
    risk: "read",
    source: "app",
    schema: Target,
    title: () => "Read the vendor's reply",
    execute: async (i) => {
      const { contract, ask, verdict } = await readAskReply(planId, i.contract_id, i.kind as ItemKind, today);
      const name = contract.confirmed!.vendorName;
      timeline.emit({
        kind: "agent.message",
        status: verdict.ok ? "info" : "failed",
        title: "Vendor reply, checked by code",
        detail: verdict.ok ? `${name} wrote "${ask.reply!.text || "Yes"}". Read as ${formatDay(verdict.date)}: before the wedding and inside the range a payment may move to.` : verdict.reason,
      });
      return {
        contract_id: contract.id,
        kind: i.kind,
        vendor: name,
        said: ask.reply!.text,
        tapped: ask.reply!.answer,
        allowed: verdict.ok,
        date: verdict.ok ? verdict.date : null,
        date_text: verdict.ok ? formatDay(verdict.date) : null,
        reason: verdict.ok ? null : verdict.reason,
        new_payee: ask.reply!.paypalEmail ?? null,
      };
    },
  });

  const moveTool = defineTool({
    name: MOVE_TOOL,
    description: "Move one payment to the date the vendor agreed to, and pay the PayPal email the vendor gave, if they gave one. Waits for the couple's approval. The date must be the one read_vendor_reply allowed.",
    risk: "write",
    source: "app",
    schema: Target.extend({ due: z.string().max(10).describe("The date from read_vendor_reply, YYYY-MM-DD") }),
    title: (i) => `Move the ${i.kind} to ${formatDay(i.due)}`,
    check: (i) => {
      const contract = requirePlanContract(planId, i.contract_id);
      const verdict = contract.asks?.[i.kind as ItemKind]?.verdict;
      if (!verdict?.ok) return "The vendor's reply hasn't been read and allowed, so nothing can move.";
      if (verdict.date !== i.due) return `The vendor's reply allows ${formatDay(verdict.date!)}, not ${formatDay(i.due)}. Nothing moved.`;
      return null;
    },
    impact: async (i) => {
      const contract = requirePlanContract(planId, i.contract_id);
      const terms = contract.confirmed!;
      const ask = contract.asks![i.kind as ItemKind]!;
      const cents = i.kind === "deposit" ? terms.depositCents : terms.balanceCents;
      const payee = ask.reply?.paypalEmail ? ` and pay ${terms.vendorName} at ${ask.reply.paypalEmail}` : "";
      return { counterparties: ask.reply?.paypalEmail ? [ask.reply.paypalEmail] : [], summary: `Move the ${terms.vendorName} ${i.kind} (${formatCents(cents)}) from ${formatDay(ask.fromDue)} to ${formatDay(i.due)}${payee}` };
    },
    execute: async (i) => {
      const contract = applyVendorReply(planId, i.contract_id, i.kind as ItemKind, i.due, today);
      return { moved_to: i.due, payee: termPayee(contract, i.kind as ItemKind) };
    },
  });

  return defineAgent({
    id: REPLY_AGENT_ID,
    name: "Reply agent",
    description: "Reads a vendor's reply to a later-date request and, with the couple's approval, moves the date.",
    system: SYSTEM,
    tools: () => [readTool, moveTool],
    policy: { ...appConfig.agentPolicy, requireApprovalFor: [...(appConfig.agentPolicy.requireApprovalFor ?? []), MOVE_TOOL] },
    effort: "low",
    maxTurns: 4,
    mockScript: (input) => mockSteps(planId, today, input),
  });
}
