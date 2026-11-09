import { z } from "zod";
import { rememberOrigin } from "@/lib/wedding/origin";
import { readJson, route } from "@/lib/http";
import { assignContributor, unassignContributor } from "@/lib/wedding/contributor";
import { currentPlanId } from "@/lib/wedding/plan";

const Body = z.object({ kind: z.enum(["deposit", "balance"]), name: z.string().max(60).nullable() });

/** "Assign to a parent": a link for this one payment, for the couple to send that person themselves. A null name takes it back. */
export const POST = route<RouteContext<"/api/contracts/[id]/assign">>(async (req, ctx) => {
  const { kind, name } = await readJson(req, Body);
  rememberOrigin(req);
  const planId = await currentPlanId();
  const { id } = await ctx.params;
  if (name === null) {
    unassignContributor(planId, id, kind);
    return { contributor: null };
  }
  const contributor = assignContributor(planId, id, kind, name);
  return { contributor: { name: contributor.name, token: contributor.token }, path: `/contribute/${contributor.token}` };
});
