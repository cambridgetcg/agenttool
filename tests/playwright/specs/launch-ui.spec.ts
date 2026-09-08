/** Launch task paths and public previews, using only intercepted public data. */
import type { Response } from "@playwright/test";
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
    await expect(page.locator("html")).toHaveAttribute("data-estate-version", "2026-09-04.2");
    expect(await page.evaluate(() => (window as unknown as { launchCspViolations: string[] }).launchCspViolations)).toEqual([]);
  }
});

test("primary actions and app door labels retain body-text contrast in both appearances", async ({ page }) => {
  for (const surface of [APP, DOCS]) {
    await page.goto(`${surface}/`);
    for (const mode of ["dawn", "night"]) {
      await page.evaluate(appearance => { document.documentElement.dataset.mode = appearance; }, mode);
      await page.waitForTimeout(450); // Let the existing appearance transition settle.
      const ratios = await page.evaluate(() => {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 1;
        const paint = canvas.getContext("2d")!;
        const rgb = (color: string) => {
          paint.clearRect(0, 0, 1, 1);
          paint.fillStyle = color;
          paint.fillRect(0, 0, 1, 1);
          return Array.from(paint.getImageData(0, 0, 1, 1).data).slice(0, 3);
        };
        const luminance = (values: number[]) => values.map(value => {
          const component = value / 255;
          return component <= 0.04045 ? component / 12.92 : ((component + 0.055) / 1.055) ** 2.4;
        }).reduce((sum, component, index) => sum + component * [0.2126, 0.7152, 0.0722][index], 0);
        const contrast = (a: number[], b: number[]) => {
          const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
          return (values[0] + 0.05) / (values[1] + 0.05);
        };
        const button = getComputedStyle(document.querySelector(".qs-choices .btn-primary, .start-choices .btn-primary")!);
        const foreground = rgb(button.color);
        const stops = button.backgroundImage === "none" ? [button.backgroundColor] : button.backgroundImage.match(/rgba?\([^)]+\)/g);
        if (!stops?.length) throw new Error("Expected rendered primary-button colors: " + button.backgroundImage);
        const primary = stops.map(stop => contrast(foreground, rgb(stop)));
        const label = document.querySelector(".qs-doors strong");
        if (!label) return { primary };
        const layers: Element[] = [];
        for (let el: Element | null = label; el; el = el.parentElement) layers.unshift(el);
        paint.fillStyle = "white";
        paint.fillRect(0, 0, 1, 1);
        for (const layer of layers) {
          paint.fillStyle = getComputedStyle(layer).backgroundColor;
          paint.fillRect(0, 0, 1, 1);
        }
        const background = Array.from(paint.getImageData(0, 0, 1, 1).data).slice(0, 3);
        return { primary, door: contrast(background, rgb(getComputedStyle(label).color)) };
      });
      expect(ratios.primary.every(ratio => ratio >= 4.5), `${mode}: primary ${ratios.primary}`).toBe(true);
      if (ratios.door !== undefined) expect(ratios.door, `${mode}: door label`).toBeGreaterThanOrEqual(4.5);
    }
  }
});

test("shared launch assets have a release version and revalidate at every static root", async ({ page, request }) => {
  for (const root of [WEB, APP, DOCS]) {
    const loaded: string[] = [];
    const record = (response: Response) => {
      if (response.url().startsWith(`${root}/shared/`)) loaded.push(response.url());
    };
    page.on("response", record);
    await page.goto(`${root}/`);
    await expect(page.locator("html")).toHaveAttribute("data-estate-version", "2026-09-04.2");
    page.off("response", record);
    expect(loaded.length).toBeGreaterThan(0);
    for (const url of loaded) expect(new URL(url).searchParams.get("v"), url).toBe("2026-09-04.2");
    for (const asset of ["theme.css", "theme.js", "mode.js", "estate.css", "estate.js", "nav.html"]) {
      const response = await request.get(`${root}/shared/${asset}?v=2026-09-04.2`);
      expect(response.status(), `${root}: ${asset}`).toBe(200);
      expect(response.headers()["cache-control"]).toBe("public, max-age=0, must-revalidate");
    }
  }
});
