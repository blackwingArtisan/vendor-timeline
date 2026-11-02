/** Contract records, kept in the kit's JSON store. Server only. */
import { randomUUID } from "node:crypto";
import { HttpError } from "@/lib/http";
import { collection } from "@/lib/store/collection";
import { balanceCents, RuleError } from "./cents";
import { readContract } from "./extract";
import type { ConfirmedTerms, Contract } from "./types";

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

export function requireContract(id: string): Contract {
  const contract = contracts().get(id);
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
