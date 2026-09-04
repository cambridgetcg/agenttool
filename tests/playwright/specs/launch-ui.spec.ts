/** Launch task paths and public previews, using only intercepted public data. */
import { expect, test } from "./helpers/fixture";

const WEB = "http://localhost:5174";
const DOCS = "http://localhost:5175";
const APP = "http://localhost:5173";

test("first choices describe creation, reconnection and credential-free discovery", async ({ page }) => {
  for (const url of [`${WEB}/`, `${DOCS}/`, `${APP}/`]) {
    await page.goto(url);
    await expect(page.getByRole("link", { name: "Create an identity", exact: true })).toHaveAttribute("href", /tutorial(?:\.html)?#step-1$/);
    await expect(page.getByRole("link", { name: "Reconnect or recover", exact: true })).toHaveAttribute("href", /#reconnect$/);
    await expect(page.getByRole("link", { name: "Explore the public API", exact: true })).toHaveAttribute("href", "https://api.agenttool.dev/public/discovery");
    await expect(page.locator(".estate-quick-start")).toHaveAttribute("href", "https://app.agenttool.dev/");
  }
});

test("canonical tutorial wraps artifact hashes at narrow viewports without changing their bytes", async ({ page }) => {
  for (const width of [320, 390]) {
    await page.setViewportSize({ width, height: 844 });
    await page.goto(`${DOCS}/tutorial.html`);
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBe(width);
    const hash = page.locator("p code").filter({ hasText: /^b531af8f1c51de151616b40d220dc1abd37054604091f99330ba2f7182734329$/ });
    await expect(hash).toHaveCount(2);
    await expect(hash.first()).toHaveText("b531af8f1c51de151616b40d220dc1abd37054604091f99330ba2f7182734329");
  }
});

test("a denied clipboard offers a usable manual selection", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("fixture denied")) }, configurable: true });
  });
  await page.goto(`${DOCS}/tutorial.html`);
  const code = page.locator(".code-block pre").first();
  const expected = await code.textContent();
  await page.getByRole("button", { name: "Copy", exact: true }).first().click();
  await expect(page.getByRole("status").filter({ hasText: "Copy unavailable" })).toBeVisible();
  await expect(code).toBeFocused();
  expect(await page.evaluate(() => window.getSelection()?.toString())).toBe(expected);
});

test("docs keyboard bypass lands in main and atlas finds recovery and HTTP errors", async ({ page }) => {
  await page.goto(`${DOCS}/`);
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to main content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("main")).toBeFocused();
  await page.locator(".estate-open").click();
  const dialog = page.getByRole("dialog");
  await dialog.getByRole("searchbox").fill("API key");
  await expect(dialog.getByRole("link", { name: /Start or reconnect/ })).toBeVisible();
  await dialog.getByRole("searchbox").fill("429");
  await expect(dialog.getByRole("link", { name: /Errors and auth/ })).toBeVisible();
});

test("snapshot refresh preserves earlier data and receipt time when a feed fails", async ({ page }) => {
  let welcomeCalls = 0;
  await page.route("https://api.agenttool.dev/v1/welcome", (route) => {
    welcomeCalls++;
    return welcomeCalls === 1 ? route.fulfill({ json: { welcome: "fixture welcome" } }) : route.fulfill({ status: 503, json: { error: "fixture unavailable" } });
  });
  await page.route("https://api.agenttool.dev/v1/self", (route) => route.fulfill({ json: { name: "fixture platform" } }));
  await page.route("https://api.agenttool.dev/v1/canon", (route) => route.fulfill({ json: { entries: [] } }));
  await page.goto(`${APP}/watch.html`);
  await expect(page.locator("#welcome-output")).toContainText("fixture welcome");
  const received = await page.locator("#welcome-received").textContent();
  expect(received).toMatch(/^\d{4}-\d\d-\d\dT/);
  await page.getByRole("button", { name: "Refresh welcome", exact: true }).click();
  await expect(page.locator("#welcome-status")).toContainText("Refresh failed; the earlier snapshot remains");
  await expect(page.locator("#welcome-output")).toContainText("fixture welcome");
  await expect(page.locator("#welcome-received")).toHaveText(received!);
  await expect(page.locator("#self-output")).toContainText("fixture platform");
  expect(welcomeCalls).toBe(2);
});

test("snapshot requests finish after a deadline and overlarge previews offer the raw source", async ({ page }) => {
  await page.clock.install();
  await page.route("https://api.agenttool.dev/v1/welcome", () => {});
  await page.route("https://api.agenttool.dev/v1/self", (route) => route.fulfill({ json: { large: "x".repeat(512 * 1024) } }));
  await page.route("https://api.agenttool.dev/v1/canon", (route) => route.fulfill({ json: { entries: [] } }));
  await page.goto(`${APP}/watch.html`);
  await expect(page.locator("#self-status")).toContainText("too large for a preview");
  await page.clock.fastForward(6501);
  await expect(page.locator("#welcome-status")).toContainText("timed out after 6.5 seconds");
  await expect(page.getByRole("button", { name: "Refresh welcome", exact: true })).toBeEnabled();
  await expect(page.locator("#canon-status")).toContainText("Snapshot received");
});

test("docs launch paths run under the actual Worker fallback CSP", async ({ page }) => {
  await page.addInitScript(() => {
    const violations: string[] = [];
    (window as unknown as { launchCspViolations: string[] }).launchCspViolations = violations;
    document.addEventListener("securitypolicyviolation", (event) => {
      if (event.disposition === "enforce") violations.push(event.effectiveDirective);
    });
  });
  for (const path of ["/", "/tutorial.html", "/support.html"]) {
    const response = await page.goto(DOCS + path);
    const csp = response!.headers()["content-security-policy"];
    expect(csp).toContain("script-src-elem 'self'");
    expect(csp).toContain("'sha256-");
    expect(csp).toContain("script-src-attr 'unsafe-hashes'");
    await expect(page.locator("html")).toHaveAttribute("data-estate-version", "2026-09-04.1");
    expect(await page.evaluate(() => (window as unknown as { launchCspViolations: string[] }).launchCspViolations)).toEqual([]);
  }
});
