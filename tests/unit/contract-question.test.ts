import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { askContract, findQuote, inventedFigures, mockAnswer, NOT_FOUND, sectionOf, verifyAnswer } from "@/lib/wedding/contract-question";

const caterer = fs.readFileSync("public/sample-contracts/caterer.txt", "utf8");
const photographer = fs.readFileSync("public/sample-contracts/photographer.txt", "utf8");
const messy = fs.readFileSync("public/sample-contracts/messy-venue.txt", "utf8");
const by = { by: "Answered by Claude", live: true };
const REFUND_Q = "Is the deposit refundable if we cancel 60 days out?";

describe("quote verification", () => {
  it("finds a quote that is in the contract word for word, and says its section", () => {
    const quote = "The deposit is not refundable within 180 days of the Event.";
    const at = findQuote(caterer, quote)!;
    expect(caterer.slice(at.start, at.end)).toBe(quote);
    const r = verifyAnswer(caterer, REFUND_Q, { answer: "No. 60 days out is within 180 days of the Event, so the deposit is not refundable.", quote }, by);
    expect(r).toMatchObject({ found: true, quote, section: "Cancellation" });
  });

  it("allows curly quotes, other spacing and a clause that wraps across lines", () => {
    expect(findQuote(photographer, "A non‑refundable retainer of 25% of the Total Fee is due on or before December 18, 2026 to reserve the Event Date.")).not.toBeNull();
    expect(findQuote(photographer, "3. Fee. The total fee for the services in this Agreement is $4,800.00 (the \u201CTotal Fee\u201D).")).not.toBeNull();
    expect(findQuote(photographer, "A non-refundable retainer of 25% of   the Total Fee is due on or before\nDecember 18, 2026 to reserve the Event Date")).not.toBeNull();
    const wrapped = messy.split("\n").find((l) => l.startsWith("3. Deposit."))!;
    const next = messy.split("\n")[messy.split("\n").indexOf(wrapped) + 1];
    expect(findQuote(messy, `${wrapped} ${next}`)).not.toBeNull();
  });

  it("names a numbered clause by its number and title", () => {
    const quote = "A non-refundable retainer of 25% of the Total Fee is due on or before December 18, 2026 to reserve the Event Date.";
    expect(verifyAnswer(photographer, "Can we get the retainer back?", { answer: "No, the retainer is non-refundable.", quote }, by)).toMatchObject({ found: true, section: "Section 4, Retainer" });
    expect(sectionOf(caterer, caterer.indexOf("Client shall remit"))).toBe("Terms Of Payment");
  });

  it("rejects a quote that isn't in the contract: no answer, just 'Couldn't find that in the contract'", () => {
    const r = verifyAnswer(caterer, REFUND_Q, { answer: "Yes, a full refund is given up to 30 days before.", quote: "Deposits are fully refundable up to 30 days before the Event." }, by);
    expect(r).toEqual({ found: false, question: REFUND_Q, message: NOT_FOUND, reason: "quote_not_in_contract", ...by });
    expect(r).not.toHaveProperty("answer");
  });

  it("rejects a paraphrase of a real clause", () => {
    const r = verifyAnswer(caterer, REFUND_Q, { answer: "No.", quote: "The deposit cannot be refunded within 180 days of the Event." }, by);
    expect(r).toMatchObject({ found: false, reason: "quote_not_in_contract", message: NOT_FOUND });
    expect(verifyAnswer(caterer, REFUND_Q, { answer: "No.", quote: "the deposit is not refundable within 180 days of the event." }, by)).toMatchObject({ found: false });
  });

  it("rejects a quote too short to prove anything, and an answer with no clause", () => {
    expect(verifyAnswer(caterer, REFUND_Q, { answer: "No.", quote: "deposit" }, by)).toMatchObject({ found: false, reason: "quote_too_short" });
    expect(verifyAnswer(caterer, REFUND_Q, { answer: "", quote: null }, by)).toMatchObject({ found: false, reason: "not_stated" });
    expect(verifyAnswer(caterer, REFUND_Q, { answer: "Probably not.", quote: null }, by)).toMatchObject({ found: false, reason: "not_stated" });
  });

  it("rejects a money answer that brings in an amount or percentage the contract doesn't have", () => {
    const quote = "The deposit is not refundable within 180 days of the Event.";
    expect(verifyAnswer(caterer, REFUND_Q, { answer: "You'd get 50% back, $1,250.00.", quote }, by)).toMatchObject({ found: false, reason: "invented_term" });
    expect(inventedFigures("The deposit is $2,500 and the balance $10,640.00.", caterer, REFUND_Q)).toEqual([]);
    expect(inventedFigures("You'd lose the $2,500.00 deposit, about 19%.", caterer, REFUND_Q)).toEqual(["19%"]);
  });
});

describe("without an AI key", () => {
  it("points to the matching clause, copied exactly, and never makes up a term", async () => {
    expect(mockAnswer(caterer, REFUND_Q).quote).toBe("The deposit is not refundable within 180 days of the Event.");
    const r = await askContract({ text: caterer }, REFUND_Q);
    expect(r).toMatchObject({ found: true, section: "Cancellation", quote: "The deposit is not refundable within 180 days of the Event.", live: false });
    expect(await askContract({ text: caterer }, "Who parks the cars?")).toMatchObject({ found: false, message: NOT_FOUND });
  });

  it("keeps an amount's own full stop inside its sentence", async () => {
    const r = await askContract({ text: caterer }, "When is the final payment due?");
    expect(r).toMatchObject({ found: true, quote: "The final payment of $10,640.00 shall be received by Caterer fourteen (14) calendar days prior to the Event.", section: "Terms Of Payment" });
  });
});
