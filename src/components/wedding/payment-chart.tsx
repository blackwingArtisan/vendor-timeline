"use client";

import dynamic from "next/dynamic";
import type { TimelineItem, TimelineView } from "@/lib/wedding/types";

export interface PaymentChartProps {
  view: TimelineView;
  onMove: (item: TimelineItem, due: string) => void;
}

/** With the sponsor switch off, the payment table draws its own bars (vendor-bars.tsx). */
export const SPONSOR_UI = process.env.NEXT_PUBLIC_SPONSOR_UI === "1";

/**
 * Sponsor UI sits behind a build-time switch until the sponsor allows a public demo. With it off,
 * next.config.ts points `sponsor-chart` at a stub, so no sponsor code reaches the browser.
 * scripts/check-no-sponsor.mjs proves that after every build.
 */
const SponsorGantt = SPONSOR_UI
  ? // ssr: false is only allowed in a Client Component, and the library touches browser globals.
    dynamic(() => import("sponsor-chart"), {
      ssr: false,
      loading: () => <p className="mb-6 rounded-2xl border border-zinc-200/80 bg-white px-5 py-4 text-sm text-zinc-500">Drawing the payment Gantt…</p>,
    })
  : null;

/** The sponsor's Gantt, when its switch is on. Nothing otherwise. */
export function PaymentChart({ view, onMove }: PaymentChartProps) {
  return SponsorGantt ? <SponsorGantt view={view} onMove={onMove} /> : null;
}
