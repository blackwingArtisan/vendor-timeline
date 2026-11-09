/**
 * The hosted copy sits behind Render's proxy, which can drop a request before the app ever sees it:
 * an empty 502, 503 or 504, or a connection that fails outright. That is not the app saying no, so
 * a request that is safe to send twice is sent once more. An answer from the app itself (a JSON
 * error, a PayPal 502 included) is never retried. Safe to import in the browser.
 */

/** Dropped on the way to the app, not answered by it. */
export function droppedByGateway(error: unknown): boolean {
  if (error instanceof TypeError) return true; // fetch's own "Failed to fetch": no answer at all
  const e = error as { status?: unknown; body?: { error?: { type?: unknown } } } | null;
  return !!e && typeof e.status === "number" && [502, 503, 504].includes(e.status) && !e.body?.error?.type;
}

/** Sends once more after a short wait if the first try was dropped by the gateway. Only for idempotent requests. */
export async function retryIfDropped<T>(send: () => Promise<T>, waitMs = 700): Promise<T> {
  try {
    return await send();
  } catch (error) {
    if (!droppedByGateway(error)) throw error;
    await new Promise((r) => setTimeout(r, waitMs));
    return send();
  }
}
