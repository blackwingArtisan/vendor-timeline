import { z } from "zod";
import { readJson, route } from "@/lib/http";
import { addUnreadContract } from "@/lib/wedding/contracts";
import { MAX_CONTRACT_CHARS } from "@/lib/wedding/limits";
import { currentPlanId } from "@/lib/wedding/plan";

const Body = z.object({ text: z.string().max(MAX_CONTRACT_CHARS, "That contract is too long.").optional(), fileName: z.string().max(200, "That file name is too long.").optional() });

/** When AI can't read a contract, the couple can still type its terms in. No AI call. */
export const POST = route(async (req) => addUnreadContract(await currentPlanId(), await readJson(req, Body)));
