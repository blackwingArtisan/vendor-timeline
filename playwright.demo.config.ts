import { defineConfig, devices } from "@playwright/test";

/**
 * Demo recording (npm run demo:record). Builds the app, starts it, records demo/demo.spec.ts as a
 * 1067x600 .webm, which is a 1280x720 window at 120% browser zoom: the page lays out as it would
 * zoomed, and `npm run demo:mp4` scales it to 1280x720 so text reads at 720p. Copies it to videos/. Mock PayPal unless PAYPAL_MODE=sandbox (or
 * DEMO_PAYPAL_MODE=sandbox); AI is mocked unless DEMO_AI_MODE=live.
 * DEMO_BASE_URL records against a deployed copy instead (the hosted site, where PayPal's webhook
 * can reach the app), and starts no local server.
 */
const PORT = Number(process.env.DEMO_PORT ?? 3400);
const HOSTED = process.env.DEMO_BASE_URL;
/** 1280x720 at 120% zoom. Screenshots are drawn at that zoom too, so they come out 1280x720. */
const SIZE = { width: 1067, height: 600 };
const ZOOM = 1.2;
const PAYPAL_MODE = process.env.DEMO_PAYPAL_MODE ?? process.env.PAYPAL_MODE ?? "mock";
// Start clean, so the audit log on screen is only this story. Sandbox has no reset route, so fill
// its ledger with the shared seed data.
// No kit seed: the app's ledger holds only its own PayPal orders.
const SETUP = "rm -rf .data-demo && ";

export default defineConfig({
  testDir: "demo",
  // A hosted take (Render, live AI, PayPal's sandbox) waits far longer off camera than a local one.
  timeout: 480_000,
  expect: { timeout: 20_000 },
  workers: 1,
  reporter: [["list"]],
  outputDir: "test-results/demo",
  use: {
    baseURL: HOSTED ?? `http://localhost:${PORT}`,
    viewport: SIZE,
    deviceScaleFactor: ZOOM,
    video: { mode: "on", size: SIZE },
    launchOptions: { slowMo: 80 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: SIZE, deviceScaleFactor: ZOOM } }],
  webServer: HOSTED ? undefined : {
    // Production build: no dev reloads or overlays in the recording.
    command: `${SETUP}npx next build && npx next start --port ${PORT}`,
    url: `http://localhost:${PORT}/api/kit/status`,
    reuseExistingServer: true,
    timeout: 300_000,
    env: {
      PAYPAL_MODE,
      AI_MODE: process.env.DEMO_AI_MODE ?? "mock",
      // A live-AI recording spends at most 40 cents; it usually spends under one.
      AI_DAILY_CAP_USD: process.env.DEMO_AI_CAP_USD ?? "0.40",
      KIT_DATA_DIR: ".data-demo",
      MOCK_PAYPAL_LATENCY_MS: "250-600",
      DEMO_TEST_CARD: "1",
      NEXT_DIST_DIR: ".next-e2e",
    },
  },
});
