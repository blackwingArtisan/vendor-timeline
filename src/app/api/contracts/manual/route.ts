import { z } from "zod";
import { readJson, route } from "@/lib/http";
import { addUnreadContract } from "@/lib/wedding/contracts";
import { currentPlanId } from "@/lib/wedding/plan";

const Body = z.object({ text: z.string().max(20_000).optional(), fileName: z.string().max(200).optional() });

/** When AI can't read a contract, the couple can still type its terms in. No AI call. */
export const POST = route(async (req) => addUnreadContract(await currentPlanId(), await readJson(req, Body)));
