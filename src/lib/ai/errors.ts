export class AiUnavailableError extends Error {
  readonly status = 503;
  constructor(message = "AI is in mock mode (no ANTHROPIC_API_KEY) and this call has no mock fixture.") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export class AiBudgetExceededError extends Error {
  readonly status = 402;
  constructor(
    readonly capUsd: number,
    readonly spentUsd: number,
    readonly estimateUsd: number,
  ) {
    super("This copy of the app has reached today's AI spending limit, so AI is off until tomorrow.");
    this.name = "AiBudgetExceededError";
  }
}

/** The Anthropic account behind the app has no credit left. Reads and the agent stop here. */
export class AiCreditError extends Error {
  readonly status = 402;
  constructor() {
    super("The AI has run out of credit, so it can't help right now.");
    this.name = "AiCreditError";
  }
}

/** The API says this with a 400 and these words, and may yet use 402. */
export function isOutOfCredit(error: unknown): boolean {
  const e = error as { status?: unknown; message?: unknown };
  return e?.status === 402 || (e?.status === 400 && /credit balance/i.test(String(e?.message)));
}

export class AiRefusalError extends Error {
  readonly status = 422;
  constructor(
    readonly category: string | null,
    explanation?: string | null,
  ) {
    super(`Claude declined this request${category ? ` (${category})` : ""}${explanation ? `: ${explanation}` : ""}`);
    this.name = "AiRefusalError";
  }
}

export class AiOutputError extends Error {
  readonly status = 502;
  constructor(message: string) {
    super(message);
    this.name = "AiOutputError";
  }
}

export class RateLimitedError extends Error {
  readonly status = 429;
  constructor(
    readonly retryAfterSeconds: number,
    readonly window: "minute" | "day" = "minute",
  ) {
    super(window === "day" ? "This copy of the app has used today's AI allowance. It resets tomorrow." : `Too many requests. Try again in ${retryAfterSeconds}s.`);
    this.name = "RateLimitedError";
  }
}
