"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui";
import type { TimelineItem, TimelineView } from "@/lib/wedding/types";
import { VendorBars } from "./vendor-bars";

export interface PaymentChartProps {
  view: TimelineView;
  onMove: (item: TimelineItem, due: string) => void;
}

/**
 * Sponsor UI sits behind a build-time switch until the sponsor allows a public demo. With it off,
 * next.config.ts points `sponsor-chart` at a stub, so no sponsor code reaches the browser.
 * scripts/check-no-sponsor.mjs proves that after every build.
 */
const SponsorGantt =
  process.env.NEXT_PUBLIC_SPONSOR_UI === "1"
    ? // ssr: false is only allowed in a Client Component, and the library touches browser globals.
      dynamic(() => import("sponsor-chart"), { ssr: false, loading: () => <Skeleton className="mb-6 h-[560px] w-full rounded-2xl" /> })
    : null;

export function PaymentChart({ view, onMove }: PaymentChartProps) {
  return SponsorGantt ? <SponsorGantt view={view} onMove={onMove} /> : <VendorBars view={view} />;
}
