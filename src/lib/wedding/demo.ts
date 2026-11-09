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

/** A second click adds nothing: vendors already on this wedding are skipped. */
export function loadSampleWedding(planId: string): { added: number } {
  const present = new Set(listContracts(planId).map((c) => c.confirmed?.vendorName ?? c.proposed.vendorName.value));
  const missing = SAMPLES.filter((s) => !present.has(s.vendorName));
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
