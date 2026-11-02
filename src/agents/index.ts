/**
 * APP-OWNED: the agents this app exposes at POST /api/agent/runs { agentId }. Each run belongs to
 * one couple, so the server binds the agent to their plan. The model never names a plan.
 */
import type { AgentDefinition } from "@/lib/agent/define";
import { paymentAgent } from "./payments";

export function agentFor(agentId: string, planId: string, today: string): AgentDefinition | null {
  return agentId === "payments" ? paymentAgent(planId, today) : null;
}
