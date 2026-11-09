/**
 * Turns what the model returned into terms the couple can check. Everything that can be checked
 * in code is: each sentence must really be in the contract, each figure and date must be in its
 * sentence, percentages and relative dates are worked out here, and the balance is always total
 * minus deposit. A term that can't be read stays null with a flag. It is never guessed.
 */
import { balanceCents, dollarFigures, formatCents, parseWrittenAmount, percentFigures, percentOfCents } from "./cents";
import { addDays, formatDay, parseDay, sentenceNamesDay } from "./dates";
import type { Extraction } from "./extraction-schema";
import type { ProposedTerm, ProposedTerms } from "./types";

const NOT_FOUND = "This sentence isn't word for word in the contract. Check the contract yourself.";
const FIGURE_NOT_IN_SENTENCE = "That figure isn't in the sentence shown. Check it against the contract.";
const DATE_NOT_IN_SENTENCE = "That date isn't in the sentence shown. Check it against the contract.";

const normalize = (text: string) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();

function sentenceFlags(sentence: string | null, contract: string): string[] {
  return sentence && !normalize(contract).includes(normalize(sentence)) ? [NOT_FOUND] : [];
}

function term<T>(value: T | null, sentence: string | null, contract: string, flags: (string | null)[] = [], basis?: string): ProposedTerm<T> {
  return { value, sentence, basis, flags: [...sentenceFlags(sentence, contract), ...flags.filter((f): f is string => !!f)] };
}

function textTerm(t: Extraction["vendor_name"], contract: string, missing: string): ProposedTerm<string> {
  const value = t.value?.trim() || null;
  return term(value, t.sentence, contract, [t.problem, value ? null : missing]);
}

function emailTerm(t: Extraction["payee_email"], contract: string): ProposedTerm<string> {
  const value = t.value?.trim().toLowerCase() || null;
  const usable = value && /^\S+@\S+\.\S+$/.test(value) ? value : null;
  return term(usable, t.sentence, contract, [t.problem, usable ? null : "The contract gives no email to pay. Ask the vendor."]);
}

function dayValue(t: Extraction["event_date"]): string | null {
  return t.value ? parseDay(t.value) : null;
}

/**
 * The figures the contract gives for its whole price: each paragraph that names the fee, total or
 * price with one dollar figure and isn't about a deposit or balance. Two different ones means the
 * contract states its price two ways, which code catches whatever the model read.
 */
export function feeFigures(contract: string): number[] {
  const paragraphs = contract.split(/\n\s*\n/).map((p) => p.replace(/\s+/g, " "));
  const named = paragraphs.filter((p) => /\b(total|fee|price|guarantee)\b/i.test(p) && !/deposit|retainer|balance|booking payment|final|\brest\b|installment/i.test(p));
  return [...new Set(named.map(dollarFigures).filter((f) => f.length === 1).map((f) => f[0]))];
}

function totalTerm(t: Extraction["total"], contract: string): ProposedTerm<number> {
  const read = t.written ? parseWrittenAmount(t.written) : null;
  const readCents = read && "cents" in read ? read.cents : null;
  const fees = feeFigures(contract);
  const twoWays = fees.length > 1 || (fees.length === 1 && readCents !== null && fees[0] !== readCents);
  const cents = twoWays ? null : readCents;
  if (cents === null) {
    // When the model already named both figures, its own words say it; one flag is enough.
    const said = !!t.problem && new Set(dollarFigures(t.problem)).size > 1;
    const both = twoWays && !said ? `The contract gives its price two ways: ${[...new Set([...fees, ...(readCents === null ? [] : [readCents])])].map(formatCents).join(" and ")}. Ask the vendor which is right, then enter it.` : null;
    return term<number>(null, t.sentence, contract, [t.problem, both ?? (said ? "Ask the vendor which is right, then enter it." : "The contract's total isn't clear. Enter it from the contract.")]);
  }
  return term(cents, t.sentence, contract, [t.problem, t.sentence && !dollarFigures(t.sentence).includes(cents) ? FIGURE_NOT_IN_SENTENCE : null]);
}

function depositTerm(t: Extraction["deposit"], totalCents: number | null, contract: string): ProposedTerm<number> {
  const read = t.written ? parseWrittenAmount(t.written) : null;
  if (!read) return term<number>(null, t.sentence, contract, [t.problem, "The deposit isn't clear. Enter it from the contract."]);
  if ("cents" in read) return term(read.cents, t.sentence, contract, [t.problem, t.sentence && !dollarFigures(t.sentence).includes(read.cents) ? FIGURE_NOT_IN_SENTENCE : null]);
  const figureFlag = t.sentence && !percentFigures(t.sentence).includes(read.percent) ? FIGURE_NOT_IN_SENTENCE : null;
  const percent = { percent: read.percent };
  if (totalCents === null) return { ...term<number>(null, t.sentence, contract, [t.problem, figureFlag, `The deposit is ${read.percent}% of a total that isn't clear. Enter the total and the app works it out.`]), ...percent };
  return { ...term(percentOfCents(totalCents, read.percent), t.sentence, contract, [t.problem, figureFlag], `${read.percent}% of ${formatCents(totalCents)}, worked out by the app`), ...percent };
}

function balanceTerm(t: Extraction["balance"], totalCents: number | null, depositCents: number | null, contract: string): ProposedTerm<number> {
  const statedRead = t.written ? parseWrittenAmount(t.written) : null;
  const stated = statedRead && "cents" in statedRead ? statedRead.cents : null;
  if (totalCents === null || depositCents === null || depositCents > totalCents) {
    return term<number>(null, t.sentence, contract, [t.problem, depositCents !== null && totalCents !== null ? "The deposit is more than the total." : null]);
  }
  const computed = balanceCents(totalCents, depositCents);
  const mismatch = stated !== null && stated !== computed ? `The contract says ${formatCents(stated)}, but total minus deposit is ${formatCents(computed)}. Ask the vendor which is right.` : null;
  return term(computed, t.sentence, contract, [t.problem, mismatch], "Total minus deposit, worked out by the app");
}

function dueTerm(t: Extraction["deposit_due"], label: string, eventDay: string | null, signingDay: string | null, contract: string): ProposedTerm<string> {
  const unclear = `The contract gives no clear date for the ${label}. Ask the vendor and enter it.`;
  const whole = t.days !== null && Number.isInteger(t.days) && t.days >= 0 ? t.days : null;
  switch (t.timing) {
    case "fixed_date": {
      const day = t.date ? parseDay(t.date) : null;
      if (!day) return term<string>(null, t.sentence, contract, [t.problem, unclear]);
      return term(day, t.sentence, contract, [t.problem, t.sentence && !sentenceNamesDay(t.sentence, day) ? DATE_NOT_IN_SENTENCE : null]);
    }
    case "days_before_event": {
      if (whole === null || !eventDay) return term<string>(null, t.sentence, contract, [t.problem, eventDay ? unclear : "This date depends on the wedding day, which the contract doesn't state. Enter it."]);
      return term(addDays(eventDay, -whole), t.sentence, contract, [t.problem], `${whole} days before ${formatDay(eventDay)}, worked out by the app`);
    }
    case "days_after_signing":
    case "on_signing": {
      const days = t.timing === "on_signing" ? 0 : whole;
      if (days === null || !signingDay) return term<string>(null, t.sentence, contract, [t.problem, signingDay ? unclear : "This date depends on the day you signed, which the contract doesn't state. Enter it."]);
      return term(addDays(signingDay, days), t.sentence, contract, [t.problem], days ? `${days} days after ${formatDay(signingDay)}, worked out by the app` : `The day of signing, ${formatDay(signingDay)}`);
    }
    default:
      return term<string>(null, t.sentence, contract, [t.problem, unclear]);
  }
}

export function toProposedTerms(x: Extraction, contract: string): ProposedTerms {
  const eventDay = dayValue(x.event_date);
  const signingDay = dayValue(x.signing_date);
  const totalCents = totalTerm(x.total, contract);
  const depositCents = depositTerm(x.deposit, totalCents.value, contract);
  const balance = balanceTerm(x.balance, totalCents.value, depositCents.value, contract);
  const nothingLeft = balance.value === 0;
  return {
    vendorName: textTerm(x.vendor_name, contract, "The contract doesn't name the vendor. Enter it."),
    vendorRole: x.vendor_role,
    payeeEmail: emailTerm(x.payee_email, contract),
    eventDate: term(eventDay, x.event_date.sentence, contract, [x.event_date.problem, eventDay ? (x.event_date.sentence && !sentenceNamesDay(x.event_date.sentence, eventDay) ? DATE_NOT_IN_SENTENCE : null) : "The contract doesn't give a clear wedding day."]),
    totalCents,
    depositCents,
    depositDue: dueTerm(x.deposit_due, "deposit", eventDay, signingDay, contract),
    balanceCents: balance,
    balanceDue: nothingLeft ? term<string>(null, null, contract) : dueTerm(x.balance_due, "balance", eventDay, signingDay, contract),
  };
}
