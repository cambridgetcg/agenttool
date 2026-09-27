/** The two entrances share a map, while reading never starts setup or work. */
import { readFileSync } from "node:fs";
import { expect, test } from "./helpers/fixture";

const WEB = "http://localhost:5174";
const DOCS = "http://localhost:5175";
const map = JSON.parse(readFileSync(new URL("../../../apps/_shared/module-map.json", import.meta.url), "utf8")) as {
  audiences: Record<"human" | "agent", {
    primary: Array<{ title: string; href: string }>;
    switch: { title: string; href: string };
  }>;
  modules: Array<{ id: string; title: string; status: string }>;
  buildGroups: Array<{ id: string; title: string }>;
};
const fields = ["Purpose", "Source status", "Scope", "Read", "Action", "Auth", "Output"];

test("agent arrival states scope, effects and authentication without starting operations", async ({ page }) => {
  const effects: string[] = [];
  page.on("request", request => {
    if (!['GET', 'HEAD'].includes(request.method()) || new URL(request.url()).origin === "https://api.agenttool.dev") {
      effects.push(`${request.method()} ${request.url()}`);
    }
  });
  await page.goto(`${DOCS}/agents`);
  await expect(page.locator("html")).toHaveAttribute("data-audience", "agent");
  await expect(page.locator("html")).toHaveAttribute("data-estate-version", /.+/);
  await expect(page.locator("main#main")).toBeVisible();
  const modules = page.locator("#core [data-module]");
  await expect(modules).toHaveCount(5);
  expect(await modules.evaluateAll(nodes => nodes.map(node => node.getAttribute("data-module"))))
    .toEqual(map.modules.map(module => module.id));
  for (const module of map.modules) {
    const card = page.locator(`#core [data-module="${module.id}"]`);
    await expect(card.getByRole("heading", { name: module.title, exact: true })).toBeVisible();
    await expect(card.locator("dt")).toHaveText(fields);
    await expect(card.locator("dd")).toHaveCount(fields.length);
    for (const value of await card.locator("dd").allTextContents()) expect(value.trim()).not.toBe("");
    await expect(card.locator("dd").nth(1)).toContainText(module.status);
    expect(await card.locator("dd").nth(3).getByRole("link").count()).toBeGreaterThan(0);
  }
  await expect(page.locator("main a[href='specs/agenttool-core-launch-v0.1.json']").first()).toBeVisible();
  await expect(page.locator("main a[href='https://app.agenttool.dev/']")).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
  expect(effects).toEqual([]);
});

test("a visitor can switch from the human overview to agent references and back", async ({ page }) => {
  // Preserve real public hrefs and clicks, but resolve navigation only to our
  // local static servers. The fixture's default containment still blocks all
  // other external requests; no production endpoint is fetched.
  await page.route("https://docs.agenttool.dev/agents", route =>
    route.fulfill({ status: 302, headers: { location: `${DOCS}/agents` }, body: "" }));
  await page.route("https://agenttool.dev/", route =>
    route.fulfill({ status: 302, headers: { location: `${WEB}/` }, body: "" }));
  await page.goto(`${WEB}/`);
  await expect(page.locator("html")).toHaveAttribute("data-audience", "human");
  const agentSwitch = page.locator(".estate-audience-exit");
  await expect(agentSwitch).toHaveText(map.audiences.human.switch.title);
  await expect(agentSwitch).toHaveAttribute("href", map.audiences.human.switch.href);
  await agentSwitch.click();
  await expect(page).toHaveURL(`${DOCS}/agents`);
  await expect(page.locator("html")).toHaveAttribute("data-audience", "agent");
  const humanSwitch = page.locator(".estate-audience-exit");
  await expect(humanSwitch).toHaveText("Human overview");
  await expect(humanSwitch).toHaveAttribute("href", map.audiences.agent.switch.href);
  await humanSwitch.click();
  await expect(page).toHaveURL(`${WEB}/`);
  await expect(page.locator("html")).toHaveAttribute("data-audience", "human");
});

test("primary navigation keeps five core choices separate from the Build collection", async ({ page }) => {
  for (const [audience, url] of [["human", `${WEB}/`], ["agent", `${DOCS}/agents`]] as const) {
    await page.goto(url);
    const primary = page.locator(".estate-quick-actions > a:not(.estate-audience-exit)");
    await expect(primary).toHaveText(map.audiences[audience].primary.map(link => link.title));
    expect(await primary.evaluateAll(nodes => nodes.map(node => node.getAttribute("href"))))
      .toEqual(map.audiences[audience].primary.map(link => link.href));
  }
  await page.goto(`${WEB}/`);
  await expect(page.locator("#modules [data-core-module]")).toHaveCount(5);
  await expect(page.locator("[data-build-group]")).toHaveCount(0);
  // Build is a deliberate second destination, not another core module.
  await page.locator("main a[href='/build']").click();
  await expect(page).toHaveURL(`${WEB}/build`);
  expect(await page.locator("[data-build-group]").evaluateAll(nodes => nodes.map(node => node.getAttribute("data-build-group"))))
    .toEqual(map.buildGroups.map(group => group.id));
  await expect(page.locator("[data-core-module]")).toHaveCount(0);
});

test("agent references and both exits remain usable without JavaScript at 320 pixels", async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 320, height: 800 } });
  try {
    const page = await context.newPage();
    await page.goto(`${DOCS}/agents`);
    await expect(page.locator("html")).toHaveAttribute("data-audience", "agent");
    await expect(page.locator("#core [data-module]")).toHaveCount(5);
    await expect(page.locator(".estate-strip").getByRole("link", { name: "Human overview" })).toBeVisible();
    await expect(page.locator(".estate-strip").getByRole("link", { name: "Setup or reconnect" })).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", { name: "Skip to agent start" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator("main")).toBeFocused();
    for (const module of map.modules) {
      await expect(page.locator(`[data-module="${module.id}"] dt`)).toHaveText(fields);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
    await page.goto(`${WEB}/`);
    await expect(page.locator("#modules [data-core-module]")).toHaveCount(5);
    await expect(page.locator(".hero").getByRole("link", { name: "Agent reference", exact: true })).toBeVisible();
  } finally {
    await context.close();
  }
});
