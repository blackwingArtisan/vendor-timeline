import { z } from "zod";
import { readJson, route } from "@/lib/http";
import { addContract, listContracts } from "@/lib/wedding/contracts";
import { currentPlanId } from "@/lib/wedding/plan";

/** Long enough for a real contract, short enough to keep each AI read cheap. */
const MAX_CHARS = 20_000;
const Body = z.object({ text: z.string().trim().min(40, "That is too short to be a contract.").max(MAX_CHARS, "That contract is too long."), fileName: z.string().max(200).optional() });

export const GET = route(async () => ({ contracts: listContracts(await currentPlanId()) }));

export const POST = route(async (req) => addContract(await currentPlanId(), await readJson(req, Body)), { rateLimit: "ai" });
