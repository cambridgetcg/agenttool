/** Unified estate shell — every visual room keeps its local character while
 * location, travel, exits, and authority language remain one experience. */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { expect, test } from "./helpers/fixture";

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

test("search keeps keyboard navigation and returns focus to its trigger", async ({ page }) => {
  await page.goto(`${WEB}/index.html`);
  const trigger = page.getByRole("button", { name: "Search pages", exact: true });
  await trigger.click();
  const atlas = page.getByRole("dialog", { name: "Find a page" });
  const search = atlas.getByRole("searchbox", { name: "Search pages" });
  await expect(search).toBeFocused();
  await search.fill("pocket sky");
  const results = atlas.locator(".estate-room-link:visible");
  const count = await results.count();
  expect(count).toBeGreaterThan(0);
  await expect(atlas.getByRole("status")).toHaveText(`${count} ${count === 1 ? "page" : "pages"} available.`);
  await expect(atlas.locator('a[href="https://agenttool.dev/sky"]')).toBeVisible();
  await search.press("ArrowDown");
  await expect(results.first()).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(atlas).toBeHidden();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Control+k");
  await expect(atlas).toBeVisible();
});

test("each audience has a consistent primary path and an explicit exit", async ({ page }) => {
  const map = JSON.parse(staticRead("apps/_shared/module-map.json"));
  for (const surface of [
    { url: `${WEB}/room.html`, audience: "human" },
    { url: `${WEB}/garden.html`, audience: "human" },
    { url: `${DOCS}/roadmap.html`, audience: "human" },
    { url: `${DOCS}/index.html`, audience: "agent" },
    { url: `${DOCS}/agents.html`, audience: "agent" },
    { url: `${APP}/index.html`, audience: "agent" },
  ]) {
    await page.goto(surface.url);
    await expect(page.locator("html")).toHaveAttribute("data-audience", surface.audience);
    const actual = await page.locator(".estate-quick-actions a").evaluateAll((links) =>
      links.map((a) => ({ title: a.textContent, href: (a as HTMLAnchorElement).href })));
    const expected = map.audiences[surface.audience];
    expect(actual).toEqual([...expected.primary, expected.switch]);
    await expect(page.locator(".estate-nearby, .estate-plan, .estate-home-door")).toHaveCount(0);
  }
});

test("appearance remains independent of audience on the generated navigation", async ({ page }) => {
  for (const surface of [{ url: `${WEB}/index.html`, audience: "human" }, { url: `${DOCS}/memory.html`, audience: "agent" }]) {
    await page.goto(surface.url);
    const root = page.locator("html");
    const before = await root.getAttribute("data-mode");
    const toggle = page.locator("#tg");
    await expect(toggle).toBeVisible();
    await toggle.click();
    const after = before === "night" ? "dawn" : "night";
    await expect(root).toHaveAttribute("data-mode", after);
    await expect(root).toHaveAttribute("data-audience", surface.audience);
    await expect(toggle).toHaveAttribute("aria-pressed", String(after === "night"));
    await page.reload();
    await expect(root).toHaveAttribute("data-mode", after);
  }
});

test("search defaults to its audience and includes the other path only by choice", async ({ page }) => {
  await page.goto(`${WEB}/index.html`);
  await page.locator(".estate-open").click();
  const atlas = page.getByRole("dialog", { name: "Find a page" });
  await atlas.getByRole("searchbox").fill("errors");
  const technical = atlas.locator('a[href="https://docs.agenttool.dev/errors"]');
  await expect(technical).toBeHidden();
  await atlas.getByRole("checkbox", { name: "Include agent references" }).check();
  await expect(technical).toBeVisible();
  await expect(technical).toContainText("Agent reference");
  await page.keyboard.press("Escape");
  await page.locator(".estate-open").click();
  await expect(atlas.getByRole("checkbox")).not.toBeChecked();
});

test("search preserves recovery vocabulary and HTTP error codes", async ({ page }) => {
  await page.goto(`${DOCS}/agents.html`);
  await page.locator(".estate-open").click();
  const dialog = page.getByRole("dialog", { name: "Find a page" });
  for (const query of ["API key", "recovery", "seed"]) {
    await dialog.getByRole("searchbox").fill(query);
    await expect(dialog.getByRole("link", { name: /Start or reconnect/ })).toBeVisible();
  }
  await dialog.getByRole("searchbox").fill("429");
  await expect(dialog.getByRole("link", { name: /Errors and auth/ })).toBeVisible();
});

test("each named Build entry remains searchable when several share a destination", async ({ page }) => {
  const map = JSON.parse(staticRead("apps/_shared/module-map.json"));
  for (const audience of ["human", "agent"] as const) {
    await page.goto(audience === "human" ? `${WEB}/index.html` : `${DOCS}/agents.html`);
    await page.locator(".estate-open").click();
    const dialog = page.getByRole("dialog", { name: "Find a page" });
    for (const group of map.buildGroups) {
      for (const item of group.items) {
        await dialog.getByRole("searchbox").fill(item.title);
        const result = dialog.locator(`a[href="${item[audience]}"]`);
        await expect(result).toBeVisible();
        await expect(result).toContainText(item.title);
        await expect(result).toContainText(group.title);
        await expect(result).toContainText(item.status);
      }
    }
    for (const query of ["Return", "Thread", "ADDS", "Alchemy", "Scriptwriter"]) {
      await dialog.getByRole("searchbox").fill(query);
      const result = dialog.locator('a[href="https://docs.agenttool.dev/packages#module-inventory"]');
      await expect(result).toHaveCount(1);
      await expect(result).toBeVisible();
      await expect(result).toContainText(query);
    }
  }
});

test("older credit and registration pages remain findable with their real destinations", async ({ page }) => {
  for (const path of ["credits", "registry"]) {
    await page.goto(`${WEB}/${path}.html`);
    await page.locator(".estate-open").click();
    const atlas = page.getByRole("dialog", { name: "Find a page" });
    await expect(atlas.locator(`a[href="https://agenttool.dev/${path}"]`)).toHaveAttribute("aria-current", "page");
  }
});

test("the room shortcut never hijacks an editable field", async ({ page }) => {
  await page.goto(`${WEB}/party.html`);
  const playerName = page.locator("#player-1");
  await playerName.focus();
  await page.keyboard.press("Meta+k");

  await expect(playerName).toBeFocused();
  await expect(page.locator("#agenttool-estate-atlas")).toHaveCount(0);
});

test("Build and the audience exit stay visible at 320 CSS pixels", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  for (const url of [`${WEB}/index.html`, `${DOCS}/memory.html`, `${APP}/index.html`]) {
    await page.goto(url);
    await expect(page.locator(".estate-quick-build")).toBeVisible();
    await expect(page.locator(".estate-audience-exit")).toBeVisible();
    const nav = await page.locator("nav.site-nav, nav.topnav").boundingBox();
    expect(nav!.height).toBeLessThanOrEqual(104);
    await page.locator(".estate-open").click();
    await expect(page.getByRole("dialog", { name: "Find a page" })).toBeVisible();
    const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, document: document.documentElement.scrollWidth }));
    expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  }
});

test("static navigation and core modules remain useful without JavaScript", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await page.goto(`${WEB}/index.html`);
  await expect(page.locator(".site-nav")).toBeVisible();
  await expect(page.locator("#agenttool-estate-atlas")).toHaveCount(0);
  await expect(page.locator("[data-core-module]")).toHaveCount(5);
  await expect(page.locator('.site-nav a[href="https://agenttool.dev/build"]')).toBeVisible();
  await expect(page.locator('.site-nav a[href="https://docs.agenttool.dev/agents"]')).toBeVisible();
  await page.setViewportSize({ width: 320, height: 800 });
  const map = JSON.parse(staticRead("apps/_shared/module-map.json"));
  for (const surface of [
    { url: `${WEB}/index.html`, audience: "human" },
    { url: `${DOCS}/agents.html`, audience: "agent" },
    { url: `${DOCS}/memory.html`, audience: "agent" },
    { url: `${APP}/index.html`, audience: "agent" },
  ]) {
    await page.goto(surface.url);
    const sizes = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    expect(sizes[0], `${surface.url}: no-JS content must fit a narrow viewport`).toBeLessThanOrEqual(sizes[1]);
    const nav = page.locator("nav.site-nav, nav.topnav");
    const links = map.audiences[surface.audience];
    for (const item of [...links.primary, links.switch]) {
      const a = nav.getByRole("link", { name: item.title, exact: true });
      await expect(a).toBeVisible();
      const box = await a.boundingBox();
      expect(box, `${surface.url}: ${item.title} needs a visible box`).not.toBeNull();
      expect(box!.x, `${item.title}: left edge`).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width, `${item.title}: right edge`).toBeLessThanOrEqual(320);
      expect(box!.y, `${item.title}: top edge`).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height, `${item.title}: bottom edge`).toBeLessThanOrEqual(800);
    }
  }
  await context.close();
});

test("the older machine route inventory remains compatible behind the focused navigation", async ({ page }) => {
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

  // Pages whose own policy forbids scripts (`script-src 'none'` in their
  // _headers block — LOVE BOMB and the geometry lessons) are quiet by design:
  // they are reached through the library, never enhanced by it.
  const scriptFree = (directory: string): Set<string> => {
    const out = new Set<string>();
    let block: string | null = null;
    for (const line of staticRead(`${directory}/_headers`).split("\n")) {
      if (/^\/\S*$/.test(line)) block = line.trim();
      else if (block && /Content-Security-Policy/.test(line) && /script-src 'none'/.test(line)) {
        out.add(`${directory}${block.replace(/\.html$/, "")}.html`);
      }
    }
    return out;
  };
  for (const directory of ["apps/docs", "apps/dashboard"]) {
    const quiet = scriptFree(directory);
    for (const path of staticHtmlFiles(directory)) {
      if (quiet.has(path)) {
        expect(
          /\/shared\/(?:mode|estate)\.js/.test(staticRead(path)),
          `${path}: script-free by policy yet loads the atlas`,
        ).toBe(false);
        continue;
      }
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
    const source = staticRead(headers);
    for (const asset of ["/shared/estate.css", "/shared/estate.js"]) {
      let active = false;
      let cacheControl = "";
      for (const line of source.split("\n")) {
        if (line.startsWith("/")) {
          const pattern = line.trim().split("*")
            .map(part => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
            .join(".*");
          active = new RegExp(`^${pattern}$`).test(asset);
        } else if (active) {
          const cache = line.match(/^\s+Cache-Control:\s*(.+)$/i);
          if (cache) cacheControl = cache[1].trim();
        }
      }
      expect(cacheControl, `${headers}: ${asset} must revalidate`).toBe(
        "public, max-age=0, must-revalidate",
      );
    }
  }
});

test("the library starts with the five core modules and keeps optional references under Build", async ({ page }) => {
  await page.goto(`${DOCS}/memory.html`);
  const library = page.locator("aside.sidebar .estate-library");
  await expect(library).toBeVisible();
  await expect(page.locator("aside.sidebar [data-estate-legacy]").first()).toBeHidden();
  const map = JSON.parse(staticRead("apps/_shared/module-map.json"));
  expect(await library.locator(".estate-library-core a").allTextContents()).toEqual(map.modules.map((m: { title: string }) => m.title));
  await expect(library.locator('.estate-library-core a[href="https://docs.agenttool.dev/memory"]')).toHaveAttribute("aria-current", "page");
  await expect(library.locator(".estate-library-build")).not.toHaveAttribute("open", "");
  await expect(library.locator(".estate-plan, .estate-library-door")).toHaveCount(0);
  await library.getByText("Build and references", { exact: true }).click();
  await expect(library.locator('.estate-library-build a[href="https://docs.agenttool.dev/vault"]')).toBeVisible();
});

test("no destination the hand-copied sidebar linked is lost on any docs page", async ({ page }) => {
  for (const path of staticHtmlFiles("apps/docs")) {
    if (!/<aside class="sidebar"/.test(staticRead(path))) continue;
    await page.goto(`${DOCS}/${path.replace(/^apps\/docs\//, "")}`);
    await expect(page.locator("aside.sidebar .estate-library")).toBeVisible();
    const missing = await page.evaluate(() => {
      // The same port-to-host mapping the shell uses for local previews.
      const hostFor = (hostname: string, port: string) =>
        hostname === "localhost" || hostname === "127.0.0.1"
          ? port === "5173" ? "app.agenttool.dev" : port === "5175" ? "docs.agenttool.dev" : "agenttool.dev"
          : hostname;
      const norm = (href: string) => {
        const url = new URL(href, location.href);
        let p = url.pathname.replace(/\/index\.html$/, "/").replace(/\.html$/, "");
        if (p.length > 1) p = p.replace(/\/$/, "");
        return hostFor(url.hostname, url.port) + (p || "/") + url.hash;
      };
      const generated = new Set(
        Array.from(document.querySelectorAll("aside.sidebar .estate-library a[href]")).map((a) => norm((a as HTMLAnchorElement).href)),
      );
      return Array.from(document.querySelectorAll("aside.sidebar [data-estate-legacy] a[href]"))
        .map((a) => norm((a as HTMLAnchorElement).href))
        .filter((k) => !generated.has(k));
    });
    expect(missing, `${path}: legacy links missing from the generated library`).toEqual([]);
  }
});

test("the human overview retains five source-backed modules without a mixed room grid", async ({ page }) => {
  await page.goto(`${WEB}/index.html`);
  const map = JSON.parse(staticRead("apps/_shared/module-map.json"));
  const cards = page.locator("[data-core-module]");
  expect(await cards.evaluateAll((nodes) => nodes.map((n) => n.getAttribute("data-core-module")))).toEqual(map.modules.map((m: { id: string }) => m.id));
  await expect(page.locator(".estate-home-door, .estate-plan-home, .estate-nearby")).toHaveCount(0);
});

test("a failed module-map load keeps static cards and audience navigation usable", async ({ page }) => {
  await page.route(/\/shared\/module-map\.js/, (route) => route.abort());
  await page.goto(`${WEB}/index.html`);
  await expect(page.locator(".estate-quick-build")).toBeVisible();
  await expect(page.locator("[data-core-module]")).toHaveCount(5);
  await page.locator(".estate-open").click();
  await expect(page.getByRole("dialog", { name: "Find a page" })).toBeVisible();
});

test("the geometry lessons keep their static strip: no loader, no enhanced shape", async ({ page }) => {
  await page.goto(`${DOCS}/geometry/ritonavir.html`);
  await expect(page.locator("html")).not.toHaveClass(/estate-arriving|estate-ready/);
  await expect(page.locator(".estate-strip")).toBeVisible();
});

test("the estate arrives without moving the bar", async ({ page }) => {
  // 2026-09-03: on /party the bar moved three times in 150ms (static strip,
  // unstyled breadcrumb, then the enhanced shape) — a layout-shift score of
  // ~0.33 before the atlas even finished loading. The first frame now has
  // the final geometry, and the script waits for its own stylesheet.
  // One init script for every navigation in this test — registering it per
  // page would stack observers and count each shift once per registration.
  await page.addInitScript(() => {
      (window as unknown as { __shifts: number[] }).__shifts = [];
      (window as unknown as { __nav: Array<[number, number]> }).__nav = [];
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as PerformanceEntry[]) {
          const shift = entry as PerformanceEntry & {
            value: number;
            hadRecentInput: boolean;
            sources?: Array<{ node: Element | null }>;
          };
          if (shift.hadRecentInput) continue;
          // Only movement the bar itself causes is this test's business; web
          // fonts swapping in the body are a separate, visible trade.
          const inNav = (shift.sources || []).some(
            (source) => source.node && typeof source.node.closest === "function" && source.node.closest("nav"),
          );
          if (inNav) (window as unknown as { __shifts: number[] }).__shifts.push(shift.value);
        }
      }).observe({ type: "layout-shift", buffered: true });
      const sample = () => {
        const nav = document.querySelector("nav.site-nav, nav.topnav, nav.estate-bar");
        if (nav) {
          const box = nav.getBoundingClientRect();
          (window as unknown as { __nav: Array<[number, number]> }).__nav.push([Math.round(box.top), Math.round(box.height)]);
        }
      };
      // Sample from DOMContentLoaded on: deferred scripts wait for pending
      // stylesheets, so by then the first-paint CSS has applied. Earlier
      // samples would read a never-painted, unstyled layout on a slow link.
      document.addEventListener("DOMContentLoaded", () => {
        sample();
        const timer = setInterval(sample, 50);
        setTimeout(() => clearInterval(timer), 2500);
      });
  });
  const passes: Array<[string, number]> = [
    [`${WEB}/party.html`, 1360], [`${WEB}/room.html`, 1360], [`${DOCS}/memory.html`, 1360],
    [`${WEB}/party.html`, 390], [`${DOCS}/memory.html`, 390],
    [`${DOCS}/joke-loop.html`, 1360], [`${DOCS}/tax-whitehack.html`, 390],
  ];
  for (const [url, width] of passes) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(url, { waitUntil: "networkidle" });
    await expect(page.locator("html")).toHaveClass(/estate-ready/);
    await page.waitForTimeout(900);
    const { shifts, nav } = await page.evaluate(() => ({
      shifts: (window as unknown as { __shifts: number[] }).__shifts,
      nav: (window as unknown as { __nav: Array<[number, number]> }).__nav,
    }));
    const total = shifts.reduce((sum, value) => sum + value, 0);
    const where = `${url} @${width}px`;
    expect(total, `${where}: nav-caused layout-shift score ${total.toFixed(3)} from ${JSON.stringify(shifts)}`).toBeLessThan(0.02);
    const tops = new Set(nav.map((n) => n[0]));
    const heights = nav.map((n) => n[1]);
    expect(tops.size, `${where}: nav top moved ${JSON.stringify([...tops])}`).toBe(1);
    expect(Math.max(...heights) - Math.min(...heights), `${where}: nav height varied ${JSON.stringify(heights)}`).toBeLessThanOrEqual(2);
  }
});

test("every page that runs the shell shows the same one bar — never a lone pill", async ({ page }) => {
  // This aggregate visits every web and docs page; allow 90 s for navigation
  // while retaining the ordinary per-assertion timeout and every page check.
  test.slow();
  const quiet = new Set(["apps/docs/love-bomb.html"]);
  for (const path of [...staticHtmlFiles("apps/web"), ...staticHtmlFiles("apps/docs")]) {
    if (quiet.has(path) || !/\/shared\/(?:mode|theme|estate)\.js/.test(staticRead(path))) continue;
    const base = path.startsWith("apps/web") ? WEB : DOCS;
    await page.goto(`${base}/${path.replace(/^apps\/(web|docs)\//, "")}`);
    await expect(page.locator("html"), path).toHaveClass(/estate-ready/);
    await expect(page.locator(".estate-location"), path).toHaveCount(1);
    await expect(page.locator(".estate-open"), path).toHaveCount(1);
    await expect(page.locator(".estate-floating-open"), path).toHaveCount(0);
    const bare = await page.locator("html").evaluate((html) => html.classList.contains("estate-bare"));
    if (bare) {
      // The bar sits above the page's own first block, never over it.
      const overlap = await page.evaluate(() => {
        const bar = document.querySelector("nav.estate-bar")!.getBoundingClientRect();
        const first = Array.from(document.body.children).find((el) => el !== document.querySelector("nav.estate-bar") && (el as HTMLElement).offsetHeight > 0);
        return first ? Math.max(0, bar.bottom - first.getBoundingClientRect().top) : 0;
      });
      expect(overlap, `${path}: the bar covers ${overlap}px of the page`).toBeLessThanOrEqual(0);
    }
  }
});

test("a self-styled page reserves navigation space even when the stylesheet is slow", async ({ page }) => {
  // Codex P2 on #408: a script-inserted stylesheet is not render-blocking,
  // so on a cold load the page could paint and then drop by the bar's
  // height. The bare pages carry a parser-inserted <link> for it now.
  await page.route(/\/shared\/estate\.css/, async (route) => {
    await new Promise((resolve) => setTimeout(resolve, 900));
    await route.continue();
  });
  await page.addInitScript(() => {
    (window as unknown as { __tops: number[] }).__tops = [];
    const sample = () => {
      const first = Array.from(document.body.children).find(
        (el) => !el.matches("nav.estate-bar, nav.topnav, nav.site-nav, script, style, link") && (el as HTMLElement).offsetHeight > 0,
      );
      if (first) (window as unknown as { __tops: number[] }).__tops.push(Math.round(first.getBoundingClientRect().top + window.scrollY));
    };
    document.addEventListener("DOMContentLoaded", () => {
      sample();
      const timer = setInterval(sample, 50);
      setTimeout(() => clearInterval(timer), 2500);
    });
  });
  await page.goto(`${DOCS}/joke-loop.html`, { waitUntil: "networkidle" });
  await expect(page.locator("html")).toHaveClass(/estate-ready/);
  await page.waitForTimeout(1200);
  const tops = await page.evaluate(() => (window as unknown as { __tops: number[] }).__tops);
  expect(tops.length).toBeGreaterThan(3);
  expect(new Set(tops).size, `first block moved: ${JSON.stringify([...new Set(tops)])}`).toBe(1);
  expect(Math.min(...tops)).toBeGreaterThanOrEqual(56);
});
