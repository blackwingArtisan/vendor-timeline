/**
 * On the hosted copy, "They agreed" came back as an empty 502 from Render's proxy, twice, 6-7 s after
 * the previous POST, while the app's own requests either side answered 200. The app never saw it:
 * Node closed idle connections after its default 5 s and the proxy reused one. npm start now keeps
 * them 120 s, and an idempotent request the gateway drops is sent once more.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import { droppedByGateway, retryIfDropped } from "@/lib/gateway-retry";

const dropped = Object.assign(new Error(""), { status: 502, body: { error: { message: "" } } });
const fromApp = Object.assign(new Error("PayPal didn't answer"), { status: 502, body: { error: { type: "paypal_network", message: "PayPal didn't answer" } } });

describe("a request the hosting proxy dropped", () => {
  it("is an empty 502/503/504 or no answer at all, never the app's own error", () => {
    expect(droppedByGateway(dropped)).toBe(true);
    expect(droppedByGateway({ ...dropped, status: 504 })).toBe(true);
    expect(droppedByGateway(new TypeError("Failed to fetch"))).toBe(true);
    expect(droppedByGateway(fromApp)).toBe(false);
    expect(droppedByGateway(Object.assign(new Error("x"), { status: 409, body: {} }))).toBe(false);
    expect(droppedByGateway(null)).toBe(false);
  });

  it("is sent once more, and only once", async () => {
    const send = vi.fn().mockRejectedValueOnce(dropped).mockResolvedValueOnce({ ok: true });
    await expect(retryIfDropped(send, 0)).resolves.toEqual({ ok: true });
    expect(send).toHaveBeenCalledTimes(2);

    const always = vi.fn().mockRejectedValue(dropped);
    await expect(retryIfDropped(always, 0)).rejects.toBe(dropped);
    expect(always).toHaveBeenCalledTimes(2);
  });

  it("isn't sent again when the app itself said no", async () => {
    const send = vi.fn().mockRejectedValue(fromApp);
    await expect(retryIfDropped(send, 0)).rejects.toBe(fromApp);
    expect(send).toHaveBeenCalledTimes(1);
  });
});

describe("the production server", () => {
  it("keeps idle connections open longer than the proxy in front of it (Node's default is 5 s)", () => {
    const start: string = JSON.parse(readFileSync("package.json", "utf8")).scripts.start;
    const ms = Number(/--keepAliveTimeout (\d+)/.exec(start)?.[1]);
    expect(ms).toBeGreaterThanOrEqual(120_000);
  });
});
