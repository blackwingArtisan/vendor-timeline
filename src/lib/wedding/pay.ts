/**
 * Pays a vendor with a PayPal payout, behind the kit's Guard: a person must approve before
 * anything moves. The route returns while the Guard waits; the browser follows the timeline.
 * A batch finishes on PayPal's side later, so "paid" only ever comes from re-reading it.
 */
import { randomUUID } from "node:crypto";
import { appConfig } from "@/app.config";
import { runTool, type ToolCallResult } from "@/lib/agent/execute";
import { getApprovals } from "@/lib/agent/approvals";
import { Guard } from "@/lib/agent/guard";
import { createPayout } from "@/lib/agent/tools/extensions";
import { getEnv } from "@/lib/env";
import { withContext } from "@/lib/events/bus";
import { HttpError } from "@/lib/http";
import { getPayPal } from "@/lib/paypal";
import { singleton } from "@/lib/singleton";
import { centsToDollars, dollarsToCents, formatCents } from "./cents";
import { contractWithBatch, listContracts, requireContract, requirePlanContract, saveContract } from "./contracts";
import { utcToday } from "./dates";
import { buildTimeline, itemId, paymentState } from "./timeline";
import type { Contract, ItemKind, Payment, PendingApproval, TimelineItem, TimelineView } from "./types";

const RECHECK_MS = 2500;

/** Payments running in this process. A pending approval dies with the process. */
const activePayments = () => singleton("wedding:active-payments", () => new Set<string>());

/**
 * The vendors are fictional, so PayPal would only hold their money as UNCLAIMED. In sandbox the
 * payout goes to a sandbox test account instead. The screen says so wherever it shows the payment.
 */
export function payoutReceiver(vendorEmail: string): string {
  const env = getEnv();
  return env.paypalMode === "sandbox" ? env.sandboxBuyerEmail : vendorEmail;
}

function failureReason(result: ToolCallResult): string {
  const outcome = result.outcome;
  if (outcome?.status === "denied") return outcome.reason;
  if (outcome?.status === "failed") return (outcome.error as Error)?.message ?? "PayPal call failed.";
  return result.content;
}

function patchPayment(contractId: string, kind: ItemKind, patch: Partial<Payment>): Contract {
  const contract = requireContract(contractId);
  return saveContract({ ...contract, payments: { ...contract.payments, [kind]: { ...contract.payments[kind]!, ...patch } } });
}

async function send(contractId: string, kind: ItemKind, channel: string) {
  const contract = requireContract(contractId);
  const terms = contract.confirmed!;
  const payment = contract.payments[kind]!;
  const ctx = { runId: payment.runId, actor: "couple", channel, guard: new Guard({ paypal: getPayPal(), policy: appConfig.agentPolicy }) };
  const result = await runTool(
    createPayout,
    {
      items: [{ receiver: payment.receiver, amount: centsToDollars(payment.cents), currency: "USD", note: `${kind} for ${terms.vendorName}`, sender_item_id: itemId(contractId, kind) }],
      email_subject: `Wedding ${kind} for ${terms.vendorName}`,
      // Fixed for each attempt, so PayPal itself refuses a second batch for the same payment.
      sender_batch_id: `vt-${contractId}-${kind}-${payment.attempt}`,
    },
    ctx,
  );
  if (result.isError) {
    patchPayment(contractId, kind, { state: "failed", error: failureReason(result) });
    return;
  }
  const { payout_batch_id, batch_status } = result.output as { payout_batch_id: string; batch_status: string };
  patchPayment(contractId, kind, { state: "sending", batchId: payout_batch_id, batchStatus: batch_status, error: undefined });
  await syncPayment(contractId, kind);
}

/** Sends one payment to the approval gate. Resolves when the Guard has finished with it. */
export function requestPayment(planId: string, contractId: string, kind: ItemKind, channel: string): { contract: Contract; finished: Promise<void> } {
  const contract = requirePlanContract(planId, contractId);
  const terms = contract.confirmed;
  if (!terms) throw new HttpError(409, "Confirm this contract before paying it.", "conflict");
  const cents = kind === "deposit" ? terms.depositCents : terms.balanceCents;
  if (cents <= 0) throw new HttpError(409, `This contract has no ${kind} to pay.`, "conflict");
  const key = itemId(contractId, kind);
  const active = activePayments();
  const previous = contract.payments[kind];
  if (active.has(key) || (previous && previous.state !== "failed")) throw new HttpError(409, `This ${kind} already has a payment.`, "conflict");

  const runId = `pay_${randomUUID().slice(0, 12)}`;
  const attempt = previous ? previous.attempt + (previous.batchId ? 1 : 0) : 1;
  const payment: Payment = { runId, cents, attempt, state: "awaiting_approval", receiver: payoutReceiver(terms.payeeEmail) };
  const saved = saveContract({ ...contract, payments: { ...contract.payments, [kind]: payment } });

  active.add(key);
  const finished = withContext({ channel, runId, actor: "couple" }, () => send(contractId, kind, channel))
    .catch((e) => {
      const state = requireContract(contractId).payments[kind]!.state;
      // Once a batch exists the money is PayPal's to report, so keep following it.
      if (state === "awaiting_approval") patchPayment(contractId, kind, { state: "failed", error: e instanceof Error ? e.message : String(e) });
    })
    .finally(() => active.delete(key));
  return { contract: saved, finished };
}

/** Re-reads the payment from PayPal. This is the only way an item becomes paid. */
export async function syncPayment(contractId: string, kind: ItemKind): Promise<void> {
  const payment = requireContract(contractId).payments[kind];
  if (payment?.state !== "sending" || !payment.batchId) return;
  const batch = await getPayPal().payouts.get(payment.batchId);
  const item = batch.items[0];
  const batchStatus = batch.batch_header.batch_status;
  const itemCents = item ? dollarsToCents(item.payout_item.amount.value) : payment.cents;
  const amountOff = itemCents !== payment.cents;
  const state = amountOff ? "sending" : paymentState(item?.transaction_status, batchStatus);
  patchPayment(contractId, kind, {
    state,
    batchStatus,
    itemStatus: item?.transaction_status,
    transactionId: item?.transaction_id,
    error: amountOff ? `PayPal shows ${formatCents(itemCents)}, not the approved ${formatCents(payment.cents)}.` : state === "failed" ? (item?.errors?.message ?? `PayPal reports ${item?.transaction_status ?? batchStatus}.`) : undefined,
    checkedAt: new Date().toISOString(),
  });
}

/** Handles a payout webhook. All entries share one PayPal app, so a batch we didn't create is ignored. */
export async function refreshFromWebhook(batchId: string): Promise<boolean> {
  const contract = contractWithBatch(batchId);
  if (!contract) return false;
  for (const [kind, payment] of Object.entries(contract.payments)) {
    if (payment.batchId === batchId) await syncPayment(contract.id, kind as ItemKind);
  }
  return true;
}

function stale(payment: Payment): boolean {
  return payment.state === "sending" && (!payment.checkedAt || Date.now() - Date.parse(payment.checkedAt) >= RECHECK_MS);
}

/** Polling works with no webhook at all, and keeps working if the server restarted mid-payment. */
async function syncOpenPayments(planId: string) {
  for (const contract of listContracts(planId)) {
    for (const [kind, payment] of Object.entries(contract.payments)) {
      if (stale(payment)) await syncPayment(contract.id, kind as ItemKind).catch(() => undefined); // The last status stays on screen.
    }
  }
}

function pendingApproval(item: TimelineItem): PendingApproval | null {
  const runId = item.payment?.runId;
  const pending = runId ? getApprovals().list({ runId, state: "pending" })[0] : undefined;
  if (!pending) return null;
  return { id: pending.id, summary: `Pay ${item.vendorName} ${formatCents(item.cents)} for the ${item.kind}`, reason: pending.reason, amountValue: pending.amount?.value };
}

/** The server restarted while the couple were deciding: no money moved, so go back a step. */
function recoverLostApprovals(planId: string) {
  const active = activePayments();
  for (const contract of listContracts(planId)) {
    for (const [kind, payment] of Object.entries(contract.payments)) {
      if (payment.state === "awaiting_approval" && !active.has(itemId(contract.id, kind as ItemKind))) {
        patchPayment(contract.id, kind as ItemKind, { state: "failed", error: "The approval was lost when the server restarted. Ask again." });
      }
    }
  }
}

export async function viewTimeline(planId: string, today = utcToday()): Promise<TimelineView> {
  recoverLostApprovals(planId);
  await syncOpenPayments(planId);
  const view = buildTimeline(listContracts(planId), today);
  const items = view.items.map((item) => ({ ...item, approval: pendingApproval(item) }));
  return { ...view, items, nextDue: items.find((i) => i.id === view.nextDue?.id) ?? null, overdue: items.filter((i) => i.status === "overdue"), sandboxStandIn: getEnv().paypalMode === "sandbox" };
}
