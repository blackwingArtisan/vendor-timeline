import { route } from "@/lib/http";
import { loadSampleWedding } from "@/lib/wedding/demo";
import { currentPlanId } from "@/lib/wedding/plan";

/** One click to the five-contract story. It uses the labelled fixtures, so it costs no AI. */
export const POST = route(async () => loadSampleWedding(await currentPlanId()));
