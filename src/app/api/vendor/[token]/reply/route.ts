import { z } from "zod";
import { timeline } from "@/lib/events/bus";
import { readJson, route } from "@/lib/http";
import { planChannel } from "@/lib/wedding/pay";
import { findAsk, saveReply } from "@/lib/wedding/vendor-ask";
import { REPLY_ANSWERS } from "@/lib/wedding/types";

const Body = z.object({
  answer: z.enum(REPLY_ANSWERS),
  text: z.string().max(500, "Keep it under 500 characters.").optional(),
  paypalEmail: z.string().trim().max(200).email("Enter a PayPal email like name@example.com.").optional(),
});

/** The vendor's answer. It is stored and shown to the couple; nothing moves until they approve it. No AI here. */
export const POST = route<RouteContext<"/api/vendor/[token]/reply">>(async (req, ctx) => {
  const { token } = await ctx.params;
  const reply = saveReply(token, await readJson(req, Body));
  const { contract, kind } = findAsk(token);
  timeline.emit({ kind: "info", status: "info", title: `${contract.confirmed!.vendorName} replied about the ${kind}`, detail: reply.text || (reply.answer === "agreed" ? "Yes" : "No"), channel: planChannel(contract.planId) });
  return { reply };
});
