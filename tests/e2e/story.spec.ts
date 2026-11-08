/**
 * The first screen makes the case: the researched headline with The Knot named, the sample
 * wedding's real cash warning worked out by the app's code, and the pain points with their sources.
 * Runs on mock PayPal, on the sandbox and against the hosted copy. No AI and no PayPal calls.
 */
import { expect, test } from "@playwright/test";
import { CATERER, FLORIST, PHOTOGRAPHER } from "../../src/lib/wedding/samples";
import { KNOT_2026, PAIN_POINTS } from "../../src/lib/wedding/story";

/** Claims the research found no evidence for. None may appear on the first screen. */
const UNSUPPORTED = /missed (a )?(deposit|payment)|lose (a|your) vendor|buyer protection|\bpay any vendor|vendors? (all )?(take|accept) PayPal/i;

test("the landing page leads with the researched figure, the real cash warning and sourced pain points", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("About 13 vendors. Every one with its own payment dates.");
  const figure = page.getByTestId("landing-headline-figure");
  await expect(figure).toContainText("The average US couple hires about 13 wedding vendors");
  await expect(figure.getByRole("link", { name: KNOT_2026.label })).toHaveAttribute("href", KNOT_2026.url);
  await expect(figure).toContainText("10,474 US couples married in 2025");

  // The cash check's own sentence for the sample wedding, not a picture of one.
  const cash = page.getByTestId("landing-cash");
  await expect(cash.getByTestId("landing-cash-warning")).toHaveText("May 2027 needs $15,800.00 across 3 payments, $10,800.00 over your $5,000.00 monthly budget.");
  for (const s of [PHOTOGRAPHER, FLORIST, CATERER]) await expect(cash).toContainText(`${s.vendorName} balance`);
  await expect(cash.getByTestId("landing-cash-plan")).toContainText(`Pay the ${PHOTOGRAPHER.vendorName} balance ($3,600.00) now`);
  await expect(cash.getByTestId("landing-cash-plan")).toContainText(`Ask ${FLORIST.vendorName} to move the balance ($1,740.00) to Sat, Jun 5, 2027`);
  await expect(cash).toContainText("Fictional sample");

  // Every pain point names its sources, and each link is the one the research opened.
  const points = page.getByTestId("pain-point");
  await expect(points).toHaveCount(PAIN_POINTS.length);
  for (const [i, p] of PAIN_POINTS.entries()) {
    const card = points.nth(i);
    await expect(card).toContainText(p.title);
    await expect(card).toContainText(p.answer);
    for (const e of p.evidence) await expect(card.getByRole("link", { name: e.source.label }).first()).toHaveAttribute("href", e.source.url);
  }
  await expect(page.getByTestId("pain-points")).toContainText("They show a problem comes up, not how often it does.");
  expect(await page.locator("body").innerText()).not.toMatch(UNSUPPORTED);
  await page.screenshot({ path: "screenshots/landing-story.png", fullPage: true });
});

test("the landing page fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/");
  await expect(page.getByTestId("landing-cash")).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(390);
});
