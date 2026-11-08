import { route } from "@/lib/http";
import { getAuditLog } from "@/lib/agent/audit";
import { planRunIds } from "@/lib/wedding/pay";
import { currentPlanId } from "@/lib/wedding/plan";

/** This couple's part of the append-only audit log, plus hash-chain verification of the whole log. */
export const GET = route(async (req) => {
  const log = getAuditLog();
  const runId = req.nextUrl.searchParams.get("runId") ?? undefined;
  const entries = log.list({ runId, limit: 5000 });
  const runs = planRunIds(await currentPlanId(), entries);
  return { entries: entries.filter((e) => e.runId && runs.has(e.runId)).slice(-500).reverse(), integrity: log.verify() };
});
