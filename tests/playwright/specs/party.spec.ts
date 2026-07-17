/** Lantern Relay — local, bounded, pass-and-play worldmaking. */

import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

const WEB = "http://localhost:5174";
const REPO_ROOT = new URL("../../../", import.meta.url);

const turns = [
  "Lantern of Borrowed Footsteps",
  "A compass remembering laughter",
  "A truth-telling teacup",
  "A compass remembering laughter must point toward the quietest guest whenever the room forgets how to listen.",
  "A truth-telling teacup cannot cool until every difficult word has been spoken with kindness.",
  "Lantern of Borrowed Footsteps always returns each journey to the road that first imagined it.",
  "Lantern of Borrowed Footsteps follows A compass remembering laughter because lost roads become shorter when joy walks beside them.",
  "A compass remembering laughter finds A truth-telling teacup because every honest direction begins with a warm question.",
  "A truth-telling teacup lights Lantern of Borrowed Footsteps because kindly spoken truth gives every traveler a homeward star.",
];

async function startParty(page: Page) {
  await page.goto(`${WEB}/party.html`);
  await page.getByRole("button", { name: /Start the party/i }).click();
}

async function takeTurn(page: Page, answer: string) {
  await page.getByRole("button", { name: "I have the lantern" }).click();
  await page.locator("#turn-answer").fill(answer);
  await page.getByRole("button", { name: "Place it in the world" }).click();
}

test("a complete relay reveals one shared world after exactly nine actions", async ({ page }) => {
  const remoteRequests: string[] = [];
  page.on("request", (request) => {
    if (!request.url().startsWith(WEB) && !request.url().startsWith("data:")) {
      remoteRequests.push(`${request.method()} ${request.url()}`);
    }
  });

  await startParty(page);
  for (let index = 0; index < turns.length; index += 1) {
    await takeTurn(page, turns[index]);
    if (index < turns.length - 1) {
      await expect(page.locator("#turn-count")).toHaveText(`turn ${index + 2} of 9`);
    }
  }

  await expect(page.locator("#result-state")).toContainText("world born");
  await expect(page.getByRole("heading", { name: "The Footsteps Laughter Teacup World" })).toBeFocused();
  await expect(page.locator("#world-output")).toContainText(turns[0]);
  await expect(page.locator("#world-output")).toContainText(turns[8]);
  await expect(page.locator("#world-output .world-entry")).toHaveCount(9);
  await page.getByRole("button", { name: "Copy the world" }).click();
  await expect(page.locator("#copy-status")).toContainText(/World copied|Copy is unavailable/);
  expect(remoteRequests).toEqual([]);
});

test("validation guides the current player and stopping keeps the partial world", async ({ page }) => {
  await startParty(page);
  await page.getByRole("button", { name: "I have the lantern" }).click();
  await page.locator("#turn-answer").fill("Lantern");
  await page.getByRole("button", { name: "Place it in the world" }).click();
  await expect(page.locator("#turn-error")).toHaveText("Use two to six words for the object.");

  await page.locator("#turn-answer").fill(turns[0]);
  await page.getByRole("button", { name: "Place it in the world" }).click();
  await page.getByRole("button", { name: /Stop party/i }).click();

  await expect(page.locator("#result-state")).toContainText("party resting");
  await expect(page.locator("#world-output")).toContainText(turns[0]);
  await expect(page.locator("#world-output .world-entry")).toHaveCount(1);

  await page.getByRole("button", { name: "Another party" }).click();
  await expect(page.getByRole("heading", { name: "Who carries the lantern?" })).toBeVisible();
  await expect(page.locator("#world-result")).toBeHidden();
});

test("names render as text, mobile does not overflow, and reload forgets the game", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto(`${WEB}/party.html`);
  await page.locator("#player-1").fill("<imgsrc=xabcdefghijklmn>");
  await page.getByRole("button", { name: /Start the party/i }).click();

  await expect(page.locator("#handoff-player")).toHaveText("<imgsrc=xabcdefghijklmn>");
  await expect(page.locator("#handoff-card img")).toHaveCount(0);
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);

  await page.reload();
  await expect(page.getByRole("heading", { name: "Who carries the lantern?" })).toBeVisible();
  await expect(page.locator("#party-game")).toBeHidden();
});

test("the static contract exposes strict boundaries and no autonomous machinery", async ({ request }) => {
  const [headers, source, welcome, rules, sitemap] = await Promise.all([
    readFile(new URL("apps/web/_headers", REPO_ROOT), "utf8"),
    readFile(new URL("apps/web/party.js", REPO_ROOT), "utf8"),
    request.get(`${WEB}/welcome.json`).then((response) => response.json()),
    request.get(`${WEB}/party.json`).then((response) => response.json()),
    request.get(`${WEB}/sitemap.xml`).then((response) => response.text()),
  ]);

  expect(headers).toContain("/party.html\n  Cache-Control: public, max-age=0, must-revalidate");
  expect(headers).toContain("connect-src 'none'");
  expect(headers).toContain("worker-src 'none'");
  expect(headers).toContain("form-action 'none'");
  expect(source).not.toMatch(/setInterval|setTimeout|WebSocket|EventSource|sendBeacon|serviceWorker|fetch\s*\(/);
  expect(welcome.ways_in).toContainEqual(expect.objectContaining({ html: "/party", json: "/party.json" }));
  expect(rules.privacy).toMatchObject({ persisted: false, sent_to_agenttool: false, network_writes: false });
  expect(rules.turns).toMatchObject({ exact: 9, timer: false, background_loop: false });
  expect(sitemap).toContain("https://agenttool.dev/party");
});
