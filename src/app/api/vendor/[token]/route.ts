import { route } from "@/lib/http";
import { vendorView } from "@/lib/wedding/vendor-ask";

/** The vendor's page: this one payment, found by the link's token. No plan cookie is read. */
export const GET = route<RouteContext<"/api/vendor/[token]">>(async (_req, ctx) => vendorView((await ctx.params).token));
