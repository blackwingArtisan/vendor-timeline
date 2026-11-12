"use client";

/**
 * What `sponsor-chart` loads with the sponsor switch on. Bryntum Gantt is not bundled (see
 * scripts/sponsor-files.ts): its script goes on the page first, then the chart, whose
 * `@bryntum/gantt` imports read the global that script sets.
 */
import type { ComponentType } from "react";
import type { PaymentChartProps } from "./payment-chart";

const SRC = "/sponsor/gantt.umd.js";
let script: Promise<void> | undefined;

function loadScript() {
  script ??= new Promise<void>((resolve, reject) => {
    const tag = document.createElement("script");
    tag.src = SRC;
    tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () => {
      script = undefined;
      tag.remove();
      reject(new Error(`Could not load ${SRC}`));
    };
    document.head.appendChild(tag);
  });
  return script;
}

export default async function loadSponsorChart(): Promise<ComponentType<PaymentChartProps>> {
  await loadScript();
  return (await import("./sponsor-gantt")).default;
}
