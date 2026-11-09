/**
 * The couple pay a vendor from their own PayPal. Every payment, from the "Pay" button or from the
 * agent, is one call to vendorOrderTool(), so it passes the same limits and then the Guard's human
 * approval. Only then does the app ask PayPal for an order: exactly the confirmed term, payable to
 * the vendor. The couple approve it in PayPal's own checkout, and the server captures it.
 *
 * "Paid" takes PayPal's own record of that capture, read back with GET, plus the verified
 * PAYMENT.CAPTURE.COMPLETED webhook for that capture id. A copy of the app PayPal can't call back
 * (a local one) takes the re-read alone, and the screen says which of the two it was.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { appConfig } from "@/app.config";
import { runTool } from "@/lib/agent/execute";
import { getApprovals, type Approval } from "@/lib/agent/approvals";
import { Guard, type GuardOutcome } from "@/lib/agent/guard";
import { defineTool } from "@/lib/agent/tool";
import { getEnv } from "@/lib/env";
import { timeline, withContext } from "@/lib/events/bus";
import { HttpError } from "@/lib/http";
import { moneyFromMinor } from "@/lib/money";
import { getPayPal } from "@/lib/paypal";
import type { Capture, CreateOrderRequest, Order, PurchaseUnit, WebhookEventEnvelope } from "@/lib/paypal/types";
import { singleton } from "@/lib/singleton";
import { isSamplePlan, monthlyBudget } from "./budget";
import { planMix } from "./plan-mix";
import { centsToDollars, dollarsToCents, formatCents } from "./cents";
import { contractWithPayPalId, findContract, listContracts, requireContract, requirePlanContract, saveContract, termPayee } from "./contracts";
import { formatDay, isCalendarDay, utcToday } from "./dates";
import { PAID_TO_VENDOR_ACCOUNT } from "./samples";
import { appOrigin, isPublicOrigin } from "./origin";
import { buildTimeline, captureState, itemId } from "./timeline";
import { MOVE_TOOL } from "./tool-names";
import type { AskState, Contract, ItemKind, OutsideMethod, Payment, PendingApproval, SandboxPayee, TimelineItem, TimelineView } from "./types";

const RECHECK_MS = 2500;
/** PayPal's webhook took about 15 seconds in the sandbox. A re-read stands on its own after this. */
export const WEBHOOK_WAIT_MS = 60_000;
import { VENDOR_ORDER_TOOL } from "./tool-names";
export { VENDOR_ORDER_TOOL };

/** Payments running in this process. A pending approval dies with the process. */
const activePayments = () => singleton("wedding:active-payments", () => new Set<string>());

/**
 * Who the order pays. The vendors are fictional, so in sandbox a test business account stands in
 * for each one: a separate vendor account for the florist and caterer, the app's own for the rest.
 * The screen says which wherever it shows the payment.
 */
export function orderPayee(vendorEmail: string): string {
  const env = getEnv();
  if (env.paypalMode !== "sandbox") return vendorEmail;
  // A sandbox business account the vendor gave on the couple's link is paid as it is.
  if (SANDBOX_BUSINESS.test(vendorEmail.trim())) return vendorEmail.trim();
  return env.sandboxVendorEmail && PAID_TO_VENDOR_ACCOUNT.has(vendorEmail.trim().toLowerCase()) ? env.sandboxVendorEmail : env.sandboxSellerEmail;
}

/** A PayPal sandbox business account's address. */
const SANDBOX_BUSINESS = /^[^@\s]+@business\.example\.com$/i;

/** In sandbox: which test account an item pays, whether it is the app's own, and whether the vendor gave it. */
export function sandboxPayee(vendorEmail: string, given = false): SandboxPayee | undefined {
  const env = getEnv();
  if (env.paypalMode !== "sandbox") return undefined;
  const email = orderPayee(vendorEmail);
  return { email, own: email.toLowerCase() === env.sandboxSellerEmail.toLowerCase(), ...(given ? { given: true } : {}) };
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
  if (previous?.paidBy === "outside") throw new HttpError(409, `The couple paid this ${kind} outside PayPal, so nothing can be sent for it.`, "conflict");
  if (previous && runId && previous.runId === runId && previous.state === "awaiting_approval") return contract;
  if (activePayments().has(itemId(contractId, kind)) || (previous && previous.state !== "failed")) throw new HttpError(409, `This ${kind} already has a payment.`, "conflict");
  return contract;
}

/** The code limit: a payment is exactly one confirmed term. Nothing an agent asks for changes this. */
function requireTermAmount(contract: Contract, kind: ItemKind, requestedCents: number) {
  const cents = termCents(contract, kind);
  if (requestedCents === cents) return;
  const name = `the confirmed ${kind} of ${formatCents(cents)} for ${contract.confirmed!.vendorName}`;
  const verb = requestedCents > cents ? "is more than" : "doesn't match";
  throw new HttpError(422, `${formatCents(requestedCents)} ${verb} ${name}. Nothing was sent.`, "rule");
}

/**
 * The only order this app asks PayPal for: one confirmed term, in US dollars, payable to that
 * contract's payee. Anything else is refused here, before PayPal hears of it.
 */
export function vendorOrder(contract: Contract, kind: ItemKind, ask: { cents: number; payee: string }, origin = appOrigin()): CreateOrderRequest {
  const terms = contract.confirmed;
  if (!terms) throw new HttpError(409, "Confirm this contract before paying it.", "conflict");
  requireTermAmount(contract, kind, ask.cents);
  const payee = orderPayee(termPayee(contract, kind));
  if (ask.payee.trim().toLowerCase() !== payee.toLowerCase()) throw new HttpError(422, `${ask.payee} isn't who this contract pays. Nothing was sent.`, "rule");
  const id = itemId(contract.id, kind);
  return {
    intent: "CAPTURE",
    purchase_units: [{ reference_id: id, custom_id: id, description: `Wedding ${kind} for ${terms.vendorName}`.slice(0, 127), amount: { currency_code: "USD", value: centsToDollars(ask.cents) }, payee: { email_address: payee } }],
    payment_source: {
      paypal: {
        experience_context: {
          brand_name: terms.vendorName.slice(0, 127),
          landing_page: "GUEST_CHECKOUT",
          user_action: "PAY_NOW",
          shipping_preference: "NO_SHIPPING",
          return_url: `${origin}/timeline?checkout=${encodeURIComponent(id)}`,
          cancel_url: `${origin}/timeline?cancelled=${encodeURIComponent(id)}`,
        },
      },
    },
  };
}

function claimPayment(contract: Contract, kind: ItemKind, runId: string): Contract {
  const previous = contract.payments[kind];
  if (previous?.runId === runId && previous.state === "awaiting_approval") return contract;
  const payment: Payment = {
    runId,
    cents: termCents(contract, kind),
    attempt: previous ? previous.attempt + (previous.orderId ? 1 : 0) : 1,
    state: "awaiting_approval",
    payee: orderPayee(termPayee(contract, kind)),
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
  // Once an order exists it is the couple's to pay in PayPal, so keep it.
  if (outcome.status !== "executed" && payment.state === "awaiting_approval") patchPayment(contractId, kind, { state: "failed", error: outcomeError(outcome) });
}

const OrderInput = z.object({
  contract_id: z.string().min(1).max(40).describe("The contract_id from review_payments"),
  kind: z.enum(["deposit", "balance"]),
  amount: z
    .string()
    .regex(/^\d{1,9}(\.\d{1,2})?$/)
    .describe('US dollars as a decimal string such as "1200.00". It must equal the confirmed term exactly.'),
});
type OrderInput = z.infer<typeof OrderInput>;

/** The only way money can leave this app. It has no payee input: the confirmed contract decides who is paid. */
export function vendorOrderTool(planId: string) {
  return defineTool({
    name: VENDOR_ORDER_TOOL,
    description: "Ask to pay one confirmed deposit or balance to its vendor. This stops at a person's approval and nothing moves before it; then the couple pay it in PayPal's own checkout. The amount must equal the confirmed term exactly, and the app decides who gets paid.",
    risk: "money",
    source: "app",
    schema: OrderInput,
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
      return { amount: moneyFromMinor(payment.cents, "USD"), counterparties: [payment.payee], summary: `Pay ${contract.confirmed!.vendorName} ${formatCents(payment.cents)} for the ${i.kind}` };
    },
    execute: async (i) => {
      // Read again after the wait for a person: what goes to PayPal is the term, not the request.
      const contract = requireContract(i.contract_id);
      const payment = contract.payments[i.kind]!;
      const body = vendorOrder(contract, i.kind, { cents: payment.cents, payee: payment.payee });
      // Fixed for each attempt, so PayPal itself refuses a second order for the same payment.
      const order = await getPayPal().orders.create(body, { requestId: `vt-${contract.id}-${i.kind}-${payment.attempt}` });
      const checkoutUrl = order.links?.find((l) => l.rel === "payer-action" || l.rel === "approve")?.href;
      patchPayment(contract.id, i.kind, { state: "awaiting_checkout", orderId: order.id, orderStatus: order.status, checkoutUrl, error: undefined });
      return { order_id: order.id, status: order.status, note: "A person approved this. Nothing has moved yet: the couple now pay it in PayPal's own checkout." };
    },
    after: (i, outcome, ctx) => settlePayment(i.contract_id, i.kind, ctx.runId, outcome),
  });
}

async function send(planId: string, contractId: string, kind: ItemKind, runId: string, channel: string) {
  const ctx = { runId, actor: "couple", channel, guard: new Guard({ paypal: getPayPal(), policy: appConfig.agentPolicy }) };
  await runTool(vendorOrderTool(planId), { contract_id: contractId, kind, amount: centsToDollars(requireContract(contractId).payments[kind]!.cents) }, ctx);
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

/**
 * The couple paid a deposit or balance outside PayPal, in cash or by cheque, and say so here. The
 * app only records it: no PayPal call, no order, no approval, and the Guard never moves money for it
 * afterwards, because the payment is no longer open (requirePayable refuses it). The amount must be
 * the confirmed term, so the timeline and the cash check stay right.
 */
export function recordPaidOutside(planId: string, contractId: string, kind: ItemKind, paid: { cents: number; paidOn: string; method: OutsideMethod }, today = utcToday()): Contract {
  const contract = requirePayable(planId, contractId, kind);
  const cents = termCents(contract, kind);
  const name = `${contract.confirmed!.vendorName} ${kind}`;
  if (paid.cents !== cents) throw new HttpError(422, `The confirmed ${name} is ${formatCents(cents)}, not ${formatCents(paid.cents)}. Record the full amount you paid, or pay it through PayPal.`, "rule");
  if (!isCalendarDay(paid.paidOn)) throw new HttpError(422, "Enter the day you paid as a real date.", "rule");
  if (paid.paidOn > today) throw new HttpError(422, `${formatDay(paid.paidOn)} hasn't happened yet. Record a payment once it's made.`, "rule");
  const previous = contract.payments[kind];
  const payment: Payment = {
    runId: `outside_${randomUUID().slice(0, 12)}`,
    cents,
    attempt: previous?.attempt ?? 1,
    state: "paid",
    payee: "",
    paidBy: "outside",
    outside: { method: paid.method, paidOn: paid.paidOn, recordedAt: new Date().toISOString() },
  };
  return saveContract({ ...contract, payments: { ...contract.payments, [kind]: payment } });
}

/** Why PayPal's record of an order or capture isn't this payment, or null if it is. */
function amountMismatch(amount: { currency_code: string; value: string } | undefined, payment: Payment): string | null {
  if (!amount) return "it gives no amount";
  if (amount.currency_code !== "USD" || dollarsToCents(amount.value) !== payment.cents) return `PayPal shows ${amount.value} ${amount.currency_code}, not the approved ${centsToDollars(payment.cents)} USD`;
  return null;
}

function orderMismatch(unit: PurchaseUnit | undefined, payment: Payment): string | null {
  const amount = amountMismatch(unit?.amount, payment);
  if (amount) return amount;
  if (unit?.payee?.email_address && unit.payee.email_address.toLowerCase() !== payment.payee.toLowerCase()) return "it pays a different account";
  return null;
}

/** Captures in flight in this process, so a doubled return from PayPal captures once. */
const capturing = () => singleton("wedding:capturing", () => new Set<string>());

/**
 * The couple approved the order in PayPal's checkout and PayPal sent them back. The order is read
 * back first: it must be this payment's order, approved, for the approved amount, to the payee.
 * Only then is it captured. A second return for the same order changes nothing.
 */
export async function captureCheckout(planId: string, contractId: string, kind: ItemKind, orderId: string): Promise<Contract> {
  const contract = requirePlanContract(planId, contractId);
  const payment = contract.payments[kind];
  if (!payment?.orderId || payment.orderId !== orderId) throw new HttpError(409, "That PayPal checkout isn't for this payment, so nothing was taken.", "conflict");
  const key = itemId(contractId, kind);
  if (payment.state !== "awaiting_checkout" || capturing().has(key)) return contract;
  capturing().add(key);
  try {
    requireTermAmount(contract, kind, payment.cents);
    const order = await getPayPal().orders.get(orderId);
    const mismatch = orderMismatch(order.purchase_units?.[0], payment);
    if (mismatch) {
      patchPayment(contractId, kind, { state: "failed", orderStatus: order.status, error: `PayPal's order doesn't match this payment: ${mismatch}. Nothing was captured.` });
      throw new HttpError(422, `PayPal's order doesn't match this payment: ${mismatch}.`, "rule");
    }
    if (order.status !== "APPROVED" && order.status !== "COMPLETED") throw new HttpError(409, "PayPal hasn't had your approval for this payment yet, so nothing was taken. Finish paying in PayPal's checkout, or pay from the timeline to open it again.", "conflict");
    const captured: Order = order.status === "COMPLETED" ? order : await getPayPal().orders.capture(orderId, { requestId: `vt-capture-${contractId}-${kind}-${payment.attempt}` });
    const capture = captured.purchase_units?.[0]?.payments?.captures?.[0];
    patchPayment(contractId, kind, {
      state: capture ? "sending" : "failed",
      orderStatus: captured.status,
      captureId: capture?.id,
      captureStatus: capture?.status,
      error: capture ? undefined : `PayPal reports the order ${captured.status} with no capture.`,
    });
    await syncPayment(contractId, kind).catch(() => undefined); // The timeline keeps following it.
    return requireContract(contractId);
  } finally {
    capturing().delete(key);
  }
}

/** A webhook can only reach a copy of the app with a public address and a PayPal webhook id. */
const webhookExpected = () => getEnv().paypalMode === "mock" || (!!getEnv().paypalWebhookId && isPublicOrigin());

/**
 * Re-reads the capture from PayPal, the only source of its status. The webhook for that capture is
 * what turns that status into paid. See the top of this file for when a webhook can't come.
 */
export async function syncPayment(contractId: string, kind: ItemKind): Promise<void> {
  const payment = requireContract(contractId).payments[kind];
  if (payment?.state !== "sending" || !payment.captureId) return;
  const capture = await getPayPal().payments.getCapture(payment.captureId);
  const amountOff = amountMismatch(capture.amount, payment);
  const reported = amountOff ? "sending" : captureState(capture.status);
  const now = new Date().toISOString();
  const successSeenAt = reported === "paid" ? (payment.successSeenAt ?? now) : undefined;
  const waitedOut = successSeenAt ? !webhookExpected() || Date.now() - Date.parse(successSeenAt) >= WEBHOOK_WAIT_MS : false;
  const webhooked = payment.webhook?.captureId === payment.captureId;
  const paidBy = reported !== "paid" ? undefined : webhooked ? "webhook" : waitedOut ? "re-read" : undefined;
  const state = reported === "paid" && !paidBy ? "sending" : reported;
  patchPayment(contractId, kind, {
    state,
    captureStatus: capture.status,
    error: amountOff ? `${amountOff}.` : state === "failed" ? `PayPal reports the capture ${capture.status}${capture.status_details?.reason ? ` (${capture.status_details.reason})` : ""}.` : undefined,
    checkedAt: now,
    successSeenAt,
    paidBy,
  });
}

function paymentForPayPalId(id: string | undefined) {
  const contract = id ? contractWithPayPalId(id) : undefined;
  const found = contract && Object.entries(contract.payments).find(([, p]) => p.orderId === id || p.captureId === id);
  return found ? { contract, kind: found[0] as ItemKind, payment: found[1] } : null;
}

/** The timeline channel one couple's browser listens on. See /api/events. */
export const planChannel = (planId: string) => `plan:${planId}`;

/** A webhook naming one of a couple's payments goes to that couple only. */
export function webhookPlanChannel(event: { resource: unknown }): string | undefined {
  const r = event.resource as { id?: string; supplementary_data?: { related_ids?: { order_id?: string } } } | null;
  const found = paymentForPayPalId(r?.id) ?? paymentForPayPalId(r?.supplementary_data?.related_ids?.order_id);
  return found ? planChannel(found.contract.planId) : undefined;
}

/** Every PayPal order and capture id that belongs to this couple's payments. */
export function planPayPalIds(planId: string): Set<string> {
  const ids = new Set<string>();
  for (const c of listContracts(planId)) for (const p of Object.values(c.payments)) for (const id of [p.orderId, p.captureId]) if (id) ids.add(id);
  return ids;
}

/** Every agent or payment run that touched this couple's contracts, found from the audit entries. */
export function planRunIds(planId: string, entries: { runId?: string; input?: unknown }[]): Set<string> {
  const contracts = new Set(listContracts(planId).map((c) => c.id));
  const runs = new Set<string>();
  for (const c of listContracts(planId)) for (const p of Object.values(c.payments)) runs.add(p.runId);
  for (const e of entries) {
    const contractId = (e.input as { contract_id?: string } | null)?.contract_id;
    if (e.runId && contractId && contracts.has(contractId)) runs.add(e.runId);
  }
  return runs;
}

/**
 * A capture webhook, already verified by signature. It counts only for this app's own payment, and
 * only if its order, capture and amount are that payment's. Anything else changes nothing.
 * All entries can share one PayPal app, so a capture this app didn't make is ignored.
 */
export async function captureWebhook(event: WebhookEventEnvelope<string, Capture>): Promise<boolean> {
  const capture = event.resource;
  const orderId = capture.supplementary_data?.related_ids?.order_id;
  const found = paymentForPayPalId(capture.id) ?? paymentForPayPalId(orderId);
  if (!found) return false;
  const { contract, kind, payment } = found;
  const mismatch = (orderId && orderId !== payment.orderId ? `it names order ${orderId}` : null) ?? (payment.captureId && payment.captureId !== capture.id ? `it names capture ${capture.id}` : null) ?? amountMismatch(capture.amount, payment);
  if (mismatch) {
    timeline.emit({ kind: "webhook", status: "failed", title: "Capture webhook ignored", detail: `${event.event_type} doesn't match this payment: ${mismatch}.` });
    return false;
  }
  if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
    patchPayment(contract.id, kind, { webhook: { eventId: event.id, eventType: event.event_type, captureId: capture.id, receivedAt: new Date().toISOString() } });
  }
  await syncPayment(contract.id, kind);
  return true;
}

/**
 * "Approve and pay" is one step. After the approval, wait the moment it takes the app to ask PayPal
 * for the order, and hand back PayPal's checkout address so the browser can go straight there.
 * With mock PayPal there is no real page, so only the order id comes back.
 */
export async function checkoutAfterApproval(approval: Approval, waitMs = 30_000): Promise<{ orderId?: string; checkoutUrl?: string; error?: string }> {
  if (approval.tool !== VENDOR_ORDER_TOOL || approval.state !== "approved") return {};
  const { contract_id: contractId, kind } = (approval.input ?? {}) as { contract_id?: string; kind?: ItemKind };
  if (!contractId || (kind !== "deposit" && kind !== "balance")) return {};
  for (const deadline = Date.now() + waitMs; Date.now() < deadline; await new Promise((r) => setTimeout(r, 100))) {
    const payment = findContract(contractId)?.payments[kind];
    if (!payment) return {};
    if (payment.state === "failed") return { error: payment.error };
    if (payment.orderId && payment.state !== "awaiting_approval") return { orderId: payment.orderId, checkoutUrl: getEnv().paypalMode === "sandbox" && payment.state === "awaiting_checkout" ? payment.checkoutUrl : undefined };
  }
  return {};
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

/** The couple's view of a later-date ask: the vendor's reply, code's verdict, and a move waiting for approval. */
function askState(contract: Contract | undefined, item: TimelineItem): AskState | null {
  const ask = contract?.asks?.[item.kind];
  if (!ask) return null;
  const pending = getApprovals()
    .list({ state: "pending" })
    .find((a) => a.tool === MOVE_TOOL && (a.input as { contract_id?: string; kind?: string } | null)?.contract_id === item.contractId && (a.input as { kind?: string }).kind === item.kind);
  return {
    token: ask.token,
    askedTo: ask.askedTo,
    fromDue: ask.fromDue,
    reply: ask.reply ?? null,
    verdict: ask.verdict ?? null,
    movedTo: ask.movedTo ?? null,
    approval: pending ? { id: pending.id, summary: pending.summary, reason: pending.reason } : null,
  };
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
  const byId = new Map(listContracts(planId).map((c) => [c.id, c]));
  const items = view.items.map((item) => {
    const contract = byId.get(item.contractId);
    return { ...item, approval: pendingApproval(item), sandboxPayee: sandboxPayee(contract?.confirmed ? termPayee(contract, item.kind) : "", !!contract?.vendorPayees?.[item.kind]), ask: askState(contract, item) };
  });
  const same = (item: TimelineItem | null) => items.find((i) => i.id === item?.id) ?? null;
  return { ...view, items, nextDue: same(view.nextDue), payFirst: same(view.payFirst), overdue: items.filter((i) => view.overdue.some((o) => o.id === i.id)), sandboxStandIn: getEnv().paypalMode === "sandbox", samplePlan: isSamplePlan(planId), planMix: planMix(listContracts(planId)) };
}
