/**
 * "Add to calendar" downloads the plan's unpaid payments as an .ics file: one all-day event per
 * unpaid deposit or balance, named with the vendor and the amount. Runs on mock PayPal, the
 * sandbox and the hosted copy, with no AI and no payment.
 */
import fs from "node:fs";
import { expect, test } from "@playwright/test";
import { formatCents } from "../../src/lib/wedding/cents";
import { SAMPLES } from "../../src/lib/wedding/samples";
import { parseIcs } from "../support/parse-ics";

test("Add to calendar gives one event per unpaid payment, with the vendor and the amount", async ({ page }) => {
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(SAMPLES.length * 2);
  const button = page.getByTestId("add-to-calendar");
  await expect(button).toBeVisible();
  await expect(button).toHaveText("Add to calendar");

  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toBe("wedding-payments.ics");
  const text = fs.readFileSync((await download.path())!, "utf8");
  const { events } = parseIcs(text);

  // The same plan, as the timeline shows it: every unpaid payment, and nothing paid.
  const { items } = await (await page.request.get("/api/timeline")).json();
  const unpaid = (items as { vendorName: string; kind: string; cents: number; due: string; status: string }[]).filter((i) => i.status !== "paid");
  expect(events).toHaveLength(unpaid.length);
  const shown = events.map((e) => `${e["DTSTART;VALUE=DATE"]} ${e.SUMMARY}`).sort();
  expect(shown).toEqual(unpaid.map((i) => `${i.due.replaceAll("-", "")} Pay ${i.vendorName} ${i.kind}, ${formatCents(i.cents)}`).sort());
  for (const s of SAMPLES) expect(events.some((e) => e.SUMMARY.includes(s.vendorName))).toBe(true);

  // The file is served as a calendar, not cached.
  const res = await page.request.get("/api/timeline.ics");
  expect(res.headers()["content-type"]).toContain("text/calendar");
  expect(res.headers()["cache-control"]).toContain("no-store");
});
