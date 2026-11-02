/**
 * APP-OWNED: the agents this app exposes at POST /api/agent/runs { agentId }. None yet: in this
 * slice the AI reads contracts and a person starts each payment.
 */
import type { AgentDefinition } from "@/lib/agent/define";

export const AGENTS: Record<string, AgentDefinition> = {};
