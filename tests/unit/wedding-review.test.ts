import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dollarFigures, formatCents } from "@/lib/wedding/cents";
import { mockExtraction } from "@/lib/wedding/mock-extractions";
import { toProposedTerms } from "@/lib/wedding/review";
import { BAND, CATERER, CATERER_STATED_BALANCE_CENTS, FLORIST, PHOTOGRAPHER, SAMPLES, VENUE, WEDDING_DAY, type SampleFacts } from "@/lib/wedding/samples";
import type { Extraction } from "@/lib/wedding/extraction-schema";

const contractText = (sample: SampleFacts) => fs.readFileSync(path.join("public/sample-contracts", sample.file), "utf8");
const read = (sample: SampleFacts) => toProposedTerms(mockExtraction(contractText(sample)), contractText(sample));

describe("the sample contracts", () => {
  it.each(SAMPLES.map((s) => [s.label, s] as const))("%s: a correct read gives the real numbers", (_, sample) => {
    const terms = read(sample);
    expect(terms.vendorName.value).toBe(sample.vendorName);
    expect(terms.vendorRole).toBe(sample.vendorRole);
    expect(terms.payeeEmail.value).toBe(sample.payeeEmail);
    expect(terms.eventDate.value).toBe(WEDDING_DAY);
    expect(terms.totalCents.value).toBe(sample.totalCents);
    expect(terms.depositCents.value).toBe(sample.depositCents);
    expect(terms.balanceCents.value).toBe(sample.balanceCents);
    expect(terms.depositDue.value).toBe(sample.depositDue);
    expect(terms.balanceDue.value).toBe(sample.balanceDue);
  });

  it.each(SAMPLES.map((s) => [s.label, s] as const))("%s: every source sentence is really in the contract", (_, sample) => {
    const terms = read(sample);
    const all = [terms.vendorName, terms.payeeEmail, terms.eventDate, terms.totalCents, terms.depositCents, terms.depositDue, terms.balanceCents, terms.balanceDue];
    expect(all.flatMap((t) => t.flags).filter((f) => f.includes("word for word"))).toEqual([]);
    expect(all.flatMap((t) => t.flags).filter((f) => f.includes("isn't in the sentence"))).toEqual([]);
    for (const t of [terms.totalCents, terms.depositCents, terms.depositDue]) expect(t.sentence).toBeTruthy();
  });

  it("names no real address or live domain", () => {
    for (const sample of SAMPLES) {
      const emails = contractText(sample).match(/\S+@\S+/g) ?? [];
      for (const email of emails) expect(email).toMatch(/\.example\.com\.?$/);
    }
  });

  it("works the photographer's percentage and relative date out in code", () => {
    const terms = read(PHOTOGRAPHER);
    expect(terms.depositCents.basis).toBe("25% of $4,800.00, worked out by the app");
    expect(terms.balanceDue.basis).toBe("30 days before Sat, Jun 12, 2027, worked out by the app");
  });

  it("catches the caterer's balance that doesn't match its own total", () => {
    const terms = read(CATERER);
    expect(terms.balanceCents.value).toBe(CATERER.balanceCents);
    expect(dollarFigures(terms.balanceCents.sentence!)).toContain(CATERER_STATED_BALANCE_CENTS);
    expect(terms.balanceCents.flags).toEqual([`The contract says ${formatCents(CATERER_STATED_BALANCE_CENTS)}, but total minus deposit is ${formatCents(CATERER.balanceCents)}. Ask the vendor which is right.`]);
  });

  it("works out a balance the contract only calls the rest", () => {
    expect(read(VENUE).balanceCents.flags).toEqual([]);
    expect(read(FLORIST).balanceDue.value).toBe("2027-05-29");
  });

  it("flags the band's missing email and unclear balance date, and guesses neither", () => {
    const terms = read(BAND);
    expect(terms.payeeEmail.value).toBeNull();
    expect(terms.payeeEmail.flags.length).toBeGreaterThan(0);
    expect(terms.balanceDue.value).toBeNull();
    expect(terms.balanceDue.flags.join(" ")).toContain("doesn't give a day");
  });
});

describe("what the AI can't be trusted with", () => {
  const contract = "The fee is $1,000.00. A deposit of $200.00 is due on March 3, 2027. The balance of $900.00 is due 10 days before the wedding on June 12, 2027.";
  const base: Extraction = {
    vendor_name: { value: "A Vendor", sentence: null, problem: null },
    vendor_role: "other",
    payee_email: { value: "a@example.com", sentence: null, problem: null },
    event_date: { value: "2027-06-12", sentence: null, problem: null },
    signing_date: { value: null, sentence: null, problem: null },
    total: { written: "$1,000.00", sentence: "The fee is $1,000.00.", problem: null },
    deposit: { written: "$200.00", sentence: "A deposit of $200.00 is due on March 3, 2027.", problem: null },
    deposit_due: { timing: "fixed_date", date: "2027-03-03", days: null, sentence: "A deposit of $200.00 is due on March 3, 2027.", problem: null },
    balance: { written: "$900.00", sentence: "The balance of $900.00 is due 10 days before the wedding on June 12, 2027.", problem: null },
    balance_due: { timing: "days_before_event", date: null, days: 10, sentence: "The balance of $900.00 is due 10 days before the wedding on June 12, 2027.", problem: null },
  };

  it("keeps total minus deposit whatever balance the model read", () => {
    const terms = toProposedTerms(base, contract);
    expect(terms.balanceCents.value).toBe(80_000);
    expect(terms.balanceCents.flags[0]).toContain("The contract says $900.00, but total minus deposit is $800.00");
  });

  it("flags a sentence that isn't in the contract", () => {
    const terms = toProposedTerms({ ...base, total: { ...base.total, sentence: "The fee is exactly $1,000.00." } }, contract);
    expect(terms.totalCents.flags[0]).toContain("word for word");
  });

  it("flags a figure that isn't in its sentence", () => {
    const terms = toProposedTerms({ ...base, deposit: { ...base.deposit, written: "$250.00" } }, contract);
    expect(terms.depositCents.value).toBe(25_000);
    expect(terms.depositCents.flags[0]).toContain("isn't in the sentence");
  });

  it("flags a date the model changed while copying it", () => {
    const terms = toProposedTerms({ ...base, deposit_due: { ...base.deposit_due, date: "2027-03-30" } }, contract);
    expect(terms.depositDue.flags[0]).toContain("isn't in the sentence");
  });

  it("never turns an amount it can't read into a number", () => {
    const terms = toProposedTerms({ ...base, total: { ...base.total, written: "about a thousand" } }, contract);
    expect(terms.totalCents.value).toBeNull();
    expect(terms.totalCents.flags.at(-1)).toContain("isn't clear");
    expect(terms.balanceCents.value).toBeNull();
  });

  it("won't take a percentage of a total it doesn't have", () => {
    const terms = toProposedTerms({ ...base, total: { written: null, sentence: null, problem: null }, deposit: { written: "25%", sentence: null, problem: null } }, contract);
    expect(terms.depositCents.value).toBeNull();
    expect(terms.depositCents.flags.at(-1)).toContain("25%");
  });

  it("won't work out a relative date without the day it counts from", () => {
    const terms = toProposedTerms({ ...base, event_date: { value: null, sentence: null, problem: null } }, contract);
    expect(terms.balanceDue.value).toBeNull();
    expect(terms.balanceDue.flags.join(" ")).toContain("wedding day");
    const signing = toProposedTerms({ ...base, deposit_due: { ...base.deposit_due, timing: "on_signing", date: null } }, contract);
    expect(signing.depositDue.value).toBeNull();
  });

  it.each(["June 12, 2027", "Saturday, June 12, 2027", "Jun. 12 2027", "June 12th, 2027", "6/12/2027", "06-12-2027"])("reads a wedding day written %s", (value) => {
    const terms = toProposedTerms({ ...base, event_date: { value, sentence: null, problem: null } }, contract);
    expect(terms.eventDate.value).toBe("2027-06-12");
    expect(terms.eventDate.flags).toEqual([]);
    expect(terms.balanceDue.value).toBe("2027-06-02");
  });

  it("reads a due date written out in words", () => {
    expect(toProposedTerms({ ...base, deposit_due: { ...base.deposit_due, date: "March 3, 2027" } }, contract).depositDue.value).toBe("2027-03-03");
  });

  it("flags a wedding day that isn't in its sentence", () => {
    const terms = toProposedTerms({ ...base, event_date: { value: "2027-06-19", sentence: "The balance of $900.00 is due 10 days before the wedding on June 12, 2027.", problem: null } }, contract);
    expect(terms.eventDate.flags[0]).toContain("isn't in the sentence");
  });

  it.each(["Junuary 12, 2027", "June 31, 2027", "13/40/2027", "next June"])("won't guess a day from %s", (value) => {
    const terms = toProposedTerms({ ...base, event_date: { value, sentence: null, problem: null } }, contract);
    expect(terms.eventDate.value).toBeNull();
    expect(terms.eventDate.flags.join(" ")).toContain("clear wedding day");
  });

  it("refuses a day that doesn't exist", () => {
    const terms = toProposedTerms({ ...base, deposit_due: { ...base.deposit_due, date: "2027-02-30" } }, contract);
    expect(terms.depositDue.value).toBeNull();
  });

  it("carries the model's own doubts through as flags", () => {
    const terms = toProposedTerms({ ...base, deposit: { ...base.deposit, problem: "It could be read two ways." } }, contract);
    expect(terms.depositCents.flags).toContain("It could be read two ways.");
  });

  it("leaves every term flagged for a contract with no fixture", () => {
    const terms = toProposedTerms(mockExtraction("A contract nobody wrote a fixture for."), "A contract nobody wrote a fixture for.");
    expect(terms.totalCents.value).toBeNull();
    expect(terms.depositDue.flags.length).toBeGreaterThan(0);
  });
});
