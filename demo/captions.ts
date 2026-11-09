/**
 * Helpers for silent, captioned demo videos. Everything is injected into the page with
 * page.evaluate, so it works on any page without app support.
 *
 *   await titleCard(page, "Settle partial shipments with PayPal", "An AI agent with a human in the loop");
 *   await caption(page, "The buyer approves a $120 hold with PayPal");
 *   await highlight(page, page.getByTestId("run-agent"));
 */
import fs from "node:fs";
import path from "node:path";
import type { Locator, Page } from "@playwright/test";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Captions that, top or bottom, still covered the thing they describe. A take should have none. */
export const coveredCaptions: string[] = [];

/**
 * Bottom-centre caption. Waits `ms` (reading time) unless wait=false. It moves to the top of the
 * screen when, at the bottom, it would cover what it describes: `over`, or whatever is highlighted
 * or marked on screen. Returns where it went.
 */
export async function caption(page: Page, text: string, opts: { ms?: number; wait?: boolean; over?: Locator } = {}): Promise<{ place: "top" | "bottom"; covers: boolean }> {
  const ms = opts.ms ?? Math.min(6000, 1400 + text.length * 45);
  const over = opts.over ? await opts.over.boundingBox() : null;
  const place = await page.evaluate(
    ({ text, ms, over }) => {
      let el = document.getElementById("__demo_caption");
      if (!el) {
        el = document.createElement("div");
        el.id = "__demo_caption";
        Object.assign(el.style, {
          position: "fixed", left: "50%", bottom: "36px", transform: "translateX(-50%) translateY(10px)", zIndex: "2147483647",
          maxWidth: "min(1000px, calc(100vw - 48px))", padding: "16px 26px", borderRadius: "18px",
          background: "rgba(9,9,11,0.9)", color: "#fff", font: "600 24px/1.35 ui-sans-serif, system-ui, -apple-system, sans-serif",
          textAlign: "center", boxShadow: "0 20px 50px rgba(0,0,0,.35)", opacity: "0", transition: "opacity .3s, transform .3s", pointerEvents: "none",
        });
        document.body.appendChild(el);
      }
      el.textContent = text;
      // Measured at the bottom; if that covers the thing it's about, it goes to the top instead.
      Object.assign(el.style, { bottom: "36px", top: "auto" });
      const at = el.getBoundingClientRect();
      const targets = [...document.querySelectorAll("[data-demo-highlight], [data-demo-mark]")].map((t) => t.getBoundingClientRect());
      if (over) targets.push(new DOMRect(over.x, over.y, over.width, over.height));
      const covers = targets.some((r) => r.width && r.height && r.left < at.right && at.left < r.right && r.top < at.bottom + 12 && at.top - 12 < r.bottom);
      if (covers) Object.assign(el.style, { top: "28px", bottom: "auto" });
      el.dataset.place = covers ? "top" : "bottom";
      // Still on top of the thing it describes, even at the top? The scene should scroll it clear.
      const now = el.getBoundingClientRect();
      const still = !!over && over.x < now.right && now.left < over.x + over.width && over.y < now.bottom && now.top < over.y + over.height;
      requestAnimationFrame(() => {
        el!.style.opacity = "1";
        el!.style.transform = "translateX(-50%) translateY(0)";
      });
      clearTimeout((window as unknown as { __demoCaptionTimer?: number }).__demoCaptionTimer);
      (window as unknown as { __demoCaptionTimer?: number }).__demoCaptionTimer = window.setTimeout(() => {
        el!.style.opacity = "0";
      }, ms);
      return { place: covers ? ("top" as const) : ("bottom" as const), covers: still };
    },
    { text, ms, over },
  );
  if (place.covers) {
    coveredCaptions.push(text);
    console.log(`[demo] caption covers what it describes: "${text}"`);
  }
  if (opts.wait !== false) await sleep(ms);
  return place;
}

/** Takes any caption and highlight off the screen at once, so nothing sits on the next frame. */
export async function clearOverlays(page: Page) {
  await page.evaluate(() => {
    const el = document.getElementById("__demo_caption");
    if (el) el.style.opacity = "0";
    for (const h of document.querySelectorAll("[data-demo-highlight]")) h.remove();
  });
  await sleep(350);
}

/** Full-screen title card (intro/outro). */
export async function titleCard(page: Page, title: string, subtitle = "", ms = 3200, opts: { stay?: boolean } = {}) {
  await page.evaluate(
    ({ title, subtitle }) => {
      // Nothing from the scene before stays on top of the card.
      const caption = document.getElementById("__demo_caption");
      if (caption) caption.style.opacity = "0";
      for (const h of document.querySelectorAll("[data-demo-highlight]")) h.remove();
      const el = document.createElement("div");
      el.id = "__demo_title";
      el.innerHTML = `<div style="font:700 56px/1.1 ui-sans-serif,system-ui;letter-spacing:-0.02em">${title}</div>${subtitle ? `<div style="margin-top:18px;font:500 26px/1.4 ui-sans-serif,system-ui;opacity:.8">${subtitle}</div>` : ""}`;
      Object.assign(el.style, {
        position: "fixed", inset: "0", zIndex: "2147483647", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
        textAlign: "center", padding: "48px", color: "#fff", background: "radial-gradient(ellipse at top, var(--brand, #0070e0), #0b1020 70%)",
        opacity: "0", transition: "opacity .4s",
      });
      document.body.appendChild(el);
      requestAnimationFrame(() => (el.style.opacity = "1"));
    },
    { title, subtitle },
  );
  await sleep(ms);
  // The closing card stays up; the edit ends the video on it.
  if (opts.stay) return;
  await page.evaluate(() => {
    const el = document.getElementById("__demo_title");
    if (el) {
      el.style.opacity = "0";
      setTimeout(() => el.remove(), 400);
    }
  });
  await sleep(450);
}

/** Pulsing outline around an element so viewers know where to look. */
export async function highlight(page: Page, target: Locator, ms = 1600) {
  const box = await target.boundingBox();
  if (!box) return;
  await page.evaluate(
    ({ box, ms }) => {
      const el = document.createElement("div");
      Object.assign(el.style, {
        position: "fixed", left: `${box.x - 6}px`, top: `${box.y - 6}px`, width: `${box.width + 12}px`, height: `${box.height + 12}px`,
        border: "3px solid #f59e0b", borderRadius: "14px", zIndex: "2147483646", pointerEvents: "none",
        boxShadow: "0 0 0 6px rgba(245,158,11,.25)", transition: "opacity .3s",
      });
      el.dataset.demoHighlight = "1";
      document.body.appendChild(el);
      setTimeout(() => {
        el.style.opacity = "0";
        setTimeout(() => el.remove(), 300);
      }, ms);
    },
    { box, ms },
  );
  await sleep(Math.min(ms, 900));
}

/** Lights up the element itself (a sentence, a figure) in yellow for `ms`, as a reader's marker would. */
export async function mark(target: Locator, ms = 6000) {
  await target.evaluate((el: HTMLElement, ms) => {
    const before = { background: el.style.background, boxShadow: el.style.boxShadow, transition: el.style.transition, color: el.style.color };
    Object.assign(el.style, { transition: "background .3s, box-shadow .3s", background: "#fef08a", boxShadow: "0 0 0 4px #fef08a", color: "#18181b" });
    el.dataset.demoMark = "1";
    setTimeout(() => {
      Object.assign(el.style, before);
      delete el.dataset.demoMark;
    }, ms);
  }, ms);
}

/**
 * What counts as "busy" on screen: a spinner, a skeleton, a loading line, or PayPal's own spinner.
 * Checked in every page and frame, ten times a second, and only while it's on screen.
 */
function busyProbe() {
  const SELECTOR = '.animate-spin, .animate-pulse, [aria-busy="true"], [data-testid$="-loading"], [data-testid="receipt-reading"], [role="progressbar"], [class*="spinner" i], [class*="loader" i]';
  const w = window as unknown as { __demoBusy?: (on: boolean, what: string) => void };
  let last = "";
  const seen = (el: Element) => {
    if (document.getElementById("__demo_title")) return false;
    // Inside a closed <details>, it's in the DOM but not drawn.
    const closed = el.closest("details:not([open])");
    if (closed && !el.closest("summary")) return false;
    const check = (el as Element & { checkVisibility?: (o: object) => boolean }).checkVisibility;
    if (check && !check.call(el, { contentVisibilityAuto: true, opacityProperty: true, visibilityProperty: true })) return false;
    const r = el.getBoundingClientRect();
    if (!r.width || !r.height || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) return false;
    const style = getComputedStyle(el);
    return style.visibility !== "hidden" && style.opacity !== "0";
  };
  setInterval(() => {
    const found = [...document.querySelectorAll(SELECTOR)].find(seen);
    const what = found ? `${location.host} ${found.getAttribute("data-testid") ?? (found.getAttribute("class") ?? found.tagName).slice(0, 60)}` : "";
    if (what !== last && w.__demoBusy) {
      if (last) w.__demoBusy(false, last);
      if (what) w.__demoBusy(true, what);
      last = what;
    }
  }, 100);
}

/** Text a judge must never see in a take meant as the real thing. */
export const MOCK_TEXT = /\bmock\b|simulated/i;

/**
 * Watches every page the demo shows for visible text matching MOCK_TEXT ("AI mock", "Simulated
 * read"), across navigations. `check()` throws when DEMO_REQUIRE_LIVE=1 and any was seen; without it,
 * it only logs, so a local mock run still records.
 */
export async function watchMockText(page: Page, requireLive = process.env.DEMO_REQUIRE_LIVE === "1") {
  const seen: string[] = [];
  await page.exposeBinding("__demoMockText", (_source, line: string) => {
    if (!seen.includes(line)) {
      seen.push(line);
      console.log(`[demo] visible mock text: "${line}"`);
    }
  });
  await page.addInitScript(mockTextProbe);
  return {
    seen,
    requireLive,
    async check(where: string) {
      // One more look now, in case the page changed since the probe's last pass.
      await page.evaluate(mockTextProbe).catch(() => undefined);
      if (requireLive && seen.length) throw new Error(`DEMO_REQUIRE_LIVE=1: mock text on screen by "${where}": ${seen.map((t) => `"${t}"`).join(", ")}`);
    },
  };
}

/** In the page: reports each visible line (innerText skips hidden and closed content) that reads as mock. */
function mockTextProbe() {
  const report = (window as unknown as { __demoMockText?: (line: string) => void }).__demoMockText;
  const scan = () => {
    const text = document.body?.innerText ?? "";
    for (const line of text.split("\n")) if (/\bmock\b|simulated/i.test(line)) report?.(line.trim().slice(0, 160));
  };
  const w = window as unknown as { __demoMockProbe?: boolean };
  if (w.__demoMockProbe) return scan();
  w.__demoMockProbe = true;
  setInterval(scan, 250);
  scan();
}

/**
 * Keeps the cut video under its limit. A wait that the edit cuts (PayPal's page loading, a webhook
 * on its way) is marked with `cut()`: it doesn't count, and its start and end in the raw recording
 * are printed so the editor knows where to cut.
 */
export interface Span {
  label: string;
  from: number;
  to: number;
}

export class DemoClock {
  private readonly start = Date.now();
  private cutMs = 0;
  readonly cuts: Span[] = [];
  /** Every moment a spinner, skeleton or page load was on screen, in raw seconds. */
  readonly busy: Span[] = [];
  private readonly open = new Map<string, number>();
  /** When the first title card was half faded in, in raw seconds: the edit finds it in the video to line the cuts up. */
  private syncAt?: number;
  constructor(private readonly limitSeconds = 100) {}

  /** Call just before the opening title card (a white page turning dark). */
  sync() {
    this.syncAt = this.raw + 0.2;
  }

  /** Watches the page (and PayPal's) for anything busy on screen, so the edit can cut it. */
  async watchBusy(page: Page) {
    const set = (key: string, on: boolean) => {
      if (on && !this.open.has(key)) this.open.set(key, this.raw);
      if (!on && this.open.has(key)) {
        this.busy.push({ label: key, from: this.open.get(key)!, to: this.raw });
        this.open.delete(key);
      }
    };
    await page.exposeBinding("__demoBusy", (_source, on: boolean, what: string) => set(`spinner ${what}`, on));
    await page.addInitScript(busyProbe);
    // A full page load shows a blank or half-drawn page until it's done.
    page.on("request", (r) => {
      if (r.isNavigationRequest() && r.frame() === page.mainFrame()) set("page load", true);
    });
    // A new document starts its probe afresh, so whatever the old one showed has gone.
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) for (const key of [...this.open.keys()]) if (key.startsWith("spinner ")) set(key, false);
    });
    page.on("load", () => setTimeout(() => set("page load", false), 250));
  }

  /** Ends the video here: everything after this moment is cut. */
  end() {
    this.cuts.push({ label: "after the end card", from: this.raw, to: this.raw + 3600 });
  }

  /** Seconds of `[from, to]` (raw) that stay in the cut video. */
  onCamera(from: number, to: number) {
    const cut = merge(this.allCuts()).reduce((sum, c) => sum + Math.max(0, Math.min(to, c.to) - Math.max(from, c.from)), 0);
    return to - from - cut;
  }

  /** The cuts the edit makes: the waits marked with cut(), and every busy moment. */
  allCuts(): Span[] {
    for (const key of [...this.open.keys()]) {
      this.busy.push({ label: key, from: this.open.get(key)!, to: this.raw });
      this.open.delete(key);
    }
    // The video starts a moment before this clock, and frames land late: pad each busy cut.
    return [...this.cuts, ...this.busy.map((b) => ({ ...b, from: Math.max(0, b.from - 0.1), to: b.to + 0.3 }))];
  }

  /** Writes the edit list webm-to-mp4.sh applies: raw-second spans to cut, merged and sorted. */
  writeCuts(file: string) {
    const cuts = merge(this.allCuts());
    const cutSeconds = cuts.reduce((sum, c) => sum + Math.max(0, Math.min(c.to, this.raw) - c.from), 0);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify({ rawSeconds: this.raw, cutSeconds, syncAt: this.syncAt, cuts, waits: this.cuts, busy: this.busy }, null, 2));
    return { cuts, videoSeconds: this.raw - cutSeconds };
  }
  /** Seconds into the raw recording. */
  get raw() {
    return (Date.now() - this.start) / 1000;
  }
  /** Seconds into the cut video. */
  get seconds() {
    return Math.round((Date.now() - this.start - this.cutMs) / 1000);
  }
  async cut<T>(label: string, wait: () => Promise<T>, keepMs = 0): Promise<T> {
    const from = this.raw;
    const result = await wait();
    const to = this.raw;
    const cut = Math.max(0, (to - from) * 1000 - keepMs);
    if (cut > 0) {
      this.cutMs += cut;
      this.cuts.push({ label, from: from + keepMs / 1000, to });
      console.log(`[demo] cut "${label}": raw ${(from + keepMs / 1000).toFixed(1)}s to ${to.toFixed(1)}s`);
    }
    return result;
  }
  check(label: string) {
    const s = this.seconds;
    console.log(`[demo] ${label} at ${s}s (raw ${Math.round(this.raw)}s)`);
    if (s > this.limitSeconds) throw new Error(`Demo is ${s}s at "${label}" (limit ${this.limitSeconds}s). Cut scenes or shorten captions.`);
  }
}

/** Overlapping spans joined into one, in order. */
function merge(spans: Span[]): Span[] {
  const out: Span[] = [];
  for (const s of [...spans].sort((a, b) => a.from - b.from)) {
    const last = out.at(-1);
    if (last && s.from <= last.to) {
      last.to = Math.max(last.to, s.to);
      last.label = `${last.label} + ${s.label}`;
    } else out.push({ ...s });
  }
  return out;
}
