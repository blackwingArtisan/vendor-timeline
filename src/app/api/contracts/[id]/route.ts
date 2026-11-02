import { route } from "@/lib/http";
import { requirePlanContract } from "@/lib/wedding/contracts";
import { currentPlanId } from "@/lib/wedding/plan";

export const GET = route<RouteContext<"/api/contracts/[id]">>(async (_req, ctx) => requirePlanContract(await currentPlanId(), (await ctx.params).id));
