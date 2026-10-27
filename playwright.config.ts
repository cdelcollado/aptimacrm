import { defineConfig, devices } from "@playwright/test";
import { E2E } from "./tests/e2e/config";

/**
 * Browser tests. `npm run test:e2e` builds the app, then starts scripts/e2e-stack.ts (fresh database,
 * seed data, worker, production server) before running two viewports: desktop and a 390px phone.
 */
export default defineConfig({
  testDir: "tests/e2e",
  testMatch: /.*\.spec\.ts/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: E2E.baseUrl,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    locale: "en-GB",
  },
  webServer: {
    command: "npx tsx scripts/e2e-stack.ts",
    url: `${E2E.baseUrl}/api/health`,
    reuseExistingServer: false,
    timeout: 240_000,
    stdout: "pipe",
    stderr: "pipe",
  },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { ...devices["Pixel 5"], viewport: { width: 390, height: 844 } }, testMatch: /journey|permissions/ },
  ],
});
