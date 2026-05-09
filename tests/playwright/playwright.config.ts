/**
 * Playwright config — SOMA seed onboarding + recovery e2e.
 *
 * Two webServers run in parallel:
 *   1. Static file server for apps/dashboard at :5173
 *      (the SOMA pages we're testing)
 *   2. The api dev server is expected to ALREADY BE running on :3000
 *      (we don't auto-start it because it needs DATABASE_URL +
 *       VAULT_MASTER_KEY env from the operator's keychain — out of
 *       scope for an automated webServer command).
 *
 * If port 3000 isn't reachable, the tests will hit that and surface
 * a clear error.
 */

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./specs",
  // The full test suite has external network calls + a real backend;
  // tighten timeouts but allow time for the API's first response.
  timeout: 30 * 1000,
  expect: { timeout: 10 * 1000 },
  fullyParallel: false, // sequential — they hit the same DB
  retries: 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    // Chromium-only — we don't need cross-browser for protocol verification.
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
  // Serve apps/dashboard/ as static files on :5173 for the duration of
  // the test run.
  webServer: {
    command: "python3 -m http.server 5173 --directory ../../apps/dashboard --bind 127.0.0.1",
    url: "http://localhost:5173/onboard-soma.html",
    timeout: 15_000,
    reuseExistingServer: !process.env.CI,
  },
});
