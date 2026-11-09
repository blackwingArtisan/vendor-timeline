/**
 * From a vendor's reply to a moved date: read the reply (Claude), check the date (code), and, only
 * once the couple approve, move it and pay the vendor's own PayPal email if they gave one. Server only.
 */
import { HttpError } from "@/lib/http";
import { moveDueDate, requirePlanContract, saveContract } from "./contracts";
import { boundReply, mockReadReply, readReply, type AskFacts, type ReplyVerdict } from "./vendor-reply";
import { payeeProblem } from "./vendor-ask";
import type { Contract, ItemKind, VendorAsk } from "./types";

function askFacts(contract: Contract, kind: ItemKind, ask: VendorAsk): AskFacts {
  return { vendorName: contract.confirmed!.vendorName, kind, fromDue: ask.fromDue, askedTo: ask.askedTo, weddingDay: contract.proposed.eventDate.value };
}

function requireReply(planId: string, contractId: string, kind: ItemKind): { contract: Contract; ask: VendorAsk } {
  const contract = requirePlanContract(planId, contractId);
  const ask = contract.asks?.[kind];
  if (!ask) throw new HttpError(404, `No one was asked to move this ${kind}.`, "not_found");
  if (!ask.reply) throw new HttpError(409, `${contract.confirmed?.vendorName ?? "The vendor"} hasn't replied yet.`, "conflict");
  return { contract, ask };
}

/** Claude reads the reply, code bounds the date, and the verdict is kept on the ask for move_due_date to check. */
export async function readAskReply(planId: string, contractId: string, kind: ItemKind, today: string): Promise<{ contract: Contract; ask: VendorAsk; verdict: ReplyVerdict }> {
  const { contract, ask } = requireReply(planId, contractId, kind);
  const facts = askFacts(contract, kind, ask);
  const { read, mocked } = await readReply(ask.reply!, facts, today);
  const verdict = boundReply(read, facts, today);
  const stored: VendorAsk = { ...ask, verdict: { ok: verdict.ok, date: verdict.ok ? verdict.date : undefined, reason: verdict.ok ? undefined : verdict.reason, answer: read.answer, quote: read.quote, mocked } };
  const saved = saveContract({ ...contract, asks: { ...contract.asks, [kind]: stored } });
  return { contract: saved, ask: stored, verdict };
}

/** What the mock agent will find, worked out before it runs, so its script can follow the same path. */
export function mockVerdict(planId: string, contractId: string, kind: ItemKind, today: string): ReplyVerdict | null {
  try {
    const { contract, ask } = requireReply(planId, contractId, kind);
    const facts = askFacts(contract, kind, ask);
    return boundReply(mockReadReply(ask.reply!, facts), facts, today);
  } catch {
    return null;
  }
}

/** After the couple approve: the date moves, and the vendor's own PayPal email becomes who this contract pays. */
export function applyVendorReply(planId: string, contractId: string, kind: ItemKind, due: string, today: string): Contract {
  const { ask } = requireReply(planId, contractId, kind);
  if (!ask.verdict?.ok || ask.verdict.date !== due) throw new HttpError(409, "That date isn't the one the vendor's reply allows. Nothing moved.", "conflict");
  const moved = moveDueDate(planId, contractId, kind, due, today);
  const email = ask.reply!.paypalEmail;
  const payee = email && !payeeProblem(email) ? { payeeEmail: email } : {};
  return saveContract({ ...moved, confirmed: { ...moved.confirmed!, ...payee }, ...(payee.payeeEmail ? { payeeGivenBy: "vendor" as const } : {}), asks: { ...moved.asks, [kind]: { ...ask, movedTo: due } } });
}
