import { timeline } from "@/lib/events/bus";
import { route } from "@/lib/http";
import { contributorPay, findContribution } from "@/lib/wedding/contributor";
import { rememberOrigin } from "@/lib/wedding/origin";
import { planChannel } from "@/lib/wedding/pay";

/** The contributor asks to pay. It waits for the couple's approval on their timeline; nothing is sent before it. */
export const POST = route<RouteContext<"/api/contribute/[token]/pay">>(async (req, ctx) => {
  const { token } = await ctx.params;
  rememberOrigin(req);
  const view = contributorPay(token);
  const { contract, kind, contributor } = findContribution(token);
  timeline.emit({ kind: "info", status: "info", title: `${contributor.name} asked to pay the ${contract.confirmed!.vendorName} ${kind}`, detail: `${view.amount}, from ${contributor.name}'s own PayPal. Waiting for your approval.`, channel: planChannel(contract.planId) });
  return view;
});
