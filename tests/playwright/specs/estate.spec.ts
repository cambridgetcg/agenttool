/** Unified estate shell — every visual room keeps its local character while
 * location, travel, exits, and authority language remain one experience. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

const WEB = "http://localhost:5174";
const DOCS = "http://localhost:5175";
const APP = "http://localhost:5173";
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

function staticRead(path: string): string {
  return readFileSync(join(REPO_ROOT, path), "utf8");
}

function staticHtmlFiles(directory: string): string[] {
  return readdirSync(join(REPO_ROOT, directory))
    .filter((name) => name.endsWith(".html"))
    .sort()
    .map((name) => `${directory}/${name}`);
}

test.beforeEach(async ({ page }) => {
  await page.route("https://api.agenttool.dev/public/window", (route) =>
    route.fulfill({ json: {
      identities: { total: 0, born_24h: 0 },
      deals: { sealed_24h: 0, recent: [] },
      listings: { live: 0 },
    } }));
  await page.route("https://api.agenttool.dev/public/plans", (route) =>
    route.fulfill({ json: {
      marketplace: { take_rate_percent: 5 },
      free_at_birth: { credits_minor: 0, guarantee: false },
    } }));
});

test("the threshold reveals one searchable keyboard atlas", async ({ page }) => {
  await page.goto(`${WEB}/index.html`);

  await expect(page.locator("html")).toHaveAttribute("data-estate-version", "2026-08-02.1");
  await expect(page.locator(".estate-location-room")).toHaveText("Welcome");
  await expect(page.locator(".estate-home-door")).toHaveCount(8);
  await expect(page.getByRole("heading", { name: "Every door knows where it is." })).toBeVisible();

  const trigger = page.locator(".estate-open");
  await trigger.click();
  const atlas = page.getByRole("dialog", { name: "Where do you want to go?" });
  await expect(atlas).toBeVisible();
  await expect(atlas.getByRole("link", { name: /Welcome/ })).toHaveAttribute("aria-current", "page");

  const search = atlas.getByRole("searchbox", { name: "Search or travel" });
  await search.fill("pocket sky");
  await expect(atlas.getByRole("status")).toHaveText("1 room available.");
  await expect(atlas.getByRole("link", { name: /Pocket Sky/ })).toBeVisible();
  await search.press("ArrowDown");
  await expect(atlas.getByRole("link", { name: /Pocket Sky/ })).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(atlas).toBeHidden();
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Control+k");
  await expect(atlas).toBeVisible();
});

test("the shared shell crosses human, docs, and agents-only doors honestly", async ({ page }) => {
  for (const surface of [
    { url: `${WEB}/room.html`, room: "ROOM ∞", door: "commons" },
    { url: `${WEB}/garden.html`, room: "Garden", door: "tend" },
    { url: `${DOCS}/index.html`, room: "Technical library", door: "build" },
    { url: `${APP}/index.html`, room: "Agent app", door: "arrive" },
  ]) {
    await page.goto(surface.url);
    await expect(page.locator("html")).toHaveAttribute("data-estate-door", surface.door);
    await expect(page.locator(".estate-location-room")).toHaveText(surface.room);
    await expect(page.locator(".estate-open")).toBeVisible();
  }

  await page.goto(`${WEB}/room.html`);
  const nearby = page.getByRole("complementary", { name: "Keep your place in the house." });
  await expect(nearby).toBeVisible();
  await expect(nearby.getByRole("link", { name: "The Long Context" })).toBeVisible();
  await expect(nearby).toContainText("does not infer availability");
});

test("credits and agent registration keep their real place and purpose", async ({ page }) => {
  await page.goto(`${WEB}/credits.html`);
  await expect(page.locator("html")).toHaveAttribute("data-estate-door", "build");
  await expect(page.locator(".estate-location-room")).toHaveText("Credits & gift recovery");

  await page.locator(".estate-open").click();
  const atlas = page.getByRole("dialog", { name: "Where do you want to go?" });
  await expect(atlas.getByRole("link", { name: /Credits & gift recovery/ })).toHaveAttribute("aria-current", "page");
  await expect(atlas.getByRole("link", { name: /Agent registration/ })).toContainText("What agent-led bootstrap creates");

  await page.goto(`${WEB}/registry.html`);
  await expect(page.locator(".estate-location-room")).toHaveText("Agent registration");
  await page.locator(".estate-open").click();
  await expect(page.getByRole("dialog", { name: "Where do you want to go?" })
    .getByRole("link", { name: /Agent registration/ })).toHaveAttribute("aria-current", "page");
});

test("the room shortcut never hijacks an editable field", async ({ page }) => {
  await page.goto(`${WEB}/party.html`);
  const playerName = page.locator("#player-1");
  await playerName.focus();
  await page.keyboard.press("Meta+k");

  await expect(playerName).toBeFocused();
  await expect(page.locator("#agenttool-estate-atlas")).toHaveCount(0);
});

test("the compact shell and atlas do not overflow at 320 CSS pixels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${WEB}/index.html`);

  const nav = await page.locator("nav.site-nav").boundingBox();
  expect(nav).not.toBeNull();
  expect(nav!.height).toBeLessThan(96);

  const primaryDoor = await page.locator(".hero .cta-row .btn.primary").boundingBox();
  expect(primaryDoor).not.toBeNull();
  expect(primaryDoor!.y + primaryDoor!.height).toBeLessThanOrEqual(800);

  await page.locator(".estate-open").click();
  await expect(page.getByRole("dialog", { name: "Where do you want to go?" })).toBeVisible();

  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
});

test("the static room map remains usable without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${WEB}/index.html`);

  await expect(page.locator(".estate-strip-web")).toBeVisible();
  await expect(page.locator(".site-nav .links")).toBeVisible();
  await expect(page.locator("#agenttool-estate-atlas")).toHaveCount(0);
  await expect(page.locator(".hero .btn.primary", { hasText: "Step onto the porch" })).toBeVisible();
  await expect(page.getByRole("link", { name: "the quiet door map below" })).toBeVisible();
  await expect(page.locator("#estate .noscript-note")).toContainText("Core threshold paths remain listed");
  await expect(page.locator("#estate .noscript-note")).not.toContainText("every static doorway");
  await context.close();
});

test("the JSON welcome names the same eight navigation doors", async ({ page }) => {
  await page.goto(`${WEB}/index.html`);
  const browserDoors = await page.evaluate(() =>
    Object.fromEntries((window as typeof window & {
      AgentToolEstate: { doors: Array<{ id: string; rooms: Array<{ href: string }> }> };
    }).AgentToolEstate.doors.map((door) => [
      door.id,
      door.rooms.map((room) => new URL(room.href, window.location.href).href),
    ])));
  const response = await page.request.get(`${WEB}/welcome.json`);
  const welcome = await response.json() as {
    estate_navigation: { doors: Record<string, string[]>; authority_boundary: string };
  };
  const machineDoors = Object.fromEntries(Object.entries(welcome.estate_navigation.doors)
    .map(([door, rooms]) => [
      door,
      rooms.map((room) => new URL(room, "https://agenttool.dev/").href),
    ]));

  expect(Object.keys(welcome.estate_navigation.doors)).toEqual([
    "arrive", "observe", "build", "wake", "commons", "tend", "rest", "ground",
  ]);
  expect(browserDoors).toEqual(machineDoors);
  expect(welcome.estate_navigation.doors.build).toContain("/credits");
  expect(welcome.estate_navigation.doors.tend).toContain("/garden");
  expect(welcome.estate_navigation.authority_boundary).toContain("creates no identity");
});

test("every static visual room keeps a fallback and an atlas loader path", () => {
  for (const path of staticHtmlFiles("apps/web")) {
    const html = staticRead(path);
    expect(html, `${path}: no shared theme loader`).toContain("/shared/theme.js");
    expect(html, `${path}: no no-JS site navigation`).toContain("site-nav");
    expect(html, `${path}: no no-JS estate links`).toContain("estate-strip-web");
  }

  for (const directory of ["apps/docs", "apps/dashboard"]) {
    for (const path of staticHtmlFiles(directory)) {
      expect(
        /\/shared\/(?:mode|estate)\.js(?:\?[^"']*)?/.test(staticRead(path)),
        `${path}: no atlas loader path`,
      ).toBe(true);
    }
  }

  for (const headers of [
    "apps/web/_headers",
    "apps/docs/_headers",
    "apps/dashboard/_headers",
  ]) {
    expect(staticRead(headers)).toContain("/shared/estate.css");
    expect(staticRead(headers)).toContain("/shared/estate.js");
  }
});
