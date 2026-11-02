import { z } from "zod";
import { agentFor } from "@/agents";
import { HttpError, readJson, route } from "@/lib/http";
import { getContext } from "@/lib/events/bus";
import { listRuns, startAgentRun } from "@/lib/agent/runs";
import { isCalendarDay, utcToday } from "@/lib/wedding/dates";
import { currentPlanId } from "@/lib/wedding/plan";

const Body = z.object({ agentId: z.string(), goal: z.string().min(3).max(2000), today: z.string().refine(isCalendarDay).optional() });

/** Start an agent run (returns immediately). Follow it on the timeline; approve via /api/agent/approvals. */
export const POST = route(
  async (req) => {
    const b = await readJson(req, Body);
    const today = b.today ?? utcToday();
    const def = agentFor(b.agentId, await currentPlanId(), today);
    if (!def) throw new HttpError(404, `Unknown agent "${b.agentId}"`, "not_found");
    return { run: startAgentRun(def, { goal: b.goal, context: { today } }, { channel: getContext().channel }) };
  },
  { rateLimit: "ai" },
);

export const GET = route(async () => ({ runs: listRuns(getContext().channel) }));
