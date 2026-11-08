import { describe, expect, it } from "vitest";
import { z } from "zod";
import { errorResponse, plainPayPalMessage } from "@/lib/http";
import { PayPalApiError } from "@/lib/paypal/errors";

const JARGON = /Invalid request|PAYER_ACTION_REQUIRED|ORDER_NOT_APPROVED|UNPROCESSABLE|semantically/;

describe("errors the couple see are in plain words", () => {
  it("says PayPal hasn't had their approval, not PayPal's code", () => {
    const e = PayPalApiError.fromResponse(422, { name: "UNPROCESSABLE_ENTITY", message: "The requested action could not be performed, semantically incorrect, or failed business validation.", details: [{ issue: "ORDER_NOT_APPROVED" }], debug_id: "f00d" });
    expect(plainPayPalMessage(e)).toMatch(/^PayPal hasn't had your approval/);
    expect(plainPayPalMessage(e)).not.toMatch(JARGON);
  });

  it("keeps PayPal's own words and reference for developers", async () => {
    const e = PayPalApiError.fromResponse(500, { name: "INTERNAL_SERVER_ERROR", message: "An internal server error occurred.", debug_id: "f00d" });
    const body = (await errorResponse(e).json()).error;
    expect(body.message).toBe("PayPal couldn't do that just now, so nothing was paid. Try again in a minute. PayPal reference: f00d.");
    expect(body.paypalMessage).toBe("An internal server error occurred.");
    expect(body.debug_id).toBe("f00d");
  });

  it("never sends zod's own wording", async () => {
    const r = z.object({ n: z.number() }).safeParse({ n: "x" });
    const body = (await errorResponse(r.error).json()).error;
    expect(body.message).not.toMatch(/Invalid|Expected/);
  });
});
