/**
 * Dates are calendar days, written YYYY-MM-DD, with no time or time zone. Everything here runs in
 * UTC so a date can never slip by a day. Safe to import in the browser.
 */
const DAY_MS = 24 * 60 * 60 * 1000;
const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

const toUtc = (day: string) => {
  const [y, m, d] = day.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
};

const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/** True only for a real day: 2027-02-30 is not one. */
export function isCalendarDay(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && fromUtc(toUtc(value)) === value;
}

const realDay = (day: string) => (isCalendarDay(day) ? day : null);

/** Reads a day however a contract writes it, because the model sometimes copies it as written. */
export function parseDay(value: string): string | null {
  const text = value.trim().toLowerCase();
  if (isCalendarDay(text)) return text;
  const pad = (n: string | number) => String(n).padStart(2, "0");
  const numeric = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
  if (numeric) return realDay(`${numeric[3]}-${pad(numeric[1])}-${pad(numeric[2])}`);
  const named = text.match(/([a-z]{3,9})\.? (\d{1,2})(?:st|nd|rd|th)?,? (\d{4})$/);
  const month = named ? MONTHS.findIndex((m) => m.startsWith(named[1])) : -1;
  return named && month >= 0 ? realDay(`${named[3]}-${pad(month + 1)}-${pad(named[2])}`) : null;
}

export const addDays = (day: string, days: number) => fromUtc(toUtc(day) + days * DAY_MS);

/** Whole days from `from` to `to`. Negative when `to` is earlier. */
export const daysBetween = (from: string, to: string) => Math.round((toUtc(to) - toUtc(from)) / DAY_MS);

/** "Fri, Dec 18, 2026" */
export const formatDay = (day: string) => new Date(toUtc(day)).toLocaleDateString("en-US", { timeZone: "UTC", weekday: "short", month: "short", day: "numeric", year: "numeric" });

/** "December 2026" */
export const formatMonth = (day: string) => new Date(toUtc(day)).toLocaleDateString("en-US", { timeZone: "UTC", month: "long", year: "numeric" });

export const utcToday = () => fromUtc(Date.now());

/** Today on this device's calendar. In the browser that is the couple's own day. */
export function localToday(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Does this sentence really name this day? Catches a date the model changed while copying it. */
export function sentenceNamesDay(sentence: string, day: string): boolean {
  const [y, m, d] = day.split("-").map(Number);
  const text = sentence.toLowerCase();
  if (text.includes(day)) return true;
  if (new RegExp(`\\b0?${m}[/-]0?${d}[/-](${y}|${y % 100})\\b`).test(text)) return true;
  return text.includes(MONTHS[m - 1].slice(0, 3)) && new RegExp(`\\b0?${d}(st|nd|rd|th)?\\b`).test(text) && text.includes(String(y));
}
