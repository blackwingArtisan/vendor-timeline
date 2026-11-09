/**
 * APP-OWNED: the agents this app exposes at POST /api/agent/runs { agentId }. Each run belongs to
 * one couple, so the server binds the agent to their plan. The model never names a plan.
 */
import type { AgentDefinition } from "@/lib/agent/define";
import { paymentAgent } from "./payments";
import { REPLY_AGENT_ID, vendorReplyAgent } from "./vendor-reply";

export function agentFor(agentId: string, planId: string, today: string): AgentDefinition | null {
  if (agentId === "payments") return paymentAgent(planId, today);
  if (agentId === REPLY_AGENT_ID) return vendorReplyAgent(planId, today);
  return null;
}
