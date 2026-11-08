import { route } from "@/lib/http";
import { ledger, type LedgerKind } from "@/lib/paypal";
import { planPayPalIds } from "@/lib/wedding/pay";
import { currentPlanId } from "@/lib/wedding/plan";

/** This couple's own PayPal objects: the orders and captures of their payments, and nothing else. */
export const GET = route(async (req) => {
  const kind = req.nextUrl.searchParams.get("kind") as LedgerKind | null;
  const mine = planPayPalIds(await currentPlanId());
  return { entries: ledger.list(kind ? { kind } : {}).filter((e) => mine.has(e.paypalId) || (!!e.orderId && mine.has(e.orderId))) };
});
