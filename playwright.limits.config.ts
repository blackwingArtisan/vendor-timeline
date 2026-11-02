import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * The real limits, one case at a time (npm run test:e2e:limits). The main suite turns the AI limit
 * up so it can run fast, so pacing is proved here at the 6 a minute the hosted site uses.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);

export default defineConfig({
  ...base,
  testDir: "tests/limits",
  outputDir: "test-results-limits",
  timeout: 240_000,
  webServer: {
    ...(base.webServer as { command: string; url: string; timeout: number }),
    url: `http://localhost:${PORT}/api/kit/status`,
    env: {
      ...(base.webServer as { env: Record<string, string> }).env,
      AI_RATE_LIMIT_PER_MINUTE: "6",
      AI_RATE_LIMIT_PER_DAY: "60",
    },
  },
});
