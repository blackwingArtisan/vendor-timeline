/**
 * The vendor link: the couple share it, the vendor answers on their phone. One open ask per
 * payment, kept on its contract, found by an unguessable token. The vendor's page shows only that
 * one payment: the vendor, the amount, the dates and the contract's own sentence. Nothing here
 * moves a date or changes who is paid; that waits for the couple's approval (move_due_date).
 * Server only.
 */
import { randomBytes } from "node:crypto";
import { appConfig } from "@/app.config";
import { matchesPattern } from "@/lib/agent/policy";
import { getEnv } from "@/lib/env";
import { HttpError } from "@/lib/http";
import { formatCents } from "./cents";
import { listContractsAll, requirePlanContract, saveContract } from "./contracts";
import { addDays, formatDay, isCalendarDay, utcToday } from "./dates";
import { moveDayRange } from "./limits";
import type { Contract, ItemKind, VendorAsk } from "./types";
import type { ReplyAnswer, VendorReply } from "./vendor-reply";

export const TOKEN_PATTERN = /^[A-Za-z0-9_-]{24}$/;
const newToken = () => randomBytes(18).toString("base64url");

const dueOf = (contract: Contract, kind: ItemKind) => (kind === "deposit" ? contract.confirmed?.depositDue : contract.confirmed?.balanceDue) ?? null;
const centsOf = (contract: Contract, kind: ItemKind) => (kind === "deposit" ? contract.confirmed!.depositCents : contract.confirmed!.balanceCents);

/** The couple's "Share the ask". The same payment and date give the same link again. */
export function openAsk(planId: string, contractId: string, kind: ItemKind, askedTo: string, today = utcToday()): VendorAsk {
  const contract = requirePlanContract(planId, contractId);
  const due = dueOf(contract, kind);
  if (!contract.confirmed || !due) throw new HttpError(409, `This contract has no ${kind} to move.`, "conflict");
  const payment = contract.payments[kind];
  if (payment && payment.state !== "failed") throw new HttpError(409, `This ${kind} has already gone to payment, so its date can't move.`, "conflict");
  const range = moveDayRange(today, contract.proposed.eventDate.value);
  if (!isCalendarDay(askedTo) || askedTo <= today || askedTo > range.to) throw new HttpError(422, `Ask for a date from ${formatDay(addDays(today, 1))} to ${formatDay(range.to)}.`, "rule");
  const existing = contract.asks?.[kind];
  if (existing && existing.askedTo === askedTo && existing.fromDue === due && !existing.movedTo) return existing;
  const ask: VendorAsk = { token: newToken(), askedTo, fromDue: due, createdAt: new Date().toISOString() };
  saveContract({ ...contract, asks: { ...contract.asks, [kind]: ask } });
  return ask;
}

/** The contract and payment a token belongs to, or a 404 that says nothing about any other plan. */
export function findAsk(token: string): { contract: Contract; kind: ItemKind; ask: VendorAsk } {
  if (TOKEN_PATTERN.test(token)) {
    for (const contract of listContractsAll()) {
      for (const kind of ["deposit", "balance"] as const) {
        const ask = contract.asks?.[kind];
        if (ask?.token === token) return { contract, kind, ask };
      }
    }
  }
  throw new HttpError(404, "This link isn't valid any more. Ask the couple for a new one.", "not_found");
}

/** What the vendor's phone shows: this one payment and nothing else of the couple's. */
export interface VendorView {
  vendorName: string;
  kind: ItemKind;
  amount: string;
  fromDue: string;
  askedTo: string;
  weddingDay: string | null;
  sentence: string | null;
  reply: VendorReply | null;
  movedTo: string | null;
  /** In sandbox only sandbox business accounts can be paid, so the page says so. */
  sandbox: boolean;
}

export function vendorView(token: string): VendorView {
  const { contract, kind, ask } = findAsk(token);
  const terms = contract.confirmed!;
  return {
    vendorName: terms.vendorName,
    kind,
    amount: formatCents(centsOf(contract, kind)),
    fromDue: ask.fromDue,
    askedTo: ask.askedTo,
    weddingDay: contract.proposed.eventDate.value,
    sentence: (kind === "deposit" ? contract.proposed.depositDue.sentence : contract.proposed.balanceDue.sentence) ?? null,
    reply: ask.reply ?? null,
    movedTo: ask.movedTo ?? null,
    sandbox: getEnv().paypalMode === "sandbox",
  };
}

/** Null when the app could pay this email, otherwise what to tell the vendor. */
export function payeeProblem(email: string): string | null {
  const sandbox = getEnv().paypalMode === "sandbox";
  const allowed = sandbox ? /^[^@\s]+@business\.example\.com$/i.test(email) : (appConfig.agentPolicy.allowedCounterparties ?? []).some((p) => matchesPattern(email, p));
  if (allowed) return null;
  return sandbox ? "This copy of the app runs on PayPal's sandbox, so it can only pay a sandbox business account (name@business.example.com)." : "This copy of the app can only pay example addresses (name@example.com).";
}

/** The vendor's answer. They can change it until the couple act on it. */
export function saveReply(token: string, body: { answer: ReplyAnswer; text?: string; paypalEmail?: string }): VendorReply {
  const { contract, kind, ask } = findAsk(token);
  if (ask.movedTo) throw new HttpError(409, `The couple already moved this payment to ${formatDay(ask.movedTo)}.`, "conflict");
  const text = (body.text ?? "").trim();
  if (body.answer === "other" && !text) throw new HttpError(422, "Say which date works for you.", "rule");
  const email = body.paypalEmail?.trim() || undefined;
  const problem = email ? payeeProblem(email) : null;
  if (problem) throw new HttpError(422, problem, "rule");
  const reply: VendorReply = { answer: body.answer, text, paypalEmail: email, at: new Date().toISOString() };
  saveContract({ ...contract, asks: { ...contract.asks, [kind]: { ...ask, reply, verdict: undefined } } });
  return reply;
}
