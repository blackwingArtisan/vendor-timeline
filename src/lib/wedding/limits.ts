/**
 * What the couple may type, said in plain words. The browser shows these beside the field and the
 * server refuses the same things with the same words, so no request can get past them.
 * Safe to import in the browser.
 */
import { formatCents } from "./cents";
import { addDays, formatDay, isCalendarDay } from "./dates";

/** No one wedding vendor costs more than this. Anything bigger is a typo. */
export const MAX_CONTRACT_CENTS = 100_000_000; // $1,000,000.00
export const MAX_BUDGET_CENTS = 100_000_000; // $1,000,000.00 a month
/** Long enough for a real contract, short enough to keep each AI read cheap. */
export const MAX_CONTRACT_CHARS = 20_000;
/** A deposit can be overdue, but not from years ago. */
const PAST_DAYS = 2 * 365;
/** With no wedding day known, a payment can be at most this far out. */
const NO_WEDDING_DAYS = 3 * 365;

export type Amount = { cents: number; error?: undefined } | { cents?: undefined; error: string };

/** "1,200.50" or "$1200" to cents, or a plain reason it can't be one. Never throws. */
export function readAmount(input: string, label: string, max = MAX_CONTRACT_CENTS): Amount {
  const clean = input.trim().replace(/^\$\s*/, "").replace(/,/g, "");
  if (!clean) return { error: `Enter the ${label.toLowerCase()}.` };
  if (/^-/.test(clean)) return { error: `${label} can't be below zero.` };
  if (!/^\d+(\.\d+)?$/.test(clean)) return { error: `${label} must be an amount in dollars, like 1,200.00.` };
  if (/\.\d{3,}$/.test(clean)) return { error: `${label} can't have more than two digits after the point.` };
  const [whole, part = ""] = clean.split(".");
  if (whole.replace(/^0+/, "").length > 12) return { error: `${label} is too large. The most it can be is ${formatCents(max)}.` };
  const cents = Number(whole) * 100 + Number(part.padEnd(2, "0"));
  if (cents === 0) return { error: `${label} must be more than $0.00.` };
  if (cents > max) return { error: `${label} is too large. The most it can be is ${formatCents(max)}.` };
  return { cents };
}

/** The same rule for a number of cents a request sends. Null when it's fine. */
export function centsProblem(cents: number, label: string, max = MAX_CONTRACT_CENTS): string | null {
  if (!Number.isSafeInteger(cents)) return `${label} must be an amount in dollars, like 1,200.00.`;
  if (cents <= 0) return `${label} must be more than $0.00.`;
  return cents > max ? `${label} is too large. The most it can be is ${formatCents(max)}.` : null;
}

/** The last day a payment can fall on: a year after the wedding, or a few years out with no wedding day. */
export const lastPaymentDay = (today: string, weddingDay?: string | null) => (weddingDay && isCalendarDay(weddingDay) ? addDays(weddingDay, 365) : addDays(today, NO_WEDDING_DAYS));

/** The range a date in a contract can have: a deposit may be past due, but not from years ago. */
export const contractDayRange = (today: string, weddingDay?: string | null) => ({ from: addDays(today, -PAST_DAYS), to: lastPaymentDay(today, weddingDay) });

/** The range a moved payment can go to: from today to a year after the wedding. */
export const moveDayRange = (today: string, weddingDay?: string | null) => ({ from: today, to: lastPaymentDay(today, weddingDay) });

/** Null when the day is a real date in range, otherwise what to tell the couple. */
export function dayProblem(day: string, label: string, range: { from: string; to: string }): string | null {
  if (!isCalendarDay(day)) return `Enter the ${label.toLowerCase()} as a real date.`;
  if (day < range.from || day > range.to) return `${label} must be from ${formatDay(range.from)} to ${formatDay(range.to)}.`;
  return null;
}
