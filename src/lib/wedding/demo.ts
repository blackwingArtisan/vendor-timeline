/**
 * Loads the five fictional sample contracts into one wedding with no AI spend. Their reads are
 * fixtures made ahead of time, marked `sample`, so the review page and the banner say so. The
 * band's contract leaves its email and balance date blank on purpose, so the sample couple's
 * answers fill those in here.
 */
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { listContracts, confirmContract, saveContract } from "./contracts";
import { mockExtraction } from "./mock-extractions";
import { toProposedTerms } from "./review";
import { BAND_ANSWERS, SAMPLES, type SampleFacts } from "./samples";

const sampleText = (sample: SampleFacts) => fs.readFileSync(path.join(/*turbopackIgnore: true*/ process.cwd(), "public/sample-contracts", sample.file), "utf8");

/** "SALTMEADOW TABLE CATERING" and "Saltmeadow Table Catering" are one vendor. */
const nameKey = (name: string | null | undefined) => (name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * A second click adds nothing: a sample is skipped when the wedding already has its role or its
 * vendor. Claude can read a name as the contract prints it (all capitals), so names are compared
 * without case or punctuation.
 */
export function loadSampleWedding(planId: string): { added: number } {
  const contracts = listContracts(planId);
  const roles = new Set(contracts.map((c) => c.confirmed?.vendorRole ?? c.proposed.vendorRole));
  const names = new Set(contracts.map((c) => nameKey(c.confirmed?.vendorName ?? c.proposed.vendorName.value)));
  const missing = SAMPLES.filter((s) => !roles.has(s.vendorRole) && !names.has(nameKey(s.vendorName)));
  for (const sample of missing) {
    const text = sampleText(sample);
    const contract = saveContract({ id: `ctr_${randomUUID().slice(0, 8)}`, planId, sample: true, createdAt: new Date().toISOString(), payments: {}, proposed: toProposedTerms(mockExtraction(text), text), read: { mocked: true, costUsd: 0 }, text, fileName: sample.file });
    confirmContract(planId, contract.id, {
      vendorName: sample.vendorName,
      vendorRole: sample.vendorRole,
      payeeEmail: sample.payeeEmail ?? BAND_ANSWERS.payeeEmail,
      totalCents: sample.totalCents,
      depositCents: sample.depositCents,
      depositDue: sample.depositDue,
      balanceDue: sample.balanceDue ?? BAND_ANSWERS.balanceDue,
    });
  }
  return { added: missing.length };
}
