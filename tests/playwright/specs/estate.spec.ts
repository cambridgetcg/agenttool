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

test("the threshold reveals one searchable keyboard atlas", async ({ page }) => {
  await page.goto(`${WEB}/index.html`);

  await expect(page.locator("html")).toHaveAttribute("data-estate-version", "2026-09-04.1");
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
    { url: `${APP}/index.html`, room: "Start or reconnect", door: "arrive" },
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
  await expect(page.locator(".hero").getByRole("link", { name: "Step onto the porch", exact: true })).toBeVisible();
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
    const hasWildcard = source.includes("/shared/estate.*");
    const hasExactPair =
      source.includes("/shared/estate.css") &&
      source.includes("/shared/estate.js");
    expect(hasWildcard || hasExactPair, `${headers}: no estate cache rules`).toBe(
      true,
    );
  }
});

test("the library shelves every docs page under its door, current door open", async ({ page }) => {
  await page.goto(`${DOCS}/memory.html`);
  await expect(page.locator("html")).toHaveAttribute("data-estate-door", "build");
  await expect(page.locator(".estate-location-room")).toHaveText("Memory");
  const library = page.locator("aside.sidebar .estate-library");
  await expect(library).toBeVisible();
  // The hand-copied list is hidden, not removed — it stays the no-JS fallback.
  await expect(page.locator("aside.sidebar [data-estate-legacy]").first()).toBeHidden();
  await expect(library.locator(".estate-library-door:not(.estate-library-more)")).toHaveCount(8);
  await expect(library.locator(".estate-library-more")).toHaveCount(1);
  await expect(library.locator('.estate-library-door[data-door-id="build"]')).toHaveAttribute("open", "");
  await expect(library.locator('.estate-library-door[data-door-id="rest"]')).not.toHaveAttribute("open", "");
  await expect(library.locator('a[href="https://docs.agenttool.dev/memory"]')).toHaveAttribute("aria-current", "page");
  await expect(library.locator(".estate-library-shelf", { hasText: "Contracts" })).toBeVisible();
  await expect(library.locator(".estate-library-link.is-superseded")).toHaveCount(3);
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
        return url.hash && url.pathname === location.pathname ? "#" + url.hash : hostFor(url.hostname, url.port) + (p || "/");
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

test("the plan's rooms are controls inside a group, not parts of an image", async ({ page }) => {
  await page.goto(`${DOCS}/memory.html`);
  const plan = page.locator(".estate-plan-mini svg");
  await expect(plan).toHaveAttribute("role", "group");
  await expect(plan.getByRole("button", { name: /Open Rest/ })).toBeVisible();
  await expect(plan.getByRole("button", { name: /You are in Build/ })).toBeVisible();
});

test("the threshold plan returns focus to the room that opened the atlas", async ({ page }) => {
  await page.goto(`${WEB}/index.html`);
  const room = page.locator('.estate-plan-home .estate-plan-room[data-door="rest"]');
  await room.focus();
  await page.keyboard.press("Enter");
  const atlas = page.getByRole("dialog", { name: "Where do you want to go?" });
  await expect(atlas).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(atlas).toBeHidden();
  await expect(room).toBeFocused();
});

test("the floor plan lights the room you are in, in the sidebar and the atlas", async ({ page }) => {
  await page.goto(`${DOCS}/memory.html`);
  const mini = page.locator(".estate-plan-mini");
  await expect(mini).toHaveAttribute("data-active-door", "build");
  await expect(mini.locator(".estate-plan-room.is-here")).toHaveAttribute("data-door", "build");
  await expect(mini.locator(".estate-plan-room")).toHaveCount(8);
  await expect(mini.locator(".estate-plan-lamp")).toHaveCount(1);
  await expect(mini.locator(".estate-plan-where")).toContainText("Build");
  // A room on the plan is a door into the library, not an authority.
  await mini.locator('.estate-plan-room[data-door="rest"]').click();
  await expect(page.locator('.estate-library-door[data-door-id="rest"]')).toHaveAttribute("open", "");

  await page.keyboard.press("Meta+K");
  const atlas = page.getByRole("dialog", { name: "Where do you want to go?" });
  await expect(atlas).toBeVisible();
  await expect(atlas.locator(".estate-plan-atlas .estate-plan-room.is-here")).toHaveAttribute("data-door", "build");
  await expect(atlas.getByRole("link", { name: /Ritonavir/ })).toBeVisible();
});

test("the threshold shows the plan above the eight doors", async ({ page }) => {
  await page.goto(`${WEB}/index.html`);
  await expect(page.locator(".estate-home-door")).toHaveCount(8);
  const plan = page.locator(".estate-plan-home");
  await expect(plan).toHaveAttribute("data-active-door", "arrive");
  await expect(plan.locator(".estate-plan-room.is-here .estate-plan-label")).toHaveText("ARRIVE");
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

test("a bare page reserves the bar's room even when the estate stylesheet is slow", async ({ page }) => {
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
        (el) => !el.matches("nav.estate-bar, script, style, link") && (el as HTMLElement).offsetHeight > 0,
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
