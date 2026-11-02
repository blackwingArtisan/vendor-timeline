import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

/**
 * The real limits (npm run test:e2e:limits). Each case runs on its own server.
 * Pacing: the main suite turns the AI limit up to run fast, so this proves it at the hosted 6 a minute.
 * LIMIT_CASE=credit: real AI code against a stand-in for Anthropic that says the credit has run out.
 */
const PORT = Number(process.env.E2E_PORT ?? 3100);
const FAKE_AI_PORT = PORT + 1000;
const credit = process.env.LIMIT_CASE === "credit";
const app = base.webServer as { command: string; timeout: number; env: Record<string, string> };

export default defineConfig({
  ...base,
  testDir: "tests/limits",
  testMatch: credit ? "credit.spec.ts" : "pacing.spec.ts",
  outputDir: "test-results-limits",
  timeout: 240_000,
  webServer: [
    ...(credit ? [{ command: `node tests/limits/fake-anthropic.mjs ${FAKE_AI_PORT}`, url: `http://127.0.0.1:${FAKE_AI_PORT}/calls`, reuseExistingServer: false }] : []),
    {
      ...app,
      url: `http://localhost:${PORT}/api/kit/status`,
      env: {
        ...app.env,
        AI_RATE_LIMIT_PER_MINUTE: credit ? "100" : "6",
        AI_RATE_LIMIT_PER_DAY: "60",
        ...(credit ? { AI_MODE: "live", ANTHROPIC_API_KEY: "sk-ant-not-a-real-key", ANTHROPIC_BASE_URL: `http://127.0.0.1:${FAKE_AI_PORT}` } : {}),
      },
    },
  ],
});
