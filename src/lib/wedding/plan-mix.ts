/**
 * What a plan is made of, said plainly: which contracts are the fictional samples (read ahead of
 * time) and which the couple added on this visit, read live by Claude or entered without AI. The
 * sample banner says only this, so it never calls a plan with live reads "five fictional contracts".
 * Safe to import in the browser.
 */
import type { Contract, PlanMix } from "./types";

const nameOf = (c: Contract) => c.confirmed?.vendorName ?? c.proposed.vendorName.value ?? "A contract";

export function planMix(contracts: Contract[]): PlanMix {
  const mix: PlanMix = { samples: [], readLive: [], readWithoutAi: [] };
  for (const c of contracts) {
    if (c.sample) mix.samples.push(nameOf(c));
    else if (!c.read.mocked && !c.read.skipped) mix.readLive.push(nameOf(c));
    else mix.readWithoutAi.push(nameOf(c));
  }
  return mix;
}

const NUMBERS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten"];
const count = (n: number) => NUMBERS[n] ?? String(n);
const list = (names: string[]) => (names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`);

/** The banner's badge and sentence for this plan. */
export function sampleBannerText(mix: PlanMix): { badge: string; text: string } {
  const own = mix.readLive.length + mix.readWithoutAi.length;
  const samples = mix.samples.length;
  if (!own) {
    const n = samples ? count(samples) : "The";
    return { badge: "Sample plan", text: `${n[0].toUpperCase()}${n.slice(1)} fictional vendor ${samples === 1 ? "contract" : "contracts"}, read ahead of time and already confirmed, so you can try the timeline, the cash check and the agent.` };
  }
  const parts: string[] = [];
  if (mix.readLive.length) parts.push(`${list(mix.readLive)} ${mix.readLive.length === 1 ? "was" : "were"} read by Claude on this visit`);
  if (mix.readWithoutAi.length) parts.push(`${list(mix.readWithoutAi)} ${mix.readWithoutAi.length === 1 ? "was" : "were"} added on this visit without an AI read`);
  const own_ = `${parts.join("; ")}.`;
  const rest = samples ? ` The other ${count(samples)} ${samples === 1 ? "is a fictional sample" : "are fictional samples"}, read ahead of time.` : "";
  return { badge: samples ? "Part sample" : "Your plan", text: `${own_[0].toUpperCase()}${own_.slice(1)}${rest}` };
}

/**
 * How a contract was read, said plainly for its review page. A sample was read ahead of time, not
 * on this visit, so its page says so and how to see a live read instead.
 */
export function readLabel(c: Pick<Contract, "sample" | "read">): { badge: string; live: boolean; note?: string } {
  if (c.sample) return { badge: "Read ahead of time", live: false, note: "This fictional sample was read ahead of time, not on this visit." };
  if (c.read.skipped) return { badge: "Not read by AI", live: false };
  if (c.read.mocked) return { badge: "Read without AI", live: false };
  return { badge: `Read by ${c.read.model}`, live: true };
}
