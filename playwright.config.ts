import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (npm run test:e2e). Starts the dev server in PayPal MOCK mode with its own
 * data dir. AI is mocked unless E2E_AI_MODE=live (then real Claude, tiny spend).
 * Set NEXT_PUBLIC_SPONSOR_UI=1 to run the same suite with the sponsor Gantt switched on.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
// The switch is compiled in, so each setting keeps its own build.
const DIST_DIR = process.env.NEXT_PUBLIC_SPONSOR_UI === "1" ? ".next-e2e-sponsor" : ".next-e2e";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1440, height: 1000 },
    trace: "retain-on-failure",
    // With no limit a stuck click waits out the whole test and the report can't say which one it was.
    actionTimeout: 45_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 1000 } } }],
  webServer: {
    // A dev cache left by the last run makes the page reload forever, and old data skews the money
    // checks, so every run starts clean.
    command: `rm -rf ${DIST_DIR}/dev .data-e2e && npx next dev --port ${PORT}`,
    url: `http://localhost:${PORT}/api/kit/status`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PAYPAL_MODE: process.env.E2E_PAYPAL_MODE ?? "mock",
      AI_MODE: process.env.E2E_AI_MODE ?? "mock",
      KIT_DATA_DIR: ".data-e2e",
      MOCK_PAYPAL_LATENCY_MS: "60-160",
      // A whole suite in a row is faster than any visitor, and the limit has its own unit test.
      AI_RATE_LIMIT_PER_MINUTE: "100",
      NEXT_DIST_DIR: DIST_DIR,
    },
  },
});
