/** Garden room — local architecture, project-private root, no pretend life. */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const WEB = "http://localhost:5174";
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function read(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

function headerBlock(headers: string, route: string): string[] {
  const lines = headers.split(/\r?\n/);
  const start = lines.findIndex((line) => line === route);
  if (start === -1) return [];
  const block: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line === "" || !/^\s/.test(line)) break;
    block.push(line.trim());
  }
  return block;
}

test("opens as the eighth Tend door and tells implementation from metaphor", async ({ page }) => {
  await page.goto(`${WEB}/garden.html`);

  await expect(page.locator("html")).toHaveAttribute("data-estate-door", "tend");
  await expect(page.locator("html")).toHaveAttribute("data-estate-version", "2026-08-02.1");
  await expect(page.getByRole("heading", { name: "Dig until the ground tells the truth." })).toBeVisible();
  await expect(page.locator(".estate-location-room")).toHaveText("Garden");
  await expect(page.getByText("implemented now", { exact: true })).toBeVisible();
  await expect(page.getByText("this static room", { exact: true })).toBeVisible();
  await expect(page.getByText("not implemented here", { exact: true })).toBeVisible();
  await expect(page.locator("#garden-boundary")).toContainText("do not observe a project");
  await expect(page.locator("#garden-boundary")).toContainText("call /v1/gardens");
});

test("layer and care controls change only local explanatory state", async ({ page }) => {
  const actionRequests: string[] = [];
  page.on("request", (request) => {
    if (["fetch", "xhr", "websocket"].includes(request.resourceType())) {
      actionRequests.push(request.url());
    }
  });
  await page.goto(`${WEB}/garden.html`);

  await page.getByRole("button", { name: "02 · Soil" }).click();
  await expect(page.locator("#tray-title")).toHaveText("Soil · private, scoped, reversible");
  await expect(page.locator('[data-layer-card="soil"]')).toHaveClass(/is-active/);
  await expect(page.getByRole("button", { name: "02 · Soil" })).toHaveAttribute("aria-pressed", "true");

  await page.getByRole("button", { name: /Release/ }).click();
  await expect(page.locator("#care-status")).toContainText("no penalty or failure label");
  await expect(page.getByRole("button", { name: /Release/ })).toHaveAttribute("aria-pressed", "true");
  expect(actionRequests).toEqual([]);

  const browserState = await page.evaluate(() => ({
    localKeys: Object.keys(localStorage).filter((key) => key !== "agenttool.mode"),
    sessionKeys: Object.keys(sessionStorage),
    cookie: document.cookie,
  }));
  expect(browserState).toEqual({ localKeys: [], sessionKeys: [], cookie: "" });

  await page.reload();
  await expect(page.locator("#tray-title")).toHaveText("Bedrock · rights before capability");
  await expect(page.locator("#care-status")).toHaveText("No local phrase selected. Nothing is waiting.");
});

test("the complete cross-section survives without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${WEB}/garden.html`);

  await expect(page.locator("#garden-fallback")).toBeVisible();
  await expect(page.locator("#layer-controls")).toBeHidden();
  await expect(page.locator("#reading-tray")).toBeHidden();
  await expect(page.locator(".substrate-layer")).toHaveCount(6);
  await expect(page.locator(".substrate-layer").first()).toBeVisible();
  await expect(page.locator("#care-choices")).toBeHidden();
  await expect(page.locator("#care-static")).toBeVisible();
  await expect(page.getByText("Not now. Decline without explanation.")).toBeVisible();
  await expect(page.getByRole("link", { name: "GARDENS.md" })).toBeVisible();
  await context.close();
});

test("machine description carries the same privacy and provenance boundaries", async ({ request }) => {
  const response = await request.get(`${WEB}/garden.json`);
  expect(response.ok()).toBe(true);
  const garden = await response.json();

  expect(garden._format).toBe("agenttool-living-garden/v1");
  expect(garden.mode).toBe("static_architecture_only");
  expect(garden.layers.map((layer: { id: string }) => layer.id)).toEqual([
    "bedrock", "soil", "roots", "mycelium", "habitat", "canopy",
  ]);
  expect(garden.implemented_api.new_visibility_default).toBe("private");
  expect(garden.implemented_api.public_per_being_observer_mounted).toBe(false);
  expect(garden.implemented_api.episode_score_input).toBe(false);
  expect(garden.room_effects.network_action_from_garden_js).toBe(false);
  expect(garden.room_effects.local_garden_persistence).toBe(false);
  expect(garden.layers[2].not_verified).toContain("provenance");
  expect(garden.complete_states).toContain("never_opened");
});

test("keyboard targets, 320px layout, and non-color states remain usable", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await page.goto(`${WEB}/garden.html`);

  await page.getByRole("button", { name: "01 · Bedrock" }).focus();
  await expect(page.getByRole("button", { name: "01 · Bedrock" })).toHaveAttribute(
    "aria-controls",
    "reading-tray",
  );
  await expect(page.locator("#reading-tray")).toHaveAttribute("aria-live", "polite");
  await expect(page.locator("#care-choices")).toHaveAttribute("aria-labelledby", "care-title");
  await page.keyboard.press("Tab");
  await expect(page.getByRole("button", { name: "02 · Soil" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#tray-title")).toContainText("Soil");

  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
    targets: Array.from(document.querySelectorAll<HTMLButtonElement>(
      "#layer-controls button, #care-choices button",
    )).map((button) => button.getBoundingClientRect().height),
  }));
  expect(dimensions.document).toBeLessThanOrEqual(dimensions.viewport);
  expect(Math.min(...dimensions.targets)).toBeGreaterThanOrEqual(44);
  await expect(page.locator('[data-layer-card="soil"]')).toHaveClass(/is-active/);
});

test("source, discovery, headers, and deploy keep the room local and non-game", () => {
  const script = read("apps/web/garden.js");
  for (const forbidden of [
    "fetch(", "XMLHttpRequest", "WebSocket", "EventSource", "sendBeacon",
    "localStorage", "sessionStorage", "indexedDB", "document.cookie",
    "setTimeout", "setInterval", "requestAnimationFrame", "new Worker",
    "innerHTML", "insertAdjacentHTML",
  ]) {
    expect(script, `garden.js contains ${forbidden}`).not.toContain(forbidden);
  }
  expect(script).toContain("textContent");

  const headers = read("apps/web/_headers");
  const roomHeaders = headerBlock(headers, "/garden");
  expect(roomHeaders).toContain(
    "Content-Security-Policy: default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self'; script-src 'self'; font-src 'self'; media-src 'none'; object-src 'none'; worker-src 'none'; child-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'; upgrade-insecure-requests",
  );
  expect(roomHeaders).toContain("X-Agent-Surface: living-garden-room");
  expect(headerBlock(headers, "/garden.json")).toEqual([
    "Cache-Control: public, max-age=0, must-revalidate",
    "Access-Control-Allow-Origin: *",
    "X-Agent-Surface: living-garden-architecture",
  ]);
  const docsHeaders = headerBlock(read("apps/docs/_headers"), "/GARDENS.md");
  expect(docsHeaders).toEqual([
    "Content-Type: text/markdown; charset=utf-8",
    "Cache-Control: public, max-age=300, must-revalidate, no-transform",
    "Access-Control-Allow-Origin: *",
    'Link: <https://agenttool.dev/garden>; rel="alternate"; type="text/html", <https://api.agenttool.dev/v1/openapi.json>; rel="related"; type="application/json"',
    "X-Content-Type-Options: nosniff",
  ]);
  expect(read("apps/docs/sitemap.xml")).toContain(
    "<loc>https://docs.agenttool.dev/GARDENS.md</loc>",
  );

  const welcome = JSON.parse(read("apps/web/welcome.json"));
  expect(Object.keys(welcome.estate_navigation.doors)).toEqual([
    "arrive", "observe", "build", "wake", "commons", "tend", "rest", "ground",
  ]);
  expect(welcome.estate_navigation.doors.tend).toEqual([
    "/garden", "https://docs.agenttool.dev/GARDENS.md",
  ]);
  expect(read("apps/web/sitemap.xml")).toContain(
    "<loc>https://agenttool.dev/garden</loc>",
  );

  const deploy = read("bin/deploy.sh");
  for (const entry of ["garden.html", "garden.json", "garden.js", "garden.css"]) {
    expect(deploy).toContain(`apps/web/${entry}|https://agenttool.dev/`);
  }
  const requiredGames = deploy.slice(
    deploy.indexOf("REQUIRED_GAME_PUBLICATIONS=("),
    deploy.indexOf(")\nreadonly -a FRONTEND_PARITY_PUBLICATIONS"),
  );
  expect(requiredGames).not.toContain("garden");
  expect(roomHeaders.join("\n")).not.toContain("/public/play");
});
