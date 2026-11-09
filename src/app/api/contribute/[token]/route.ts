import { route } from "@/lib/http";
import { contributorView, findContribution } from "@/lib/wedding/contributor";
import { syncPayment } from "@/lib/wedding/pay";

/** How often the contributor's page may make the app re-read a capture from PayPal. */
const RECHECK_MS = 4_000;

/** The contributor's page: this one payment, found by the link's token. No plan cookie is read. */
export const GET = route<RouteContext<"/api/contribute/[token]">>(async (_req, ctx) => {
  const { token } = await ctx.params;
  const { contract, kind } = findContribution(token);
  const payment = contract.payments[kind];
  if (payment?.payer?.token === token && payment.state === "sending" && (!payment.checkedAt || Date.now() - Date.parse(payment.checkedAt) >= RECHECK_MS)) {
    await syncPayment(contract.id, kind).catch(() => undefined); // The last status stays on screen.
  }
  return contributorView(token);
});
