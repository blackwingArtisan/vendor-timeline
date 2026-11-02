import { describe, expect, it } from "vitest";
import { AiBudgetExceededError, AiCreditError, isOutOfCredit, RateLimitedError } from "@/lib/ai/errors";
import { errorResponse } from "@/lib/http";

describe("running out of AI credit", () => {
  it("knows Anthropic's out-of-credit answer", () => {
    expect(isOutOfCredit({ status: 400, message: "400 Your credit balance is too low to access the Anthropic API." })).toBe(true);
    expect(isOutOfCredit({ status: 402, message: "Payment required" })).toBe(true);
  });

  it("leaves other failures alone", () => {
    expect(isOutOfCredit({ status: 400, message: "max_tokens is too large" })).toBe(false);
    expect(isOutOfCredit({ status: 529, message: "Overloaded" })).toBe(false);
    expect(isOutOfCredit(new Error("socket hang up"))).toBe(false);
    expect(isOutOfCredit(undefined)).toBe(false);
  });

  it("reaches the page as a plain 402", async () => {
    const res = errorResponse(new AiCreditError());
    expect(res.status).toBe(402);
    expect((await res.json()).error.message).toContain("run out of credit");
  });

  it("says the daily spending limit in plain words, with no figures", async () => {
    const res = errorResponse(new AiBudgetExceededError(2, 1.99, 0.05));
    expect(res.status).toBe(402);
    const { message } = (await res.json()).error;
    expect(message).toContain("today's AI spending limit");
    expect(message).not.toContain("$");
  });
});

describe("the AI limit's answer", () => {
  it("tells the page how long to wait", async () => {
    const res = errorResponse(new RateLimitedError(42));
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect((await res.json()).error.retryAfterSeconds).toBe(42);
  });

  it("is plain about the day's allowance", () => {
    expect(new RateLimitedError(40_000, "day").message).toContain("today's AI allowance");
  });
});
