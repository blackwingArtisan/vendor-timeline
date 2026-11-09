import { describe, expect, it } from "vitest";
import { startOwnPlan } from "@/lib/wedding/budget";
import { listContracts, termPayee } from "@/lib/wedding/contracts";
import { loadSampleWedding } from "@/lib/wedding/demo";
import { FLORIST } from "@/lib/wedding/samples";
import { findAsk, openAsk, saveReply, vendorView } from "@/lib/wedding/vendor-ask";
import { applyVendorReply, readAskReply } from "@/lib/wedding/vendor-move";
import { requestPayment, vendorOrder } from "@/lib/wedding/pay";
import { boundReply, mockReadReply, type AskFacts } from "@/lib/wedding/vendor-reply";

const TODAY = "2026-11-09";
/** The florist's balance: due May 29, asked for Jun 5, wedding Jun 12. */
const ASK: AskFacts = { vendorName: FLORIST.vendorName, kind: "balance", fromDue: "2027-05-29", askedTo: "2027-06-05", weddingDay: "2027-06-12" };

describe("reading a vendor's reply (the mock fixture: what Claude should return)", () => {
  it.each([
    [{ answer: "other", text: "The 5th is tight, the 8th is fine" }, { answer: "other_date", date: "2027-06-08", quote: "the 8th is fine" }],
    [{ answer: "agreed", text: "" }, { answer: "agreed", date: "2027-06-05", quote: "" }],
    [{ answer: "agreed", text: "Sure, June 5 works for us" }, { answer: "agreed", date: "2027-06-05", quote: "June 5 works" }],
    [{ answer: "other", text: "Could we do Jun 9th instead?" }, { answer: "other_date", date: "2027-06-09", quote: "Could we do Jun 9th instead?" }],
    [{ answer: "declined", text: "Sorry, we need it on the 29th" }, { answer: "declined", date: null, quote: "Sorry, we need it on the 29th" }],
    [{ answer: "other", text: "Let me check and get back to you" }, { answer: "unclear", date: null, quote: "Let me check and get back to you" }],
  ] as const)("%o reads as %o", (reply, expected) => {
    const read = mockReadReply(reply, ASK);
    expect(read.answer).toBe(expected.answer);
    expect(read.date).toBe(expected.date);
    if (expected.quote) expect(read.quote.toLowerCase()).toContain(expected.quote.toLowerCase());
  });
});

describe("code decides whether a date read from a reply may be used", () => {
  const read = (date: string | null, answer: "agreed" | "declined" | "other_date" | "unclear" = "other_date") => ({ answer, date, quote: "" });

  it("allows a date before the wedding, inside the move range", () => {
    expect(boundReply(read("2027-06-08"), ASK, TODAY)).toMatchObject({ ok: true, date: "2027-06-08" });
  });

  it.each([
    [read("2027-06-12"), "isn't before the wedding on Sat, Jun 12, 2027"],
    [read("2027-07-01"), "isn't before the wedding"],
    [read("2026-11-01"), "isn't after today"],
    [read(TODAY), "isn't after today"],
    [read("2029-01-01"), "later than the app lets a payment move"],
    [read("2027-02-30"), "isn't a real date"],
    [read("2027-05-29"), "already due"],
    [read(null, "declined"), "said no"],
    [read(null, "unclear"), "doesn't give a date"],
  ])("refuses %o", (r, reason) => {
    const verdict = boundReply(r, ASK, TODAY);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toContain(reason);
  });

  it("a refused date never moves the payment, and an allowed one moves only once approved", async () => {
    const plan = `plan_test${Math.random().toString(36).slice(2, 10)}`;
    startOwnPlan(plan);
    loadSampleWedding(plan);
    const florist = listContracts(plan).find((c) => c.confirmed?.vendorRole === "florist")!;
    const ask = openAsk(plan, florist.id, "balance", "2027-06-05", TODAY);
    expect(openAsk(plan, florist.id, "balance", "2027-06-05", TODAY).token).toBe(ask.token);
    expect(vendorView(ask.token)).toMatchObject({ vendorName: FLORIST.vendorName, kind: "balance", fromDue: "2027-05-29", askedTo: "2027-06-05", reply: null });

    // After the wedding: read, refused, nothing moves.
    saveReply(ask.token, { answer: "other", text: "How about July 1st?" });
    const refused = await readAskReply(plan, florist.id, "balance", TODAY);
    expect(refused.verdict.ok).toBe(false);
    expect(() => applyVendorReply(plan, florist.id, "balance", "2027-07-01", TODAY)).toThrow(/Nothing moved/);
    expect(findAsk(ask.token).contract.confirmed!.balanceDue).toBe("2027-05-29");

    // The 8th, with the vendor's own PayPal email.
    saveReply(ask.token, { answer: "other", text: "The 5th is tight, the 8th is fine", paypalEmail: "payments@bramble-vetch.example.com" });
    const allowed = await readAskReply(plan, florist.id, "balance", TODAY);
    expect(allowed.verdict).toMatchObject({ ok: true, date: "2027-06-08" });
    expect(findAsk(ask.token).contract.confirmed!.balanceDue).toBe("2027-05-29");
    // Only the date code allowed can be applied.
    expect(() => applyVendorReply(plan, florist.id, "balance", "2027-06-09", TODAY)).toThrow(/Nothing moved/);
    const moved = applyVendorReply(plan, florist.id, "balance", "2027-06-08", TODAY);
    expect(moved.confirmed).toMatchObject({ balanceDue: "2027-06-08", payeeEmail: FLORIST.payeeEmail });
    expect(moved.vendorPayees).toEqual({ balance: "payments@bramble-vetch.example.com" });
    expect(moved.movedFrom?.balance).toBe("2027-05-29");
    // Only the balance pays the account the vendor gave; the deposit still pays the contract's payee.
    expect(termPayee(moved, "balance")).toBe("payments@bramble-vetch.example.com");
    expect(termPayee(moved, "deposit")).toBe(FLORIST.payeeEmail);
    expect(() => saveReply(ask.token, { answer: "agreed" })).toThrow(/already moved/);
  });

  it("a deposit already waiting for approval still pays the contract's payee after the balance moves to the vendor's account", async () => {
    const plan = `plan_test${Math.random().toString(36).slice(2, 10)}`;
    startOwnPlan(plan);
    loadSampleWedding(plan);
    const florist = listContracts(plan).find((c) => c.confirmed?.vendorRole === "florist")!;
    const { contract: asked } = requestPayment(plan, florist.id, "deposit", "test");
    const ask = openAsk(plan, florist.id, "balance", "2027-06-05", TODAY);
    saveReply(ask.token, { answer: "other", text: "The 5th is tight, the 8th is fine", paypalEmail: "payments@bramble-vetch.example.com" });
    await readAskReply(plan, florist.id, "balance", TODAY);
    const moved = applyVendorReply(plan, florist.id, "balance", "2027-06-08", TODAY);
    // The deposit's order is still the contract's payee, so the Guard's payee check passes.
    const deposit = asked.payments.deposit!;
    expect(deposit.payee).toBe(FLORIST.payeeEmail);
    expect(vendorOrder(moved, "deposit", { cents: deposit.cents, payee: deposit.payee }).purchase_units[0].payee?.email_address).toBe(FLORIST.payeeEmail);
    expect(vendorOrder(moved, "balance", { cents: moved.confirmed!.balanceCents, payee: "payments@bramble-vetch.example.com" }).purchase_units[0].payee?.email_address).toBe("payments@bramble-vetch.example.com");
  });

  it("refuses a PayPal email the app could never pay, and an unknown link", () => {
    const plan = `plan_test${Math.random().toString(36).slice(2, 10)}`;
    startOwnPlan(plan);
    loadSampleWedding(plan);
    const florist = listContracts(plan).find((c) => c.confirmed?.vendorRole === "florist")!;
    const ask = openAsk(plan, florist.id, "balance", "2027-06-05", TODAY);
    expect(() => saveReply(ask.token, { answer: "agreed", paypalEmail: "someone@gmail.com" })).toThrow(/can only pay/);
    expect(() => vendorView("x".repeat(24))).toThrow(/isn't valid/);
    expect(() => vendorView("../../etc")).toThrow(/isn't valid/);
  });
});
