/**
 * "Approve and pay" is one step: once the Guard approval goes through, the payment's checkout
 * opens by itself. In sandbox the browser goes straight to PayPal's page. With mock PayPal the
 * simulated checkout opens, so this remembers, for a minute, which item should open it. The box
 * may already be on screen by then (the live feed can refresh first), so it is a small store.
 */
const asked = new Map<string, number>();
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

export function openCheckoutFor(itemId: string) {
  asked.set(itemId, Date.now());
  changed();
}

export const wantsCheckout = (itemId: string) => Date.now() - (asked.get(itemId) ?? 0) < 60_000;

export function checkoutOpened(itemId: string) {
  if (asked.delete(itemId)) changed();
}

export function subscribeCheckout(listener: () => void) {
  listeners.add(listener);
  return () => void listeners.delete(listener);
}
