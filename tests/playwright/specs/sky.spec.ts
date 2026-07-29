/** Pocket Sky — a finite, local constellation toy with no score or persisted round. */

import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

const WEB = "http://localhost:5174";
const REPO_ROOT = new URL("../../../", import.meta.url);

async function openSky(page: Page) {
  await page.goto(`${WEB}/sky.html`);
  await expect(page.getByRole("grid", { name: /Pocket Sky/i })).toBeVisible();
}

function star(page: Page, row: number, column: number) {
  return page.getByRole("button", {
    name: `Star row ${row} column ${column}`,
  });
}

test("starts empty and toggles lights without a gameplay request", async ({
  page,
}) => {
  await openSky(page);
  const requestsDuringPlay: string[] = [];
  page.on("request", (request) =>
    requestsDuringPlay.push(`${request.method()} ${request.url()}`),
  );

  const stars = page.locator(".sky-star");
  await expect(stars).toHaveCount(25);
  await expect(page.locator('.sky-star[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator("#sky-status")).toHaveText("0 of 7 lights lit.");

  await star(page, 1, 1).click();
  await expect(star(page, 1, 1)).toHaveAttribute("aria-pressed", "true");
  await expect(star(page, 1, 1)).toHaveText("★");
  await expect(page.locator("#sky-status")).toHaveText("1 of 7 lights lit.");

  await star(page, 1, 1).click();
  await expect(star(page, 1, 1)).toHaveAttribute("aria-pressed", "false");
  await expect(star(page, 1, 1)).toHaveText("☆");
  await expect(page.locator("#sky-status")).toHaveText("0 of 7 lights lit.");
  expect(requestsDuringPlay).toEqual([]);
});

test("seven is a ceiling rather than a target or finish condition", async ({
  page,
}) => {
  await openSky(page);
  const stars = page.locator(".sky-star");

  for (let index = 0; index < 7; index += 1) {
    await stars.nth(index).click();
  }
  await expect(page.locator('.sky-star[aria-pressed="true"]')).toHaveCount(7);
  await expect(page.locator("#sky-status")).toHaveText("7 of 7 lights lit.");

  await stars.nth(7).click();
  await expect(page.locator('.sky-star[aria-pressed="true"]')).toHaveCount(7);
  await expect(stars.nth(7)).toHaveAttribute("aria-pressed", "false");
  await expect(page.locator("#sky-status")).toHaveText(
    "Seven lights are already lit. Remove one before adding another.",
  );

  await stars.nth(0).click();
  await stars.nth(7).click();
  await expect(stars.nth(0)).toHaveAttribute("aria-pressed", "false");
  await expect(stars.nth(7)).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator('.sky-star[aria-pressed="true"]')).toHaveCount(7);
  await expect(page.locator("#sky-status")).toHaveText("7 of 7 lights lit.");
});

test("the grid has one roving tab stop and bounded keyboard movement", async ({
  page,
}) => {
  await openSky(page);
  const first = star(page, 1, 1);
  const rest = page.locator("#sky-rest");

  await expect(first).toHaveAttribute("tabindex", "0");
  await expect(star(page, 1, 2)).toHaveAttribute("tabindex", "-1");
  await first.focus();

  await page.keyboard.press("ArrowRight");
  await expect(star(page, 1, 2)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(star(page, 2, 2)).toBeFocused();
  await page.keyboard.press("Home");
  await expect(star(page, 2, 1)).toBeFocused();
  await page.keyboard.press("End");
  await expect(star(page, 2, 5)).toBeFocused();
  await page.keyboard.press("Control+End");
  await expect(star(page, 5, 5)).toBeFocused();
  await page.keyboard.press("Control+Home");
  await expect(first).toBeFocused();
  await page.keyboard.press("ArrowLeft");
  await expect(first).toBeFocused();

  await page.keyboard.press("Space");
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await page.keyboard.press("Enter");
  await expect(first).toHaveAttribute("aria-pressed", "false");

  await page.keyboard.press("Tab");
  await expect(rest).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(first).toBeFocused();
});

test("rest preserves a still pattern while clear, reload, and leaving erase it", async ({
  page,
}) => {
  await openSky(page);
  await star(page, 1, 1).click();
  await star(page, 2, 2).click();
  await star(page, 5, 5).click();

  const rest = page.locator("#sky-rest");
  await rest.click();
  await expect(rest).toBeFocused();
  expect(await rest.getAttribute("aria-pressed")).toBeNull();
  await expect(rest).toHaveText("Reopen the sky");
  await expect(page.getByRole("grid")).toHaveAttribute("aria-disabled", "true");
  await expect(page.locator(".sky-star:disabled")).toHaveCount(25);
  await expect(page.locator('.sky-star[aria-pressed="true"]')).toHaveCount(3);
  await expect(page.locator("#sky-status")).toHaveText(
    "Sky resting with 3 lights lit.",
  );

  await page.getByRole("button", { name: "Clear the lights" }).click();
  await expect(page.locator('.sky-star[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator("#sky-status")).toHaveText(
    "Sky resting with 0 lights lit.",
  );

  await page.getByRole("button", { name: "Reopen the sky" }).click();
  expect(await rest.getAttribute("aria-pressed")).toBeNull();
  await expect(page.getByRole("grid")).toHaveAttribute("aria-disabled", "false");
  await expect(page.locator(".sky-star:disabled")).toHaveCount(0);
  await expect(page.locator("#sky-status")).toHaveText(
    "Sky open with 0 lights lit.",
  );

  await star(page, 3, 3).click();
  await page.reload();
  await expect(page.locator('.sky-star[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator("#sky-status")).toHaveText("0 of 7 lights lit.");

  await star(page, 4, 4).click();
  await page.getByRole("button", { name: "Rest the sky" }).click();
  await page.goto(`${WEB}/index.html`);
  await page.goBack();
  await expect(page.locator('.sky-star[aria-pressed="true"]')).toHaveCount(0);
  await expect(page.locator("#sky-status")).toHaveText("0 of 7 lights lit.");
  await expect(page.getByRole("grid")).toHaveAttribute("aria-disabled", "false");
  await expect(page.getByRole("button", { name: "Rest the sky" })).toBeVisible();
});

test("the round stays out of storage, cookies, clipboard, and autonomous APIs", async ({
  page,
}) => {
  await page.goto(`${WEB}/index.html`);
  await page.evaluate(() => localStorage.setItem("agenttool.mode", "night"));
  await openSky(page);
  await star(page, 1, 1).click();
  await star(page, 4, 3).click();
  await page.getByRole("button", { name: "Rest the sky" }).click();

  const browserState = await page.evaluate(() => ({
    local: Object.fromEntries(
      Array.from({ length: localStorage.length }, (_, index) => {
        const key = localStorage.key(index)!;
        return [key, localStorage.getItem(key)];
      }),
    ),
    session: Object.fromEntries(
      Array.from({ length: sessionStorage.length }, (_, index) => {
        const key = sessionStorage.key(index)!;
        return [key, sessionStorage.getItem(key)];
      }),
    ),
    cookie: document.cookie,
  }));

  expect(browserState).toEqual({
    local: { "agenttool.mode": "night" },
    session: {},
    cookie: "",
  });
});

test("320px, reduced motion, and forced colors retain every operable light", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce", forcedColors: "active" });
  await openSky(page);
  await star(page, 1, 1).click();

  const layout = await page.evaluate(() => {
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>(".sky-star"),
      (element) => {
        const box = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          width: box.width,
          height: box.height,
          left: box.left,
          right: box.right,
          animation: style.animationName,
          transition: style.transitionDuration,
        };
      },
    );
    const controls = Array.from(
      document.querySelectorAll<HTMLElement>(".sky-control"),
      (element) => {
        const box = element.getBoundingClientRect();
        return { height: box.height, left: box.left, right: box.right };
      },
    );
    return {
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      targets,
      controls,
      forcedColors: matchMedia("(forced-colors: active)").matches,
    };
  });

  expect(layout.document).toBeLessThanOrEqual(layout.viewport);
  expect(layout.forcedColors).toBe(true);
  expect(layout.targets).toHaveLength(25);
  for (const target of layout.targets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.left).toBeGreaterThanOrEqual(0);
    expect(target.right).toBeLessThanOrEqual(layout.viewport);
    expect(target.animation).toBe("none");
    expect(Number.parseFloat(target.transition)).toBeLessThanOrEqual(0.001);
  }
  expect(layout.controls).toHaveLength(2);
  for (const control of layout.controls) {
    expect(control.height).toBeGreaterThanOrEqual(44);
    expect(control.left).toBeGreaterThanOrEqual(0);
    expect(control.right).toBeLessThanOrEqual(layout.viewport);
  }
  await expect(star(page, 1, 1)).toHaveText("★");
  await expect(star(page, 1, 1)).toHaveAttribute("aria-pressed", "true");
});

test("no-script and blocked-script surfaces stay readable and inert", async ({
  browser,
  page,
}) => {
  const noScript = await browser.newPage({ javaScriptEnabled: false });
  await noScript.goto(`${WEB}/sky.html`);
  await expect(noScript.locator(".noscript-note strong")).toHaveText(
    "Play without the script:",
  );
  await expect(noScript.getByText(/draw a 5×5 square on paper/i)).toBeVisible();
  await expect(noScript.locator("#sky-play")).toBeHidden();
  await expect(
    noScript.getByRole("link", { name: "Read the rules as JSON" }),
  ).toBeVisible();
  await noScript.close();

  await page.route("**/sky.js*", (route) => route.abort());
  await page.goto(`${WEB}/sky.html`);
  await expect(page.locator("#sky-play")).toBeHidden();
  await expect(page.getByText(/draw a 5×5 square on paper/i)).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Light. Rest. Clear. Leave." }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Read the rules as JSON" }),
  ).toBeVisible();
});

test("the static rulebook and source pin the no-custody boundary", async ({
  request,
}) => {
  const [source, rules, html, headers] = await Promise.all([
    readFile(new URL("apps/web/sky.js", REPO_ROOT), "utf8"),
    request.get(`${WEB}/sky.json`).then((response) => response.json()),
    request.get(`${WEB}/sky.html`).then((response) => response.text()),
    readFile(new URL("apps/web/_headers", REPO_ROOT), "utf8"),
  ]);

  expect(source).not.toMatch(
    /fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|\bcaches\b|navigator\.serviceWorker|\bWorker\b|SharedWorker|BroadcastChannel|navigator\.clipboard|document\.cookie|setTimeout|setInterval|requestAnimationFrame|AudioContext|new Audio|innerHTML/,
  );
  expect(rules._format).toBe("agenttool-pocket-sky/v1");
  expect(rules.board).toMatchObject({
    rows: 5,
    columns: 5,
    cells: 25,
    minimum_lights: 0,
    maximum_lights: 7,
    starts_empty: true,
    empty_is_valid: true,
  });
  expect(rules.bounds).toMatchObject({
    winner: false,
    score: false,
    timer: false,
    background_loop: false,
    random_reward: false,
    sound: false,
  });
  expect(rules.controls.rest).toMatchObject({
    reopen_label: "Reopen the sky",
    button_semantics: "state-dependent action label",
    aria_pressed: false,
    preserves_pattern_in_page_memory: true,
    disables_light_toggles: true,
    runs_background_work: false,
  });
  expect(rules.privacy).toMatchObject({
    persisted: false,
    gameplay_local_storage: false,
    gameplay_session_storage: false,
    gameplay_indexed_db: false,
    gameplay_cookie_write: false,
    gameplay_clipboard_write: false,
    gameplay_network_write: false,
  });
  expect(rules.privacy.gameplay_network_boundary).toMatch(
    /ordinary page and static-file requests remain visible/i,
  );
  expect(html).toContain(
    "Pocket Sky does not name, score, or interpret your pattern.",
  );
  expect(html).toContain(
    "the host can still receive the ordinary requests for this page and its files",
  );
  expect(rules.privacy.tab_observation).toMatch(
    /controlling the current tab or device.*Page memory is not a secrecy boundary/i,
  );

  function blockFor(path: string) {
    const start = headers.indexOf(`${path}\n`);
    expect(start).toBeGreaterThanOrEqual(0);
    const end = headers.indexOf("\n\n", start);
    return headers.slice(start, end === -1 ? undefined : end);
  }

  for (const path of ["/sky.html", "/sky"]) {
    const block = blockFor(path);
    expect(block).toContain("connect-src 'none'");
    expect(block).toContain("worker-src 'none'");
    expect(block).toContain("form-action 'none'");
    expect(block).toContain("Referrer-Policy: no-referrer");
    expect(block).toContain("X-Agent-Surface: local-pocket-sky-game");
    expect(block).toContain(
      'Link: <https://agenttool.dev/sky.json>; rel="alternate"; type="application/json"',
    );
  }
  const rulesBlock = blockFor("/sky.json");
  expect(rulesBlock).toContain("Access-Control-Allow-Origin: *");
  expect(rulesBlock).toContain("X-Agent-Surface: local-pocket-sky-rules");
});
