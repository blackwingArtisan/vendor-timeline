/**
 * A model call that hangs. The SDK waits 45 s a request with one retry, and the app's own deadline
 * ends the call even if the SDK never does. The agent run then fails with a plain message and a
 * log line, and the couple's card shows "Couldn't read the reply. Try again", never a spinner.
 * The client here is a fake whose every request hangs forever.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AI_CALL_DEADLINE_MS, AI_MAX_RETRIES, AI_REQUEST_TIMEOUT_MS, getAnthropic, guardedClaudeCall } from "@/lib/ai/client";
import { getBudget } from "@/lib/ai/budget";
import { AiTimeoutError } from "@/lib/ai/errors";
import { ANSWER_GRACE_MS, READ_FAILED, READ_STALL_MS, readOutcome } from "@/lib/agent/read-outcome";
import { runAgentToCompletion, type AgentRun } from "@/lib/agent/runs";
import { defineAgent } from "@/lib/agent/define";
import { resetEnvCache } from "@/lib/env";
import { resetSingletons, singleton } from "@/lib/singleton";

const saved = { key: process.env.ANTHROPIC_API_KEY, mode: process.env.AI_MODE };
let calls = 0;
const hanging = { beta: { messages: { create: () => (calls++, new Promise(() => {})) } } };

function useLiveAi(client?: unknown) {
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  delete process.env.AI_MODE;
  resetEnvCache();
  resetSingletons("ai:client");
  if (client) singleton("ai:client", () => client);
}

beforeEach(() => {
  calls = 0;
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  if (saved.key === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = saved.key;
  if (saved.mode === undefined) delete process.env.AI_MODE;
  else process.env.AI_MODE = saved.mode;
  resetEnvCache();
  resetSingletons("ai:client");
});

describe("the AI client's limits", () => {
  it("waits 45 s a request and tries once more", () => {
    useLiveAi();
    const client = getAnthropic();
    expect(AI_REQUEST_TIMEOUT_MS).toBe(45_000);
    expect(AI_MAX_RETRIES).toBe(1);
    expect(client.timeout).toBe(45_000);
    expect(client.maxRetries).toBe(1);
    expect(AI_CALL_DEADLINE_MS).toBe(100_000);
  });
});

describe("a model call that hangs", () => {
  it("ends at the deadline with a plain timeout, and gives its reserved spend back", async () => {
    useLiveAi(hanging);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const call = guardedClaudeCall({ model: "claude-haiku-5-5", max_tokens: 100, messages: [{ role: "user", content: "hi" }] }, { feature: "read the vendor's reply" }, (c, p) => c.beta.messages.create(p));
    const outcome = call.then(() => "answered", (e: unknown) => e);
    await vi.advanceTimersByTimeAsync(AI_CALL_DEADLINE_MS - 1);
    expect(getBudget().status().reservedUsd).toBeGreaterThan(0);
    await vi.advanceTimersByTimeAsync(2);
    const error = await outcome;
    expect(error).toBeInstanceOf(AiTimeoutError);
    expect((error as Error).message).toBe("Claude didn't answer in time, so this stopped. Try again.");
    expect(getBudget().status().reservedUsd).toBe(0);
    expect(errors.mock.calls.flat().join(" ")).toContain("[ai] read the vendor's reply (claude-haiku-5-5) failed: AiTimeoutError");
  });

  it("fails the agent run with that message and logs it, and the card shows the retry, not a spinner", async () => {
    useLiveAi(hanging);
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const agent = defineAgent({ id: "reply-test", name: "Reply agent", description: "test", system: "Read the vendor's reply.", tools: () => [] });
    const run: AgentRun = { id: "run_hangtest", agentId: agent.id, agentName: agent.name, channel: "test-hang", goal: "Read the reply.", mode: "claude", status: "running", startedAt: new Date().toISOString(), costUsd: 0 };
    const done = runAgentToCompletion(agent, { goal: run.goal }, run);
    const startedAt = Date.now();

    // Still going: the card reads on, for now.
    await vi.advanceTimersByTimeAsync(30_000);
    expect(run.status).toBe("running");
    expect(readOutcome({ run, answered: false, startedAt, completedSeenAt: null, now: startedAt + 30_000 })).toBe("reading");

    await vi.advanceTimersByTimeAsync(AI_CALL_DEADLINE_MS);
    await done;
    expect(calls).toBe(1);
    expect(run.status).toBe("failed");
    expect(run.error).toBe("Claude didn't answer in time, so this stopped. Try again.");
    expect(errors.mock.calls.flat().join(" ")).toMatch(/\[agent\] run run_hangtest Reply agent \(claude\) failed after [\d.]+s: Claude didn't answer in time/);
    // What the couple's card does with that run: the failure, with its retry.
    expect(readOutcome({ run, answered: false, startedAt, completedSeenAt: null, now: Date.now() })).toBe("failed");
    expect(READ_FAILED).toBe("Couldn't read the reply. Try again.");
  });
});

describe("what the couple's card shows while the agent reads", () => {
  const base = { answered: false, startedAt: 0, completedSeenAt: null, now: 10_000 };

  it("reads on while the run is going", () => {
    expect(readOutcome({ ...base, run: { status: "running" } })).toBe("reading");
  });

  it("shows the answer once there is one, whatever the run says", () => {
    expect(readOutcome({ ...base, answered: true, run: null })).toBe("answered");
    expect(readOutcome({ ...base, answered: true, run: { status: "failed" } })).toBe("answered");
  });

  it("fails a failed run, and one the server no longer knows (a restart)", () => {
    expect(readOutcome({ ...base, run: { status: "failed" } })).toBe("failed");
    expect(readOutcome({ ...base, run: null })).toBe("failed");
  });

  it("fails a run that finished without an answer, after the answer has had time to arrive", () => {
    expect(readOutcome({ ...base, run: { status: "completed" }, completedSeenAt: 9_000 })).toBe("reading");
    expect(readOutcome({ ...base, run: { status: "completed" }, completedSeenAt: 10_000 - ANSWER_GRACE_MS - 1 })).toBe("failed");
  });

  it("fails a run still going after the stall limit", () => {
    expect(readOutcome({ ...base, run: { status: "running" }, now: READ_STALL_MS })).toBe("reading");
    expect(readOutcome({ ...base, run: { status: "running" }, now: READ_STALL_MS + 1 })).toBe("failed");
  });
});
