import { describe, expect, it } from "vitest";
import { agentChain, firstSentences, replyAuthor } from "@/lib/wedding/agent-chain";

describe("the agent's step chain", () => {
  it("reads like the run: contracts, clashes, plan, the payment, then the couple", () => {
    expect(agentChain({ reviewed: true, contracts: 5, clashes: 3, moves: 2, payment: "florist deposit", stage: "waiting" })).toEqual(["Read 5 contracts", "3 cash clashes", "Plan with 2 moves", "Florist deposit ready", "Waiting for you"]);
    expect(agentChain({ reviewed: true, contracts: 1, clashes: 1, moves: 1, payment: "caterer balance", stage: "checkout" })).toEqual(["Read 1 contract", "1 cash clash", "Plan with 1 move", "Caterer balance ready", "Pay in PayPal"]);
  });

  it("has no plan link when nothing clashes", () => {
    expect(agentChain({ reviewed: true, contracts: 2, clashes: 0, moves: 0, payment: "band deposit", stage: "waiting" })).toEqual(["Read 2 contracts", "No cash clash", "Band deposit ready", "Waiting for you"]);
  });

  it("ends at the Guard when it refuses, with nothing sent", () => {
    expect(agentChain({ reviewed: true, contracts: 5, clashes: 3, moves: 2, stage: "refused", refusedAmount: "$5,000.00" })).toEqual(["Read 5 contracts", "3 cash clashes", "Plan with 2 moves", "Guard refused $5,000.00", "Nothing sent"]);
  });

  it("says it is reading before the review comes back", () => {
    expect(agentChain({ reviewed: false, contracts: 5, clashes: 3, moves: 2, stage: "working" })).toEqual(["Reading your contracts"]);
  });
});

describe("the model's reply, capped", () => {
  it("keeps two sentences and sets the rest aside", () => {
    const text = "May is the tight month: $15,800.00 against $5,000.00. Paying the photographer early helps. Asking the florist for June 5 helps too. Approve each one.";
    expect(firstSentences(text, 2)).toEqual({ lead: "May is the tight month: $15,800.00 against $5,000.00. Paying the photographer early helps.", rest: "Asking the florist for June 5 helps too. Approve each one." });
  });

  it("leaves a short reply whole", () => {
    expect(firstSentences("Pay the florist first.", 2)).toEqual({ lead: "Pay the florist first.", rest: "" });
  });
});

describe("who wrote the reply on show", () => {
  it("names Claude's model only when Claude ran", () => {
    expect(replyAuthor("Claude Haiku 5.5")).toBe("Claude Haiku 5.5");
    expect(replyAuthor("checked in code, no model needed")).toBe("Checked by code");
    expect(replyAuthor("simulated (AI mock mode)")).toBe("Scripted agent, AI off");
    expect(replyAuthor(undefined)).toBe("Scripted agent, AI off");
  });
});
