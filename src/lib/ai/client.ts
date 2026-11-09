/**
 * Anthropic client + the guarded call path every AI helper uses:
 *   worst-case estimate -> daily cap reservation -> call -> refusal check -> real cost -> timeline
 *
 * All calls go through `client.beta.messages` so Sonnet 5.5 requests can carry the
 * server-side refusal fallback (beta) without mixing beta and non-beta types.
 */
import Anthropic from "@anthropic-ai/sdk";
import { getEnv } from "../env";
import { startStep } from "../events/bus";
import { singleton } from "../singleton";
import { getBudget } from "./budget";
import { modelLabel, SERVER_FALLBACK } from "./config";
import { actualCostUsd, estimateInputTokens, worstCaseCostUsd } from "./cost";
import { AiCreditError, AiRefusalError, AiTimeoutError, AiUnavailableError, isOutOfCredit } from "./errors";

export type BetaCreateParams = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
export type BetaMessage = Anthropic.Beta.BetaMessage;
export type BetaMessageParam = Anthropic.Beta.BetaMessageParam;

export function isAiLive(): boolean {
  return getEnv().aiMode === "live";
}

/**
 * One request waits at most 45 s and is tried once more, so a call that hangs fails in about a
 * minute and a half instead of six (the SDK's 120 s x 3). A hosted reply read once hung past 150 s.
 */
export const AI_REQUEST_TIMEOUT_MS = 45_000;
export const AI_MAX_RETRIES = 1;
/** The whole call, both tries and the SDK's backoff, ends by this even if the SDK never does. */
export const AI_CALL_DEADLINE_MS = AI_REQUEST_TIMEOUT_MS * (AI_MAX_RETRIES + 1) + 10_000;

export function getAnthropic(): Anthropic {
  const env = getEnv();
  if (env.aiMode !== "live") throw new AiUnavailableError();
  return singleton("ai:client", () => new Anthropic({ apiKey: env.anthropicApiKey, maxRetries: AI_MAX_RETRIES, timeout: AI_REQUEST_TIMEOUT_MS }));
}

/** `work`, or an AiTimeoutError once `ms` have passed without it settling. */
export function withDeadline<T>(work: Promise<T>, ms: number, feature: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new AiTimeoutError(feature, ms)), ms);
  });
  return Promise.race([work, late]).finally(() => clearTimeout(timer));
}

/** Adds the server-side refusal fallback where the model supports it (Sonnet 5.5). */
export function withServerFallback<P extends { model: string; betas?: Anthropic.Beta.AnthropicBeta[] }>(params: P): P {
  const fb = SERVER_FALLBACK[params.model];
  if (!fb) return params;
  return { ...params, betas: [...new Set([...(params.betas ?? []), fb.beta])], fallbacks: "default" } as P;
}

export function assertNotRefused(message: Pick<BetaMessage, "stop_reason" | "stop_details">) {
  if (message.stop_reason === "refusal") {
    const details = message.stop_details as { category?: string | null; explanation?: string | null } | null;
    throw new AiRefusalError(details?.category ?? null, details?.explanation);
  }
}

export interface CallMeta {
  /** Short label for the timeline, e.g. "extract receipt". */
  feature: string;
  quiet?: boolean;
}

export interface ClaudeCallResult<M extends BetaMessage = BetaMessage> {
  message: M;
  costUsd: number;
}

/**
 * Runs one Messages API call under the spend cap. `exec` performs the actual SDK call so the
 * same guard wraps create(), parse() and countless future variants.
 */
export async function guardedClaudeCall<M extends BetaMessage>(
  params: BetaCreateParams,
  meta: CallMeta,
  exec: (client: Anthropic, params: BetaCreateParams) => Promise<M>,
): Promise<ClaudeCallResult<M>> {
  const client = getAnthropic();
  const p = withServerFallback(params);
  const estimate = worstCaseCostUsd(p.model, estimateInputTokens({ system: p.system, messages: p.messages, tools: p.tools }), p.max_tokens);
  const budget = getBudget();
  const reservation = budget.reserve(estimate);
  const step = startStep({
    kind: "ai",
    title: `${modelLabel(p.model)} · ${meta.feature}`,
    subtitle: `worst case $${estimate.toFixed(4)} reserved`,
    data: meta.quiet ? { quiet: true } : undefined,
  });
  let settled = false;
  try {
    const message = await withDeadline(exec(client, p), AI_CALL_DEADLINE_MS, meta.feature);
    const cost = actualCostUsd(message);
    budget.commit(reservation, cost);
    settled = true;
    assertNotRefused(message);
    const fellBack = message.model !== p.model;
    step.succeed({
      detail: `${message.usage.input_tokens.toLocaleString()} in · ${message.usage.output_tokens.toLocaleString()} out · $${cost.toFixed(4)}${fellBack ? ` · served by ${modelLabel(message.model)}` : ""}`,
      data: { model: message.model, usage: message.usage, costUsd: cost, stopReason: message.stop_reason, quiet: meta.quiet },
    });
    return { message, costUsd: cost };
  } catch (error) {
    if (!settled) budget.release(reservation);
    const failure = isOutOfCredit(error) ? new AiCreditError() : error;
    // Server log: which call failed and why, so a stall on the hosted copy shows its cause.
    console.error(`[ai] ${meta.feature} (${p.model}) failed: ${(failure as Error)?.name ?? "Error"}: ${(failure as Error)?.message ?? String(failure)}`);
    step.fail(failure);
    throw failure;
  }
}

/** Emits a timeline step for a mocked AI call so demos still show "AI did something". */
export function recordMockAiCall(feature: string, detail = "AI mock mode: returned the fixture") {
  startStep({ kind: "ai", title: `AI (mock) · ${feature}`, subtitle: "No ANTHROPIC_API_KEY" }).succeed({ detail });
}

/** Text of all text blocks in a message. */
export function textOf(message: Pick<BetaMessage, "content">): string {
  return message.content
    .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}
