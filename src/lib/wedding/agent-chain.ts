/**
 * What the agent has done so far, as a short chain the couple can read at a glance:
 *   Read 5 contracts → 3 cash clashes → Plan with 2 moves → Florist deposit ready → Waiting for you
 * Every link is written by code from the run's own steps and the timeline. The model's words never
 * reach it. Safe to import in the browser.
 */

export interface ChainInput {
  /** review_payments has come back. */
  reviewed: boolean;
  contracts: number;
  clashes: number;
  moves: number;
  /** The payment set up for approval or checkout: "florist deposit". */
  payment?: string;
  stage: "working" | "waiting" | "checkout" | "refused" | "finished" | "failed";
  /** The Guard's refusal, said as an amount: "$5,000.00". */
  refusedAmount?: string;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

export function agentChain(c: ChainInput): string[] {
  if (!c.reviewed) return c.stage === "failed" ? ["Stopped"] : ["Reading your contracts"];
  const chain = [`Read ${plural(c.contracts, "contract")}`, c.clashes ? plural(c.clashes, "cash clash", "cash clashes") : "No cash clash"];
  if (c.clashes) chain.push(c.moves ? `Plan with ${plural(c.moves, "move")}` : "No move fits");
  if (c.stage === "refused") return [...chain, `Guard refused ${c.refusedAmount ?? "the payment"}`, "Nothing sent"];
  if (c.payment) chain.push(`${c.payment[0].toUpperCase()}${c.payment.slice(1)} ready`);
  if (c.stage === "waiting") chain.push("Waiting for you");
  else if (c.stage === "checkout") chain.push("Pay in PayPal");
  else if (c.stage === "failed") chain.push("Stopped");
  else if (c.stage === "working") chain.push("Working");
  return chain;
}

/**
 * The first `n` sentences of the model's reply, and whatever followed them. A full stop inside an
 * amount ("$1,200.00") or before a lower-case word doesn't end a sentence.
 */
export function firstSentences(text: string, n: number): { lead: string; rest: string } {
  const sentences = text.trim().split(/(?<=[.!?])\s+(?=["'(A-Z0-9$])/);
  return { lead: sentences.slice(0, n).join(" "), rest: sentences.slice(n).join(" ") };
}
