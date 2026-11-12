import type { NextConfig } from "next";
import { loadEnvFiles, readKitEnv } from "./src/lib/env-core";
import { prepareSponsorFiles, SPONSOR_SHIM } from "./scripts/sponsor-files";

// Load .env.local, then ../../.env.shared (apps/<slug>) or ../.env.shared (the kit), and
// refuse to start (dev, build or start) unless PAYPAL_MODE is "mock" or "sandbox".
loadEnvFiles();
const env = readKitEnv();
if (process.env.NEXT_PHASE !== "phase-production-build" || process.env.KIT_LOG_ENV) {
  console.log(`[kit] PayPal: ${env.paypalMode} · AI: ${env.aiMode} · daily AI cap $${env.aiDailyCapUsd}`);
}

// A plain `if` leaves sponsor code in the bundle, so with the switch off the import itself goes to a
// stub. `npm run check` greps the build to prove it. `sponsor-chart` has no other meaning.
const sponsorOn = process.env.NEXT_PUBLIC_SPONSOR_UI === "1";
const sponsorChart = sponsorOn ? "./src/components/wedding/sponsor-load.ts" : "./src/components/wedding/sponsor-off.tsx";
// Bundling Bryntum's 6 MB module needs ~14 GB of RAM, so with the switch on it is served as its own
// script from public/sponsor/ and "@bryntum/gantt" resolves to a shim over its global.
prepareSponsorFiles(sponsorOn);
const sponsorAlias: Record<string, string> = sponsorOn ? { "@bryntum/gantt": `./${SPONSOR_SHIM}` } : {};

const nextConfig: NextConfig = {
  // Lets e2e/demo runs use their own build dir next to a running `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // A separate build dir gets its own tsconfig so Next never rewrites the main one.
  typescript: { tsconfigPath: process.env.NEXT_DIST_DIR ? "tsconfig.e2e.json" : "tsconfig.json" },
  cacheComponents: true,
  partialPrefetching: true,
  // CommonJS + Node-only deps (axios, paypal-server-sdk, an npm package named "os").
  serverExternalPackages: ["@paypal/agent-toolkit"],
  poweredByHeader: false,
  // No floating dev badge: it would show up in demo recordings.
  devIndicators: false,
  turbopack: {
    resolveAlias: { "sponsor-chart": sponsorChart, ...sponsorAlias },
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
