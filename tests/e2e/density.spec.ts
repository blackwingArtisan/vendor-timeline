/**
 * The timeline reads in seconds, on a laptop (1440x900) and a phone (390x844): body text is at
 * least 14 px in the timeline, the agent panel, the cash plan and the approval card; each card
 * shows at most 3 lines before its "Details"; and on a phone each payment is one compact row (two
 * or three lines, one more when it waits on something, at most 110 px), not a tall column of badges. Labels (chips, the eyebrow, the Details toggle) are marked data-label
 * and buttons are actions, so neither counts as body text or as a line.
 */
import { expect, test, type Locator, type Page } from "@playwright/test";
import { FLORIST, SAMPLES } from "../../src/lib/wedding/samples";

const TODAY = "2026-11-20";

/** In the page: visible body text under `el`, as its smallest font size and its number of lines. */
function measure(el: Element) {
  // Not body text: actions, labels, form fields, tooltips; and nothing drawn (a closed Details, hidden).
  const skip = (node: Node) => {
    const parent = node.parentElement;
    if (!parent || parent.closest("button, [data-label], svg, input, textarea, [role=tooltip], .sr-only")) return true;
    if (parent.closest("details:not([open])") && !parent.closest("summary")) return true;
    return !parent.checkVisibility({ contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true });
  };
  const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  const spans: [number, number][] = [];
  const texts: string[] = [];
  let smallest = Infinity;
  let smallestText = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (!node.textContent?.trim() || skip(node)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    // A clamped or clipped box lays out every line but draws only those inside it.
    const clips: DOMRect[] = [];
    for (let a = node.parentElement; a && a !== el.parentElement; a = a.parentElement) {
      if (getComputedStyle(a).overflowY !== "visible") clips.push(a.getBoundingClientRect());
    }
    const drawn = (r: DOMRect) => clips.every((c) => r.top + r.height / 2 > c.top && r.top + r.height / 2 < c.bottom);
    const rects = [...range.getClientRects()].filter((r) => r.width > 0 && r.height > 0 && drawn(r));
    if (!rects.length) continue;
    const size = parseFloat(getComputedStyle(node.parentElement!).fontSize);
    if (size < smallest) {
      smallest = size;
      smallestText = node.textContent.trim().slice(0, 60);
    }
    // The glyphs' own height, not the line box's, so 1.5 line-height doesn't count twice.
    for (const r of rects) spans.push([r.top + r.height / 2 - size * 0.7, r.top + r.height / 2 + size * 0.7]);
    texts.push(`${Math.round(rects[0].top)}:${node.textContent.trim().slice(0, 30)}`);
  }
  // Lines: the height the text covers (gaps between blocks left out), in 20 px lines of 14 px text.
  spans.sort((a, b) => a[0] - b[0]);
  let covered = 0;
  let end = -Infinity;
  for (const [top, bottom] of spans) {
    if (top >= end) covered += bottom - top;
    else if (bottom > end) covered += bottom - end;
    end = Math.max(end, bottom);
  }
  const lines = Math.round(covered / 20);
  return { smallest, smallestText, lines, texts };
}

async function check(name: string, card: Locator, maxLines = 3) {
  const { smallest, smallestText, lines, texts } = await card.evaluate(measure);
  console.log(`${name}: ${lines} lines, smallest body text ${smallest}px ("${smallestText}")`);
  if (lines > maxLines) console.log(`  ${texts.join(" | ")}`);
  expect(smallest, `${name}: body text "${smallestText}"`).toBeGreaterThanOrEqual(14);
  expect(lines, `${name}: lines before Details`).toBeLessThanOrEqual(maxLines);
}

async function waitingApproval(page: Page) {
  await page.clock.setFixedTime(new Date(`${TODAY}T12:00:00`));
  await page.goto("/timeline");
  await expect(page.getByTestId("timeline-item")).toHaveCount(SAMPLES.length * 2);
  await page.getByTestId("ask-agent").click();
  const panel = page.getByTestId("agent-panel");
  const prompt = panel.getByTestId("approval-prompt");
  await expect(prompt).toBeVisible({ timeout: 90_000 });
  await expect(prompt).toContainText(FLORIST.vendorName);
  await expect(panel.getByTestId("agent-reply")).toBeVisible();
  return { panel, prompt };
}

for (const { name, width, height } of [
  { name: "laptop", width: 1440, height: 900 },
  { name: "phone", width: 390, height: 844 },
]) {
  test(`on a ${name} (${width}x${height}) text is 14 px or more and each card is 3 lines or fewer before Details`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    const { panel, prompt } = await waitingApproval(page);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: `screenshots/density-${width}.png` });
    await page.screenshot({ path: `screenshots/density-${width}-full.png`, fullPage: true });

    // Body text through the whole panel, the plan and the timeline (lines are counted per card below).
    await check(`${name} agent panel`, panel, Infinity);
    await check(`${name} cash plan`, page.getByTestId("cash-plan"), Infinity);
    await check(`${name} timeline`, page.getByTestId("timeline-list"), Infinity);
    await check(`${name} approval card`, prompt);
    await check(`${name} agent lead`, panel.getByTestId("agent-messages"));
    const plan = page.getByTestId("cash-plan");
    await check(`${name} cash plan heading`, plan.getByTestId("cash-plan-head"));
    for (const [i, move] of (await plan.getByTestId("cash-move").all()).entries()) await check(`${name} cash move ${i + 1}`, move);

    // Every payment row: 14 px body text; on a phone, one compact row, not a column of badges.
    const rows = await page.getByTestId("timeline-item").all();
    for (const [i, row] of rows.entries()) {
      // Vendor, amount, date and when; a row waiting on something adds one line saying where.
      await check(`${name} row ${i + 1}`, row, name === "phone" ? 4 : 3);
      if (name === "phone") expect((await row.boundingBox())!.height, `row ${i + 1} height`).toBeLessThanOrEqual(110);
    }
  });
}
