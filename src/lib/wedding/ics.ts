/**
 * The unpaid payments as an iCalendar file (RFC 5545), for the couple's own calendar: one all-day
 * event per unpaid deposit or balance on its due date, named with the vendor and the amount. Paid
 * ones are left out. Every figure is the timeline's own; nothing here is written by AI.
 */
import { createHash } from "node:crypto";
import { formatCents } from "./cents";
import type { TimelineItem } from "./types";

const PRODID = "-//Wedding Vendor Timeline//Payment dates//EN";

/** RFC 5545 text: backslash, semicolon and comma escaped; line breaks as \n. */
export function icsText(text: string) {
  return text.replace(/\\/g, "\\\\").replace(/;/g, "\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** Lines longer than 75 octets are folded: CRLF then one space, never inside a UTF-8 character. */
export function foldLine(line: string) {
  const out: string[] = [];
  let current = "";
  let octets = 0;
  for (const ch of line) {
    const size = Buffer.byteLength(ch);
    if (octets + size > (out.length ? 74 : 75)) {
      out.push(current);
      current = "";
      octets = 0;
    }
    current += ch;
    octets += size;
  }
  out.push(current);
  return out.join("\r\n ");
}

const day = (iso: string) => iso.replaceAll("-", "");
const nextDay = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};
const stamp = (now: Date) => now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** The summary a calendar shows: "Pay Bramble & Vetch Floral deposit, $600.00". */
export const eventSummary = (item: TimelineItem) => `Pay ${item.vendorName} ${item.kind}, ${formatCents(item.cents)}`;

export function timelineIcs(items: TimelineItem[], { planId, now = new Date(), origin }: { planId: string; now?: Date; origin?: string }) {
  const unpaid = items.filter((i) => i.status !== "paid");
  const planTag = createHash("sha256").update(planId).digest("hex").slice(0, 16);
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:${PRODID}`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsText("Wedding vendor payments")}`];
  for (const item of unpaid) {
    const description = [
      `${formatCents(item.cents)} ${item.kind} for ${item.vendorName}, due ${item.due}${item.movedFrom ? ` (moved from ${item.movedFrom})` : ""}.`,
      "From your confirmed contract. Pay it from the timeline, through PayPal's checkout.",
      origin ? `${origin}/timeline` : "",
    ].filter(Boolean).join("\n");
    lines.push(
      "BEGIN:VEVENT",
      // Stable per plan and payment, so importing again updates the event instead of adding another.
      // The plan's id is its key, so only a hash of it goes in the file.
      `UID:${item.id}.${planTag}@vendor-timeline`,
      `DTSTAMP:${stamp(now)}`,
      `DTSTART;VALUE=DATE:${day(item.due)}`,
      `DTEND;VALUE=DATE:${day(nextDay(item.due))}`,
      `SUMMARY:${icsText(eventSummary(item))}`,
      `DESCRIPTION:${icsText(description)}`,
      "TRANSP:TRANSPARENT",
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}
