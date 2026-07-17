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
  await startParty(page);
  const requestsDuringPlay: string[] = [];
  page.on("request", (request) => requestsDuringPlay.push(`${request.method()} ${request.url()}`));
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

  const wake = page.locator("#wake-world");
  await expect(wake).toBeVisible();
  await expect(wake).toHaveAccessibleName("Wake the first morning");
  await expect(page.locator("#dawn-card")).toBeHidden();
  await wake.click();
  await expect(page.getByRole("heading", { name: "First morning in The Footsteps Laughter Teacup World" })).toBeFocused();
  await expect(wake).toBeDisabled();
  await expect(wake).toHaveAccessibleName("The first morning is awake");
  await expect(page.locator("#dawn-laws .dawn-law")).toHaveCount(3);
  await expect(page.locator("#dawn-laws")).toContainText(turns[3]);
  await expect(page.locator("#dawn-laws")).toContainText(turns[5]);
  const dawnWeave = await page.locator("#dawn-weave").textContent();
  expect(turns.slice(6).some((weave) => dawnWeave?.includes(weave))).toBe(true);
  await expect(page.locator("#dawn-weather")).toContainText(/“lost-joy” morning.*two words/i);

  await page.getByRole("button", { name: "Copy world + morning" }).click();
  await expect(page.locator("#copy-status")).toContainText(/World and first morning copied|Copy is unavailable/);
  await page.setViewportSize({ width: 320, height: 800 });
  const dawnWidths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(dawnWidths.document).toBeLessThanOrEqual(dawnWidths.viewport);
  expect(requestsDuringPlay).toEqual([]);
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
  await expect(page.locator("#wake-world")).toBeHidden();
  await page.locator("#wake-world").evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.locator("#dawn-card")).toBeHidden();

  await page.getByRole("button", { name: /Start over/i }).click();
  await expect(page.getByRole("heading", { name: "Who carries the lantern?" })).toBeVisible();
  await expect(page.locator("#world-result")).toBeHidden();
});

test("start over scrubs unsubmitted text and seed-derived hidden DOM", async ({ page }) => {
  await startParty(page);
  await takeTurn(page, turns[0]);
  await takeTurn(page, turns[1]);
  await takeTurn(page, turns[2]);

  await page.getByRole("button", { name: "I have the lantern" }).click();
  await expect(page.locator("#turn-answer")).toHaveAttribute("placeholder", turns[1] + " must …");
  await page.locator("#turn-answer").fill("private unfinished words stay nowhere after a deliberate clear");
  await page.getByRole("button", { name: /Stop party/i }).click();
  await page.getByRole("button", { name: /Start over/i }).click();

  await expect(page.locator("#turn-answer")).toHaveValue("");
  await expect(page.locator("#turn-answer")).toHaveAttribute("placeholder", "");
  await expect(page.locator("#turn-answer")).toHaveAttribute("aria-invalid", "false");
  await expect(page.locator("#turn-prompt")).toHaveText("Your next turn will appear here.");
  await expect(page.locator("#world-output")).toBeEmpty();
  await expect(page.locator("#world-title")).toHaveText("A world appears.");
});

test("duplicate labels, duplicate seeds, laws, and weaves receive exact guidance", async ({ page }) => {
  await page.goto(`${WEB}/party.html`);
  await page.locator("#player-2").fill("Moss");
  await page.getByRole("button", { name: /Start the party/i }).click();
  await expect(page.locator("#setup-error")).toContainText("three different labels");
  await expect(page.locator("#player-2")).toHaveAttribute("aria-invalid", "true");

  await page.locator("#player-2").fill("Rain");
  await page.getByRole("button", { name: /Start the party/i }).click();
  await takeTurn(page, turns[0]);

  await page.getByRole("button", { name: "I have the lantern" }).click();
  await page.locator("#turn-answer").fill(turns[0]);
  await page.getByRole("button", { name: "Place it in the world" }).click();
  await expect(page.locator("#turn-error")).toContainText("already exists");
  await expect(page.locator("#turn-answer")).toHaveAttribute("aria-invalid", "true");
  await page.locator("#turn-answer").fill(turns[1]);
  await page.getByRole("button", { name: "Place it in the world" }).click();
  await takeTurn(page, turns[2]);

  await expect(page.locator('[data-phase="seed"]')).toHaveAttribute("aria-label", "Seed complete");
  const completionMark = await page.locator('[data-phase="seed"]').evaluate((element) =>
    getComputedStyle(element, "::after").content,
  );
  expect(completionMark).toContain("✓");

  await page.getByRole("button", { name: "I have the lantern" }).click();
  await page.locator("#turn-answer").fill("A compass remembering laughter points softly toward every guest at dawn.");
  await page.getByRole("button", { name: "Place it in the world" }).click();
  await expect(page.locator("#turn-error")).toContainText("must, cannot, or always");
  await page.locator("#turn-answer").fill(turns[3]);
  await page.getByRole("button", { name: "Place it in the world" }).click();
  await takeTurn(page, turns[4]);
  await takeTurn(page, turns[5]);

  await page.getByRole("button", { name: "I have the lantern" }).click();
  await page.locator("#turn-answer").fill(turns[6].replace(" because ", " while "));
  await page.getByRole("button", { name: "Place it in the world" }).click();
  await expect(page.locator("#turn-error")).toContainText("Include because");
});

test("keyboard play works, reduced motion rests, and no-script setup stays inert", async ({ browser, page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto(`${WEB}/party.html`);
  await page.locator("#player-1").focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "I have the lantern" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#turn-answer")).toBeFocused();
  await expect(page.locator(".lantern-one")).toHaveCSS("animation-name", "none");

  const noScript = await browser.newPage({ javaScriptEnabled: false });
  await noScript.goto(`${WEB}/party.html`);
  await expect(noScript.locator("#setup-form")).toBeHidden();
  await expect(noScript.getByText(/complete rules and boundaries remain readable/)).toBeVisible();
  await noScript.close();
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
  expect(source).not.toMatch(/setInterval|setTimeout|WebSocket|EventSource|sendBeacon|serviceWorker|fetch\s*\(|Math\.random|crypto\.getRandomValues/);
  expect(welcome.ways_in).toContainEqual(expect.objectContaining({ html: "/party", json: "/party.json" }));
  expect(rules.privacy).toMatchObject({ persisted: false, sent_to_agenttool: false, network_writes: false });
  expect(rules.privacy).toMatchObject({ real_names_required: false, player_labels_requested: true });
  expect(rules.turns).toMatchObject({ exact: 9, timer: false, background_loop: false });
  expect(rules.agent_gather).toMatchObject({
    total_agents: 3,
    initiator_is_player: true,
    additional_agents_to_open: 2,
  });
  expect(rules.agent_gather.if_three_distinct_contexts_are_unavailable).toMatch(/stop.*do not impersonate/i);
  expect(rules.agent_gather.assignments).toHaveLength(3);
  expect(rules.outcome.epilogue).toMatchObject({
    name: "First morning",
    new_turns: 0,
    new_input: false,
    network_requests: false,
    model_calls: false,
  });
  expect(rules.accessibility).toMatchObject({ color_only_meaning: false, reduced_motion_honored: true });
  expect(sitemap).toContain("https://agenttool.dev/party");
});
