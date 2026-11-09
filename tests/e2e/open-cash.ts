import type { Page } from "@playwright/test";

/** The cash card shows its chart and one line; the budget, warnings and sums open from that line. */
export async function openCashCheck(page: Page) {
  const more = page.getByTestId("cash-more");
  if (!(await more.evaluate((d) => (d as HTMLDetailsElement).open))) await more.locator(":scope > summary").click();
}
