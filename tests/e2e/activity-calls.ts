/**
 * Counts the PayPal calls the activity panel shows: each card, plus each folded row's own count, so a
 * caption or a test says the same number a viewer can add up on screen.
 */
import { expect, type Locator } from "@playwright/test";

export async function paypalCallsOnScreen(list: Locator) {
  const cards = await list.locator('[data-testid="timeline-step"][data-kind="paypal"]').count();
  const folded = await list.locator('[data-testid="timeline-quiet"][data-kind="paypal"]').evaluateAll((els) => els.map((el) => Number((el as HTMLElement).dataset.count)));
  return { calls: cards + folded.reduce((a, b) => a + b, 0), rows: cards + folded.length, repeated: folded.filter((c) => c > 1).length };
}

/** Within a stretch of quiet reads no call is listed twice: its repeats are one row with a count. */
export async function expectRepeatsFolded(list: Locator) {
  const twice = await list.locator("ol > li").evaluateAll((els) => {
    const found: string[] = [];
    let stretch = new Set<string>();
    for (const el of els as HTMLElement[]) {
      const call = el.dataset.call;
      if (!call) {
        stretch = new Set();
        continue;
      }
      if (stretch.has(call)) found.push(call);
      stretch.add(call);
    }
    return found;
  });
  expect(twice, "a quiet call listed twice in one stretch").toEqual([]);
  for (const row of await list.locator('[data-testid="timeline-quiet"]').all()) {
    const count = Number(await row.getAttribute("data-count"));
    if (count > 1) await expect(row.getByTestId("repeat-count")).toHaveText(`×${count}`);
    else await expect(row.getByTestId("repeat-count")).toHaveCount(0);
  }
}
