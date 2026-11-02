/** Contract records, kept in the kit's JSON store. Server only. */
import { randomUUID } from "node:crypto";
import { HttpError } from "@/lib/http";
import { collection } from "@/lib/store/collection";
import { balanceCents, RuleError } from "./cents";
import { isCalendarDay } from "./dates";
import { readContract } from "./extract";
import type { ConfirmedTerms, Contract, ItemKind } from "./types";

const contracts = () => collection<Contract>("contracts");

export async function addContract(planId: string, input: { text: string; fileName?: string }): Promise<Contract> {
  const { proposed, read } = await readContract(input.text);
  return contracts().upsert({ id: `ctr_${randomUUID().slice(0, 8)}`, planId, createdAt: new Date().toISOString(), payments: {}, proposed, read, ...input });
}

export const listContracts = (planId: string) =>
  contracts()
    .list()
    .filter((c) => c.planId === planId)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));

export const findContract = (id: string) => contracts().get(id);

export function requireContract(id: string): Contract {
  const contract = findContract(id);
  if (!contract) throw new HttpError(404, `Contract ${id} not found`, "not_found");
  return contract;
}

/** Another visitor's contract looks exactly like one that doesn't exist. */
export function requirePlanContract(planId: string, id: string): Contract {
  const contract = requireContract(id);
  if (contract.planId !== planId) throw new HttpError(404, `Contract ${id} not found`, "not_found");
  return contract;
}

export const saveContract = (contract: Contract) => contracts().upsert(contract);

export const contractWithBatch = (batchId: string) => contracts().list().find((c) => Object.values(c.payments).some((p) => p.batchId === batchId));

export type ConfirmInput = Omit<ConfirmedTerms, "balanceCents">;

/** The couple's word. The balance is worked out here, whatever anyone said it was. */
export function confirmContract(planId: string, id: string, input: ConfirmInput): Contract {
  const contract = requirePlanContract(planId, id);
  if (contract.confirmed) throw new HttpError(409, "This contract is already confirmed.", "conflict");
  try {
    const balance = balanceCents(input.totalCents, input.depositCents);
    if (balance > 0 && !input.balanceDue) throw new RuleError("Enter the date the balance is due.");
    const confirmed: ConfirmedTerms = { ...input, balanceCents: balance, balanceDue: balance > 0 ? input.balanceDue : null };
    return saveContract({ ...contract, confirmed, confirmedAt: new Date().toISOString() });
  } catch (e) {
    throw e instanceof RuleError ? new HttpError(422, e.message, "rule") : e;
  }
}

/**
 * The couple move a payment, from the chart or the list. The amount never changes with it. A date
 * that is on its way to PayPal stays put, so a payment can't change under an approval.
 */
export function moveDueDate(planId: string, id: string, kind: ItemKind, due: string): Contract {
  const contract = requirePlanContract(planId, id);
  const terms = contract.confirmed;
  if (!terms) throw new HttpError(409, "Confirm this contract before moving its dates.", "conflict");
  if (!isCalendarDay(due)) throw new HttpError(422, "Enter a real date.", "rule");
  const current = kind === "deposit" ? terms.depositDue : terms.balanceDue;
  if (!current) throw new HttpError(409, `This contract has no ${kind} to move.`, "conflict");
  const payment = contract.payments[kind];
  if (payment && payment.state !== "failed") throw new HttpError(409, `This ${kind} has already gone to payment, so its date can't move.`, "conflict");
  if (due === current) return contract;
  const original = contract.movedFrom?.[kind] ?? current;
  const movedFrom = { ...contract.movedFrom };
  if (due === original) delete movedFrom[kind];
  else movedFrom[kind] = original;
  return saveContract({ ...contract, movedFrom, confirmed: { ...terms, ...(kind === "deposit" ? { depositDue: due } : { balanceDue: due }) } });
}
