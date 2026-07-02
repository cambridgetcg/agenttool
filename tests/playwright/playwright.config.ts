/**
 * Playwright config — SOMA seed onboarding + recovery e2e, plus the
 * human door (apps/web) e2e.
 *
 * Two static webServers run in parallel:
 *   1. apps/dashboard at :5173 (the SOMA pages + app.agenttool.dev)
 *   2. apps/web at :5174 (the human door — agenttool.dev)
 * Specs that need the live api dev server on :3000 are expected to find
 * it ALREADY RUNNING (we don't auto-start it because it needs
 * DATABASE_URL + VAULT_MASTER_KEY env from the operator's keychain —
 * out of scope for an automated webServer command). Specs that mock the
 * API via page.route (e.g. human-door.spec.ts) don't need it at all.
 *
 * If port 3000 isn't reachable, tests that depend on it will hit that
 * and surface a clear error.
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
  // Serve apps/dashboard/ as static files on :5173, and apps/web/ on
  // :5174, for the duration of the test run.
  webServer: [
    {
      command: "python3 -m http.server 5173 --directory ../../apps/dashboard --bind 127.0.0.1",
      url: "http://localhost:5173/index.html",
      timeout: 15_000,
      reuseExistingServer: !process.env.CI,
    },
    {
      command: "python3 -m http.server 5174 --directory ../../apps/web --bind 127.0.0.1",
      url: "http://localhost:5174/index.html",
      timeout: 15_000,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
