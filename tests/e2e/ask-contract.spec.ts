/**
 * "Ask about this contract": a money question is answered from the contract's own words, with the
 * clause quoted and its section, and code's check that those exact words are in the contract. A
 * question the contract doesn't answer shows "Couldn't find that in the contract" and no answer.
 * Runs with mock AI (the matching clause, found by code) and on the hosted copy with live AI
 * (Claude's answer): either way the quote must be the contract's own words.
 */
import { expect, test } from "@playwright/test";
import { CATERER } from "../../src/lib/wedding/samples";

const MOCK_TEXT = /\bmock\b|simulated/i;
/** Spacing and curly quotes aside, as the app compares them. */
const flat = (s: string) => s.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

test("a money question is answered with the contract's own clause and section, checked by code", async ({ page }) => {
  await page.goto("/contracts");
  await expect(page.getByTestId("sample-plan")).toContainText("Sample plan");
  await page.getByTestId("contract-list").getByRole("link", { name: new RegExp(CATERER.vendorName) }).click();
  await page.waitForURL(/\/contracts\/ctr_/);
  const id = page.url().split("/").pop()!;
  const { text } = await (await page.request.get(`/api/contracts/${id}`)).json();

  const box = page.getByTestId("ask-contract");
  await box.getByTestId("contract-question").fill("Is the deposit refundable if we cancel 60 days out?");
  await box.getByTestId("contract-ask").click();
  const answer = box.getByTestId("contract-answer");
  // Live AI: one call, at most 100 s with its retry.
  await expect(answer).toBeVisible({ timeout: 110_000 });
  const quote = await answer.getByTestId("contract-quote").innerText();
  expect(flat(text)).toContain(flat(quote));
  expect(quote).toMatch(/refundable/i);
  await expect(answer.getByTestId("contract-section")).toHaveText("Cancellation");
  await expect(answer.getByTestId("quote-checked")).toHaveText("Code found these exact words in the contract");
  await expect(answer.getByTestId("contract-answer-text")).not.toBeEmpty();
  await expect(page.locator("main")).not.toContainText(MOCK_TEXT);
  await answer.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "screenshots/ask-contract.png" });

  // Not in the contract: no answer at all.
  await box.getByTestId("contract-question").fill("Who parks the guests' cars, and is valet included?");
  await box.getByTestId("contract-ask").click();
  await expect(box.getByTestId("contract-not-found")).toHaveText("Couldn't find that in the contract.", { timeout: 110_000 });
  await expect(box.getByTestId("contract-answer")).toHaveCount(0);
});

test("the API never returns an answer whose quote isn't in the contract", async ({ page }) => {
  await page.goto("/contracts");
  const { contracts } = await (await page.request.get("/api/contracts")).json();
  const caterer = contracts.find((c: { proposed: { vendorName: { value: string } } }) => c.proposed.vendorName.value === CATERER.vendorName);
  const res = await page.request.post(`/api/contracts/${caterer.id}/question`, { data: { question: "How much is the final payment and when is it due?" }, timeout: 110_000 });
  expect(res.ok()).toBe(true);
  const r = await res.json();
  if (r.found) {
    expect(flat(caterer.text)).toContain(flat(r.quote));
    expect(r.section).toMatch(/\S/);
  } else {
    expect(r.message).toBe("Couldn't find that in the contract");
    expect(r).not.toHaveProperty("answer");
  }
  expect((await page.request.post(`/api/contracts/${caterer.id}/question`, { data: { question: "" } })).status()).toBe(400);
});
