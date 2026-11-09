/**
 * "Assign to a parent": the couple hand one payment to someone who wants to pay it, such as a
 * parent. The couple share a link; the parent opens it and asks to pay; the couple still approve
 * that payment in the app (the same Guard and approval as any payment); then the parent pays the
 * vendor in their own PayPal checkout. The payee is still the contract's, and the amount still the
 * confirmed term: the contributor's page can't change either. The link shows only that one payment.
 * Server only.
 */
import { randomBytes } from "node:crypto";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { formatCents } from "./cents";
import { listContractsAll, requirePlanContract, saveContract } from "./contracts";
import { captureCheckout, planChannel, requestPayment } from "./pay";
import type { Contract, Contributor, ItemKind, Payment } from "./types";

export const CONTRIBUTOR_TOKEN = /^[A-Za-z0-9_-]{24}$/;
/** A first name or what the couple call them: letters, spaces, apostrophes, dots and hyphens. */
const NAME = /^[\p{L}\p{M}][\p{L}\p{M}' .-]{0,39}$/u;
const newToken = () => randomBytes(18).toString("base64url");

const centsOf = (contract: Contract, kind: ItemKind) => (kind === "deposit" ? contract.confirmed!.depositCents : contract.confirmed!.balanceCents);
const dueOf = (contract: Contract, kind: ItemKind) => (kind === "deposit" ? contract.confirmed!.depositDue : contract.confirmed!.balanceDue) ?? null;

/** The couple's "Assign": the same payment keeps its link, and a new name just renames it. */
export function assignContributor(planId: string, contractId: string, kind: ItemKind, rawName: string): Contributor {
  const contract = requirePlanContract(planId, contractId);
  if (!contract.confirmed || centsOf(contract, kind) <= 0) throw new HttpError(409, `This contract has no ${kind} to pay.`, "conflict");
  const payment = contract.payments[kind];
  if (payment && payment.state !== "failed") throw new HttpError(409, `This ${kind} already has a payment, so it can't go to someone else.`, "conflict");
  const name = rawName.trim().replace(/\s+/g, " ");
  if (!NAME.test(name)) throw new HttpError(422, "Give their name, like Linda or Mom: letters only, up to 40.", "rule");
  const existing = contract.contributors?.[kind];
  const contributor: Contributor = { token: existing?.token ?? newToken(), name, createdAt: existing?.createdAt ?? new Date().toISOString() };
  saveContract({ ...contract, contributors: { ...contract.contributors, [kind]: contributor } });
  return contributor;
}

/** The couple take it back. Not once the contributor's payment is under way. */
export function unassignContributor(planId: string, contractId: string, kind: ItemKind): void {
  const contract = requirePlanContract(planId, contractId);
  const contributor = contract.contributors?.[kind];
  if (!contributor) return;
  const payment = contract.payments[kind];
  if (payment?.payer?.token === contributor.token && payment.state !== "failed") throw new HttpError(409, `${contributor.name} has already started paying this ${kind}.`, "conflict");
  const rest = { ...contract.contributors };
  delete rest[kind];
  saveContract({ ...contract, contributors: rest });
}

/** The payment a contributor link belongs to, or a 404 that says nothing about any other plan. */
export function findContribution(token: string): { contract: Contract; kind: ItemKind; contributor: Contributor } {
  if (CONTRIBUTOR_TOKEN.test(token)) {
    for (const contract of listContractsAll()) {
      for (const kind of ["deposit", "balance"] as const) {
        const contributor = contract.contributors?.[kind];
        if (contributor?.token === token && contract.confirmed) return { contract, kind, contributor };
      }
    }
  }
  throw new HttpError(404, "This link isn't valid any more. Ask the couple for a new one.", "not_found");
}

export type ContributionState = "open" | "waiting" | "checkout" | "sending" | "paid" | "taken";

/** What the contributor's page shows: this one payment and nothing else of the couple's. */
export interface ContributorView {
  name: string;
  vendorName: string;
  kind: ItemKind;
  amount: string;
  due: string | null;
  state: ContributionState;
  orderId: string | null;
  /** PayPal's own checkout page for this order (sandbox), once the couple approved. */
  checkoutUrl: string | null;
  captureId: string | null;
  payee: string | null;
  error: string | null;
  sandbox: boolean;
}

function stateOf(payment: Payment | undefined, token: string): ContributionState {
  if (!payment || payment.state === "failed") return "open";
  if (payment.payer?.token !== token) return "taken";
  if (payment.state === "awaiting_approval") return "waiting";
  if (payment.state === "awaiting_checkout") return "checkout";
  return payment.state;
}

export function contributorView(token: string): ContributorView {
  const { contract, kind, contributor } = findContribution(token);
  const payment = contract.payments[kind];
  const mine = payment?.payer?.token === token ? payment : undefined;
  const sandbox = getEnv().paypalMode === "sandbox";
  return {
    name: contributor.name,
    vendorName: contract.confirmed!.vendorName,
    kind,
    amount: formatCents(centsOf(contract, kind)),
    due: dueOf(contract, kind),
    state: stateOf(payment, token),
    orderId: mine?.orderId ?? null,
    checkoutUrl: sandbox && mine?.state === "awaiting_checkout" ? (mine.checkoutUrl ?? null) : null,
    captureId: mine?.captureId ?? null,
    payee: mine?.payee ?? null,
    error: mine?.state === "failed" ? (mine.error ?? null) : null,
    sandbox,
  };
}

/**
 * The contributor asks to pay. This is the same request as the couple's Pay button: it stops at the
 * couple's approval, on their timeline, and no order exists before it.
 */
export function contributorPay(token: string): ContributorView {
  const { contract, kind, contributor } = findContribution(token);
  requestPayment(contract.planId, contract.id, kind, planChannel(contract.planId), { name: contributor.name, token });
  return contributorView(token);
}

/** PayPal sent the contributor back from their checkout. Only their own order on this payment is captured. */
export async function contributorCapture(token: string, orderId: string): Promise<ContributorView> {
  const { contract, kind } = findContribution(token);
  if (contract.payments[kind]?.payer?.token !== token) throw new HttpError(409, "That PayPal checkout isn't for this link, so nothing was taken.", "conflict");
  await captureCheckout(contract.planId, contract.id, kind, orderId);
  return contributorView(token);
}
