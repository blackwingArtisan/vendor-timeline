/**
 * Pays a vendor with a PayPal payout. Every payment, from the "Pay" button or from the agent, is one
 * call to vendorPayoutTool(), so it passes the same limits and then the Guard's human approval.
 * The route returns while the Guard waits; the browser follows the timeline.
 *
 * A batch finishes on PayPal's side later. "Paid" takes PayPal's own status plus a verified webhook
 * naming this exact payment. If that webhook never arrives, the status re-read from PayPal stands
 * after WEBHOOK_WAIT_MS, and the screen says which of the two it was.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appConfig } from "@/app.config";
import { runTool } from "@/lib/agent/execute";
import { getApprovals, type Approval } from "@/lib/agent/approvals";
import { Guard, type GuardOutcome } from "@/lib/agent/guard";
import { defineTool } from "@/lib/agent/tool";
import { createPayout } from "@/lib/agent/tools/extensions";
import { getEnv } from "@/lib/env";
import { timeline, withContext } from "@/lib/events/bus";
import { HttpError } from "@/lib/http";
import { moneyFromMinor } from "@/lib/money";
import { getPayPal } from "@/lib/paypal";
import type { PayoutItem, WebhookEventEnvelope } from "@/lib/paypal/types";
import { singleton } from "@/lib/singleton";
import { monthlyBudget } from "./budget";
import { centsToDollars, dollarsToCents, formatCents } from "./cents";
import { contractWithBatch, findContract, listContracts, requireContract, requirePlanContract, saveContract } from "./contracts";
import { utcToday } from "./dates";
import { buildTimeline, itemId, paymentState } from "./timeline";
import type { Contract, ItemKind, Payment, PendingApproval, TimelineItem, TimelineView } from "./types";

const RECHECK_MS = 2500;
/** PayPal's webhook took about 15 seconds in the sandbox. A re-read stands on its own after this. */
export const WEBHOOK_WAIT_MS = 60_000;
export const VENDOR_PAYOUT_TOOL = "create_vendor_payout";

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

const termCents = (contract: Contract, kind: ItemKind) => (kind === "deposit" ? contract.confirmed!.depositCents : contract.confirmed!.balanceCents);

function patchPayment(contractId: string, kind: ItemKind, patch: Partial<Payment>): Contract {
  const contract = requireContract(contractId);
  return saveContract({ ...contract, payments: { ...contract.payments, [kind]: { ...contract.payments[kind]!, ...patch } } });
}

/** Everything that must be true of a contract before any payment on it. The same call that claimed it may pass again. */
function requirePayable(planId: string, contractId: string, kind: ItemKind, runId?: string): Contract {
  const contract = requirePlanContract(planId, contractId);
  if (!contract.confirmed) throw new HttpError(409, "Confirm this contract before paying it.", "conflict");
  if (termCents(contract, kind) <= 0) throw new HttpError(409, `This contract has no ${kind} to pay.`, "conflict");
  const previous = contract.payments[kind];
  if (previous && runId && previous.runId === runId && previous.state === "awaiting_approval") return contract;
  if (activePayments().has(itemId(contractId, kind)) || (previous && previous.state !== "failed")) throw new HttpError(409, `This ${kind} already has a payment.`, "conflict");
  return contract;
}

/** The code limit: a payout is exactly one confirmed term. Nothing an agent asks for changes this. */
function requireTermAmount(contract: Contract, kind: ItemKind, requestedCents: number) {
  const cents = termCents(contract, kind);
  if (requestedCents === cents) return;
  const name = `the confirmed ${kind} of ${formatCents(cents)} for ${contract.confirmed!.vendorName}`;
  const verb = requestedCents > cents ? "is more than" : "doesn't match";
  throw new HttpError(422, `${formatCents(requestedCents)} ${verb} ${name}. Nothing was sent.`, "rule");
}

function claimPayment(contract: Contract, kind: ItemKind, runId: string): Contract {
  const previous = contract.payments[kind];
  if (previous?.runId === runId && previous.state === "awaiting_approval") return contract;
  const payment: Payment = {
    runId,
    cents: termCents(contract, kind),
    attempt: previous ? previous.attempt + (previous.batchId ? 1 : 0) : 1,
    state: "awaiting_approval",
    receiver: payoutReceiver(contract.confirmed!.payeeEmail),
  };
  activePayments().add(itemId(contract.id, kind));
  return saveContract({ ...contract, payments: { ...contract.payments, [kind]: payment } });
}

function outcomeError(outcome: GuardOutcome): string {
  if (outcome.status === "denied") return outcome.reason;
  if (outcome.status === "failed") return (outcome.error as Error)?.message ?? "PayPal call failed.";
  return "Payment stopped.";
}

/** The Guard is done. A refused call never claimed the payment, so it has nothing to undo here. */
function settlePayment(contractId: string, kind: ItemKind, runId: string, outcome: GuardOutcome) {
  const payment = findContract(contractId)?.payments[kind];
  if (payment?.runId !== runId) return;
  activePayments().delete(itemId(contractId, kind));
  // Once a batch exists the money is PayPal's to report, so keep following it.
  if (outcome.status !== "executed" && payment.state === "awaiting_approval") patchPayment(contractId, kind, { state: "failed", error: outcomeError(outcome) });
}

const PayoutInput = z.object({
  contract_id: z.string().min(1).max(40).describe("The contract_id from review_payments"),
  kind: z.enum(["deposit", "balance"]),
  amount: z
    .string()
    .regex(/^\d{1,9}(\.\d{1,2})?$/)
    .describe('US dollars as a decimal string such as "1200.00". It must equal the confirmed term exactly.'),
});
type PayoutInput = z.infer<typeof PayoutInput>;

/** The only way money leaves this app. It has no receiver input: the confirmed contract decides who is paid. */
export function vendorPayoutTool(planId: string) {
  return defineTool({
    name: VENDOR_PAYOUT_TOOL,
    description: "Ask to pay one confirmed deposit or balance to its vendor by PayPal payout. This stops at a person's approval and nothing moves before it. The amount must equal the confirmed term exactly, and the app decides who gets paid.",
    risk: "money",
    source: "app",
    schema: PayoutInput,
    title: (i) => `Pay the ${i.kind}`,
    check: (i, ctx) => {
      try {
        const contract = requirePayable(planId, i.contract_id, i.kind, ctx.runId);
        requireTermAmount(contract, i.kind, dollarsToCents(i.amount));
        claimPayment(contract, i.kind, ctx.runId);
        return null;
      } catch (e) {
        if (e instanceof HttpError) return e.message;
        throw e;
      }
    },
    impact: async (i) => {
      const contract = requireContract(i.contract_id);
      const payment = contract.payments[i.kind]!;
      return { amount: moneyFromMinor(payment.cents, "USD"), counterparties: [payment.receiver], summary: `Pay ${contract.confirmed!.vendorName} ${formatCents(payment.cents)} for the ${i.kind}` };
    },
    execute: async (i, ctx) => {
      // Read again after the wait for a person: what goes to PayPal is the term, not the request.
      const contract = requireContract(i.contract_id);
      const terms = contract.confirmed!;
      const payment = contract.payments[i.kind]!;
      requireTermAmount(contract, i.kind, payment.cents);
      const payout = {
        items: [{ receiver: payment.receiver, amount: centsToDollars(payment.cents), currency: "USD", note: `${i.kind} for ${terms.vendorName}`, sender_item_id: itemId(contract.id, i.kind) }],
        email_subject: `Wedding ${i.kind} for ${terms.vendorName}`,
        // Fixed for each attempt, so PayPal itself refuses a second batch for the same payment.
        sender_batch_id: `vt-${contract.id}-${i.kind}-${payment.attempt}`,
      };
      const sent = await createPayout.execute(createPayout.parse(payout), ctx);
      const { payout_batch_id, batch_status } = sent as { payout_batch_id: string; batch_status: string };
      patchPayment(contract.id, i.kind, { state: "sending", batchId: payout_batch_id, batchStatus: batch_status, error: undefined });
      await syncPayment(contract.id, i.kind).catch(() => undefined); // The timeline keeps following it.
      return { payout_batch_id, batch_status, note: "A person approved this and PayPal has it. The timeline shows paid once PayPal confirms." };
    },
    after: (i, outcome, ctx) => settlePayment(i.contract_id, i.kind, ctx.runId, outcome),
  });
}

async function send(planId: string, contractId: string, kind: ItemKind, runId: string, channel: string) {
  const ctx = { runId, actor: "couple", channel, guard: new Guard({ paypal: getPayPal(), policy: appConfig.agentPolicy }) };
  await runTool(vendorPayoutTool(planId), { contract_id: contractId, kind, amount: centsToDollars(requireContract(contractId).payments[kind]!.cents) }, ctx);
}

/** The "Pay" button. Sends one payment to the approval gate. Resolves when the Guard has finished with it. */
export function requestPayment(planId: string, contractId: string, kind: ItemKind, channel: string): { contract: Contract; finished: Promise<void> } {
  const runId = `pay_${randomUUID().slice(0, 12)}`;
  const saved = claimPayment(requirePayable(planId, contractId, kind), kind, runId);
  const finished = withContext({ channel, runId, actor: "couple" }, () => send(planId, contractId, kind, runId, channel)).catch((e) => {
    settlePayment(contractId, kind, runId, { status: "failed", error: e });
  });
  return { contract: saved, finished };
}

const webhookExpected = () => getEnv().paypalMode === "mock" || !!getEnv().paypalWebhookId;

/**
 * Re-reads the payment from PayPal, the only source of its status. A webhook is what turns that
 * status into paid. See the top of this file for when a webhook doesn't come.
 */
export async function syncPayment(contractId: string, kind: ItemKind): Promise<void> {
  const payment = requireContract(contractId).payments[kind];
  if (payment?.state !== "sending" || !payment.batchId) return;
  const batch = await getPayPal().payouts.get(payment.batchId);
  const item = batch.items.find((i) => i.payout_item.sender_item_id === itemId(contractId, kind));
  const batchStatus = batch.batch_header.batch_status;
  const itemCents = item ? dollarsToCents(item.payout_item.amount.value) : payment.cents;
  const amountOff = itemCents !== payment.cents;
  const reported = amountOff ? "sending" : paymentState(item?.transaction_status, batchStatus);
  const now = new Date().toISOString();
  const successSeenAt = reported === "paid" ? (payment.successSeenAt ?? now) : undefined;
  const waitedOut = successSeenAt ? !webhookExpected() || Date.now() - Date.parse(successSeenAt) >= WEBHOOK_WAIT_MS : false;
  const paidBy = reported !== "paid" ? undefined : payment.webhook ? "webhook" : waitedOut ? "re-read" : undefined;
  const state = reported === "paid" && !paidBy ? "sending" : reported;
  patchPayment(contractId, kind, {
    state,
    batchStatus,
    itemStatus: item?.transaction_status,
    transactionId: item?.transaction_id,
    error: amountOff ? `PayPal shows ${formatCents(itemCents)}, not the approved ${formatCents(payment.cents)}.` : state === "failed" ? (item?.errors?.message ?? `PayPal reports ${item?.transaction_status ?? batchStatus}.`) : undefined,
    checkedAt: now,
    successSeenAt,
    paidBy,
  });
}

/** Why a verified item webhook doesn't belong to this payment, or null if it does. */
function webhookMismatch(event: PayoutItem, contract: Contract, kind: ItemKind, payment: Payment): string | null {
  const paid = event.payout_item;
  if (paid.sender_item_id !== itemId(contract.id, kind)) return `it names item ${paid.sender_item_id ?? "none"}`;
  if (paid.amount.currency !== "USD" || dollarsToCents(paid.amount.value) !== payment.cents) return `it says ${paid.amount.value} ${paid.amount.currency}, not ${centsToDollars(payment.cents)} USD`;
  if (paid.receiver?.toLowerCase() !== payment.receiver.toLowerCase()) return "it names a different receiver";
  return null;
}

function paymentForBatch(batchId: string) {
  const contract = contractWithBatch(batchId);
  const found = contract && Object.entries(contract.payments).find(([, p]) => p.batchId === batchId);
  return found ? { contract, kind: found[0] as ItemKind, payment: found[1] } : null;
}

/**
 * A payout item webhook, already verified by signature. It counts only if it names this exact
 * payment: its batch, its item, its amount and its receiver. Anything else changes nothing.
 * All entries can share one PayPal app, so a batch we didn't create is ignored.
 */
export async function payoutItemWebhook(event: WebhookEventEnvelope<string, PayoutItem>): Promise<boolean> {
  const found = paymentForBatch(event.resource.payout_batch_id);
  if (!found) return false;
  const { contract, kind, payment } = found;
  const mismatch = webhookMismatch(event.resource, contract, kind, payment);
  if (mismatch) {
    timeline.emit({ kind: "webhook", status: "failed", channel: "global", title: "Payout webhook ignored", detail: `${event.event_type} doesn't match this payment: ${mismatch}.` });
    return false;
  }
  if (event.event_type === "PAYMENT.PAYOUTS-ITEM.SUCCEEDED") {
    patchPayment(contract.id, kind, { webhook: { eventId: event.id, eventType: event.event_type, payoutItemId: event.resource.payout_item_id, receivedAt: new Date().toISOString() } });
  }
  await syncPayment(contract.id, kind);
  return true;
}

/** A batch event says nothing about one item, so it can only prompt a re-read. */
export async function payoutBatchWebhook(batchId: string): Promise<boolean> {
  const found = paymentForBatch(batchId);
  if (!found) return false;
  await syncPayment(found.contract.id, found.kind);
  return true;
}

/** Only the couple whose payment this is can answer its approval. */
export function ownsApproval(planId: string, approval: Approval): boolean {
  const contractId = (approval.input as { contract_id?: string } | null)?.contract_id;
  return !!contractId && findContract(contractId)?.planId === planId;
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
  const view = buildTimeline(listContracts(planId), today, monthlyBudget(planId));
  const items = view.items.map((item) => ({ ...item, approval: pendingApproval(item) }));
  return { ...view, items, nextDue: items.find((i) => i.id === view.nextDue?.id) ?? null, overdue: items.filter((i) => i.status === "overdue"), sandboxStandIn: getEnv().paypalMode === "sandbox" };
}
