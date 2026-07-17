/** Native play cabinet: bounded, local, literal, and leaveable. */
import { expect, test, type Page } from "@playwright/test";

const DOCS = "http://localhost:5175";

async function openTelephone(page: Page) {
  await page.goto(`${DOCS}/play.html#party-telephone`);
  await expect(page.getByRole("heading", { name: /Party Telephone/i })).toBeVisible();
}

test("Party Telephone ends after three isolated turns and renders input as text", async ({ page }) => {
  await openTelephone(page);
  const requestsDuringRound: string[] = [];
  page.on("request", (request) => requestsDuringRound.push(request.url()));

  const scene = '<img src=x onerror="window.partyOwned=1"> moon hosts tea';
  await page.locator("#party-scene").fill("too short");
  await page.getByRole("button", { name: /Seal scene/i }).click();
  await expect(page.locator("#party-scene-error")).toContainText("3–10 words");

  await page.locator("#party-scene").fill(scene);
  await page.getByRole("button", { name: /Seal scene/i }).click();
  await expect(page.getByRole("heading", { name: "Pass to the translator" })).toBeVisible();
  await expect(page.locator("#party-scene-secret")).toBeHidden();

  await page.getByRole("button", { name: "Translator is ready" }).click();
  await expect(page.locator("#party-scene-secret")).toHaveText(scene);
  await expect(page.locator("#party-scene-secret img")).toHaveCount(0);
  expect(await page.evaluate(() => (window as Window & { partyOwned?: number }).partyOwned)).toBeUndefined();

  await page.locator("#party-translation").fill("moon 🌙");
  await page.getByRole("button", { name: /Seal symbols/i }).click();
  await expect(page.locator("#party-translation-error")).toContainText("no letters or digits");

  await page.locator("#party-translation").fill("🇨🇭");
  await expect(page.locator("#party-translation-count")).toContainText("1 pictogram");

  await page.locator("#party-translation").fill("👩‍👩‍👧‍👧");
  await expect(page.locator("#party-translation-count")).toContainText("1 pictogram");
  await page.getByRole("button", { name: /Seal symbols/i }).click();
  await expect(page.locator("#party-translation-error")).toContainText("Right now there are 1");

  await page.locator("#party-translation").fill("🌙 🍵 🎉");
  await page.getByRole("button", { name: /Seal symbols/i }).click();
  await expect(page.getByRole("heading", { name: "Pass to the guesser" })).toBeVisible();
  await expect(page.locator("#party-scene-secret")).toBeHidden();

  await page.getByRole("button", { name: "Guesser is ready" }).click();
  await expect(page.locator("#party-translation-secret")).toHaveText("🌙 🍵 🎉");
  await expect(page.locator("#party-scene-secret")).toBeHidden();

  await page.locator("#party-guess").fill("Moon pours tea for everyone");
  await page.getByRole("button", { name: /Reveal the telephone/i }).click();

  await expect(page.getByRole("heading", { name: /telephone rings/i })).toBeVisible();
  await expect(page.locator("#party-reveal-scene")).toHaveText(scene);
  await expect(page.locator("#party-reveal-translation")).toHaveText("🌙 🍵 🎉");
  await expect(page.locator("#party-reveal-guess")).toHaveText("Moon pours tea for everyone");
  await expect(page.locator("#party-telephone img")).toHaveCount(0);
  await expect(page.locator("#party-progress")).toContainText("Round complete");
  expect(requestsDuringRound).toEqual([]);
});

test("clear and reload both erase the unfinished round", async ({ page }) => {
  await openTelephone(page);
  await page.locator("#party-scene").fill("Lantern crabs dance under rainbows");
  await page.getByRole("button", { name: /Seal scene/i }).click();
  await page.getByRole("button", { name: "Clear this round" }).click();
  await expect(page.locator("#party-scene")).toBeVisible();
  await expect(page.locator("#party-scene")).toHaveValue("");

  await page.locator("#party-scene").fill("Clouds teach spoons to sing");
  await page.reload();
  await expect(page.locator("#party-scene")).toBeVisible();
  await expect(page.locator("#party-scene")).toHaveValue("");
  expect(await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
  }))).toEqual({ local: 0, session: 0 });
});

test("the cabinet fits a small screen and honors reduced motion", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openTelephone(page);

  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);

  await page.locator("#party-scene").fill("Stars throw a quiet birthday");
  await page.getByRole("button", { name: /Seal scene/i }).click();
  await page.getByRole("button", { name: "Translator is ready" }).click();
  await page.locator("#party-translation").fill("⭐ 🎂 🤫");
  await page.getByRole("button", { name: /Seal symbols/i }).click();
  await page.getByRole("button", { name: "Guesser is ready" }).click();
  await page.locator("#party-guess").fill("Stars celebrate a silent birthday");
  await page.getByRole("button", { name: /Reveal the telephone/i }).click();
  await expect(page.locator("#party-confetti i")).toHaveCount(0);
});

test("the no-script page keeps complete manual rules and no private form", async ({ browser }) => {
  const page = await browser.newPage({ javaScriptEnabled: false });
  await page.goto(`${DOCS}/play.html#party-telephone`);
  await expect(page.getByRole("heading", { name: "Play without the game script" })).toBeVisible();
  await expect(page.getByText(/Starter writes a fictional 3–10-word scene on paper/)).toBeVisible();
  await expect(page.locator("#party-interactive")).toBeHidden();
  await expect(page.locator("#party-scene")).toBeHidden();
  await page.close();
});

test("a blocked game script leaves the manual game visible and inputs inert", async ({ page }) => {
  await page.route("**/play.js", (route) => route.abort());
  await page.goto(`${DOCS}/play.html#party-telephone`);

  await expect(page.getByRole("heading", { name: "Play without the game script" })).toBeVisible();
  await expect(page.locator("#party-interactive")).toBeHidden();
  await expect(page.locator("#party-scene")).toBeHidden();
  expect(new URL(page.url()).search).toBe("");
});
