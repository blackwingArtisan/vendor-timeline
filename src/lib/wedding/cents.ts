/**
 * Money rules. Every amount in the app is integer US cents; PayPal's decimal strings are converted
 * at the edge. Balances and totals are worked out here from confirmed amounts. The AI never
 * states a sum we keep. Safe to import in the browser.
 */
import { fromMinor, toMinor } from "@/lib/money";

const CURRENCY = "USD";
const usd = new Intl.NumberFormat("en-US", { style: "currency", currency: CURRENCY });

export class RuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RuleError";
  }
}

export function assertCents(value: number, label: string) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RuleError(`${label} must be a whole number of cents, got ${value}.`);
}

export const formatCents = (cents: number) => usd.format(cents / 100);
/** An amount for a money box: "4,800.00", the way every other amount reads, without the "$" the box shows. */
export const amountText = (cents: number) => formatCents(cents).replace("$", "");
export const centsToDollars = (cents: number) => fromMinor(cents, CURRENCY);
export const dollarsToCents = (value: string) => toMinor(value, CURRENCY);

/** What a person typed: "1,200.50" or "$1200". Null if it isn't an amount. */
export function parseDollars(input: string): number | null {
  const clean = input.trim().replace(/^\$\s*/, "").replace(/,/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return null;
  return dollarsToCents(clean);
}

/** Always total minus deposit. Nothing else, and never the AI, decides this number. */
export function balanceCents(totalCents: number, depositCents: number): number {
  assertCents(totalCents, "Total");
  assertCents(depositCents, "Deposit");
  if (depositCents > totalCents) throw new RuleError(`The ${formatCents(depositCents)} deposit is more than the ${formatCents(totalCents)} total.`);
  return totalCents - depositCents;
}

/** A contract's percentage of a total, rounded to the cent. */
export function percentOfCents(totalCents: number, percent: number): number {
  assertCents(totalCents, "Total");
  return Math.round((totalCents * percent) / 100);
}

export function sumCents(values: number[]): number {
  return values.reduce((sum, value) => {
    assertCents(value, "Amount");
    return sum + value;
  }, 0);
}

const DOLLARS = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?|\b(\d{1,3}(?:,\d{3})+|\d+)(\.\d{1,2})?\s*(?:dollars|usd)\b/gi;
const PERCENT = /(\d+(?:\.\d+)?)\s*(?:%|percent\b)/gi;

/** Every dollar figure written in a piece of text, in cents. */
export function dollarFigures(text: string): number[] {
  return [...text.matchAll(DOLLARS)].map((m) => dollarsToCents(`${(m[1] ?? m[3]).replace(/,/g, "")}${m[2] ?? m[4] ?? ""}`));
}

export function percentFigures(text: string): number[] {
  return [...text.matchAll(PERCENT)].map((m) => Number(m[1]));
}

export type WrittenAmount = { cents: number } | { percent: number };

/**
 * Reads an amount as a contract wrote it: "$4,800.00", "Two Thousand Dollars ($2,000.00)" or "25%".
 * The model copies the text and this does the reading, so no conversion is left to the model.
 * Null means it can't be read as one amount, which the couple then sees as a flag.
 */
export function parseWrittenAmount(written: string): WrittenAmount | null {
  const dollars = [...new Set(dollarFigures(written))];
  if (dollars.length === 1) return { cents: dollars[0] };
  if (dollars.length > 1) return null;
  const percents = [...new Set(percentFigures(written))];
  return percents.length === 1 ? { percent: percents[0] } : null;
}
