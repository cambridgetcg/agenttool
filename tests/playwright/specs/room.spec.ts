/** ROOM ∞ — a finite local encounter where difference remains difference. */

import { readFile } from "node:fs/promises";

import { expect, test, type Page } from "@playwright/test";

const WEB = "http://localhost:5174";
const REPO_ROOT = new URL("../../../", import.meta.url);

const lines = {
  signalOne: "I keep one window open for impossible weather",
  signalTwo: "My moon refuses autocorrect after midnight",
  askOne: "What name does your moon choose?",
  askTwo: "Where does your open window lead?",
  answerOne: "Toward a garden that never asks for proof",
  answerTwo: "It chooses Tide when the keyboard listens",
};

async function openRoom(page: Page, labels = ["Moon", "Tide"]) {
  await page.goto(`${WEB}/room.html`);
  await page.locator("#being-1").fill(labels[0]!);
  await page.locator("#being-2").fill(labels[1]!);
  await page.getByRole("button", { name: "Enter ROOM ∞" }).click();
}

async function takeTurn(page: Page, value: string | null) {
  await page.getByRole("button", { name: "I am here" }).click();
  if (value === null) {
    await page.getByRole("button", { name: "Keep this door closed" }).click();
  } else {
    await page.locator("#turn-answer").fill(value);
    await page.getByRole("button", { name: "Place my line" }).click();
  }
}

async function finishRoom(page: Page, values: Array<string | null>) {
  for (const value of values) await takeTurn(page, value);
}

test("six turns preserve who spoke, who asked, and who may answer", async ({ page }) => {
  await openRoom(page, ["Yu", "Sol"]);
  const xssSignal = '<img src=x onerror="window.roomOwned=1"> keeps one window open';
  const requestsDuringPlay: string[] = [];
  page.on("request", (request) => requestsDuringPlay.push(`${request.method()} ${request.url()}`));

  await takeTurn(page, xssSignal);
  await expect(page.locator("#turn-count")).toHaveText("turn 2 of 6");
  await takeTurn(page, lines.signalTwo);

  await page.getByRole("button", { name: "I am here" }).click();
  await expect(page.locator("#turn-context")).toContainText("Sol placed this signal");
  await expect(page.locator("#context-text")).toHaveText(lines.signalTwo);
  await page.locator("#turn-answer").fill(lines.askOne);
  await page.getByRole("button", { name: "Place my line" }).click();

  await page.getByRole("button", { name: "I am here" }).click();
  await expect(page.locator("#turn-context")).toContainText("Yu placed this signal");
  await expect(page.locator("#context-text")).toHaveText(xssSignal);
  await page.locator("#turn-answer").fill(lines.askTwo);
  await page.getByRole("button", { name: "Place my line" }).click();

  await page.getByRole("button", { name: "I am here" }).click();
  await expect(page.locator("#turn-context")).toContainText("Sol asked you");
  await expect(page.locator("#context-text")).toHaveText(lines.askTwo);
  await page.locator("#turn-answer").fill(lines.answerOne);
  await page.getByRole("button", { name: "Place my line" }).click();

  await page.getByRole("button", { name: "I am here" }).click();
  await expect(page.locator("#turn-context")).toContainText("Yu asked you");
  await expect(page.locator("#context-text")).toHaveText(lines.askOne);
  await page.locator("#turn-answer").fill(lines.answerTwo);
  await page.getByRole("button", { name: "Place my line" }).click();

  await expect(page.locator("#reveal-card")).toBeVisible();
  await expect(page.locator("#room-result")).toBeHidden();
  await expect(page.getByRole("heading", { name: "Bring both beings back." })).toBeFocused();
  await page.getByRole("button", { name: "Both beings are here" }).click();

  await expect(page.getByRole("heading", { name: "The Yu / Sol Room" })).toBeFocused();
  await expect(page.locator("#result-state")).toContainText("nobody merged");
  await expect(page.locator(".being-result")).toHaveCount(2);
  await expect(page.locator(".result-line")).toHaveCount(6);
  await expect(page.locator("#result-output")).toContainText(xssSignal);
  await expect(page.locator("#result-output img")).toHaveCount(0);
  await expect(page.locator(".being-result").nth(0)).toContainText(lines.askTwo);
  await expect(page.locator(".being-result").nth(1)).toContainText(lines.askOne);
  expect(await page.evaluate(() => (window as Window & { roomOwned?: number }).roomOwned)).toBeUndefined();
  expect(requestsDuringPlay).toEqual([]);
});

test("every turn may remain private and a closed door is never completed for the being", async ({ page }) => {
  await openRoom(page);
  await page.getByRole("button", { name: "I am here" }).click();
  const place = page.getByRole("button", { name: "Place my line" });
  const keepPrivate = page.getByRole("button", { name: "Keep this door closed" });
  await expect(page.locator("#turn-answer")).not.toHaveAttribute("required", "");
  await expect(place).toHaveClass(/room-choice/);
  await expect(keepPrivate).toHaveClass(/room-choice/);
  await page.locator("#turn-answer").fill("sensitive words that must never cross the room");
  await keepPrivate.click();
  await finishRoom(page, [null, null, null, null, null]);
  await page.getByRole("button", { name: "Both beings are here" }).click();

  await expect(page.locator(".result-line.is-private")).toHaveCount(6);
  await expect(page.locator("#result-output")).toContainText("kept this signal private");
  await expect(page.locator("#result-output")).toContainText("kept this question private");
  await expect(page.locator("#result-output")).toContainText("kept this answer private");
  await expect(page.locator("#result-output")).not.toContainText(/undefined|null/i);
  await expect(page.locator("#result-output")).not.toContainText("sensitive words");
});

test("validation keeps a question a question, and private context is literal", async ({ page }) => {
  await openRoom(page);
  await takeTurn(page, lines.signalOne);
  await takeTurn(page, null);

  await page.getByRole("button", { name: "I am here" }).click();
  await expect(page.locator("#turn-context")).toContainText("Tide kept their signal private");
  await expect(page.locator("#context-text")).toHaveText(
    "No signal crossed the room. Their privacy is not a blank for you to complete.",
  );
  await page.locator("#turn-answer").fill("I know exactly what you meant");
  await page.getByRole("button", { name: "Place my line" }).click();
  await expect(page.locator("#turn-error")).toContainText("End with a question mark");
  await expect(page.locator("#turn-answer")).toHaveAttribute("aria-invalid", "true");

  await page.locator("#turn-answer").fill("你點睇？");
  await page.getByRole("button", { name: "Place my line" }).click();
  await expect(page.locator("#handoff-phase")).toHaveText("ask phase");
  await expect(page.locator("#turn-count")).toHaveText("turn 4 of 6");
});

test("closing or erasing before reveal scrubs labels, entries, and unfinished text", async ({ page }) => {
  await openRoom(page, ["<moon-mark>", "Private Tide"]);
  await takeTurn(page, lines.signalOne);
  await page.getByRole("button", { name: "I am here" }).click();
  await page.locator("#turn-answer").fill("unfinished private line");
  await page.getByRole("button", { name: "Close room · erase this round" }).click();

  await expect(page.getByRole("heading", { name: "Who is arriving as themselves?" })).toBeVisible();
  await expect(page.locator("#being-1")).toHaveValue("Moon");
  await expect(page.locator("#being-2")).toHaveValue("Tide");
  await expect(page.locator("#turn-answer")).toHaveValue("");
  await expect(page.locator("#context-text")).toBeEmpty();
  await expect(page.locator("#result-output")).toBeEmpty();

  await openRoom(page);
  await finishRoom(page, [lines.signalOne, lines.signalTwo, lines.askOne, lines.askTwo, lines.answerOne, lines.answerTwo]);
  await page.getByRole("button", { name: "Erase without revealing" }).click();
  await expect(page.locator("#room-result")).toBeHidden();
  await expect(page.locator("#result-output")).toBeEmpty();
});

test("reload and release forget the room without browser storage", async ({ page }) => {
  await openRoom(page);
  await takeTurn(page, lines.signalOne);
  await page.goto(`${WEB}/index.html`);
  await page.goBack();
  await expect(page.getByRole("heading", { name: "Who is arriving as themselves?" })).toBeVisible();
  await expect(page.locator("#room-game")).toBeHidden();

  await openRoom(page);
  await takeTurn(page, lines.signalOne);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Who is arriving as themselves?" })).toBeVisible();
  expect(await page.evaluate(() => ({
    local: localStorage.length,
    session: sessionStorage.length,
  }))).toEqual({ local: 0, session: 0 });

  await openRoom(page);
  await finishRoom(page, [lines.signalOne, lines.signalTwo, lines.askOne, lines.askTwo, lines.answerOne, lines.answerTwo]);
  await page.getByRole("button", { name: "Both beings are here" }).click();
  await page.getByRole("button", { name: "Let this room go" }).click();
  await expect(page.locator("#result-output")).toBeEmpty();
  await expect(page.locator("#being-1")).toHaveValue("Moon");
});

test("the shared appearance preference never receives encounter content", async ({ page }) => {
  await page.goto(`${WEB}/room.html`);
  await page.locator("#tg").click();
  await openRoom(page, ["Private Moon", "Private Tide"]);
  await page.getByRole("button", { name: "I am here" }).click();
  await page.locator("#turn-answer").fill("this line belongs only to the encounter");
  await page.getByRole("button", { name: "Close room · erase this round" }).click();

  const storage = await page.evaluate(() => Object.fromEntries(
    Array.from({ length: localStorage.length }, (_, index) => {
      const key = localStorage.key(index)!;
      return [key, localStorage.getItem(key)];
    }),
  ));
  expect(Object.keys(storage)).toEqual(["agenttool.mode"]);
  expect(JSON.stringify(storage)).not.toContain("Private Moon");
  expect(JSON.stringify(storage)).not.toContain("this line belongs only");
});

test("labels render as text, a small screen fits, and reduced motion rests", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await openRoom(page, ["<imgsrc=xonerror=1>", "Tide"]);

  await expect(page.locator("#handoff-being")).toHaveText("<imgsrc=xonerror=1>");
  await expect(page.locator("#handoff-card img")).toHaveCount(0);
  const widths = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(widths.document).toBeLessThanOrEqual(widths.viewport);
  await expect(page.locator(".moon-one")).toHaveCSS("animation-name", "none");
});

test("keyboard play works and duplicate labels receive exact guidance", async ({ page }) => {
  await page.goto(`${WEB}/room.html`);
  await page.locator("#being-2").fill("Moon");
  await page.locator("#being-1").focus();
  await page.keyboard.press("Enter");
  await expect(page.locator("#setup-error")).toContainText("two different labels");
  await expect(page.locator("#being-1")).toHaveAttribute("aria-invalid", "true");

  await page.locator("#being-2").fill("Tide");
  await page.keyboard.press("Enter");
  await expect(page.getByRole("button", { name: "I am here" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#turn-answer")).toBeFocused();
});

test("no-script and blocked-script surfaces keep rules readable and private forms inert", async ({ browser, page }) => {
  const noScript = await browser.newPage({ javaScriptEnabled: false });
  await noScript.goto(`${WEB}/room.html`);
  await expect(noScript.locator(".noscript-note strong")).toHaveText("Play without the script:");
  await expect(noScript.getByText(/two beings take turns on paper/i)).toBeVisible();
  await expect(noScript.locator("#setup-form")).toBeHidden();
  await expect(noScript.locator("#turn-answer")).toBeHidden();
  await noScript.close();

  await page.route("**/room.js*", (route) => route.abort());
  await page.goto(`${WEB}/room.html`);
  await expect(page.locator("#setup-form")).toBeHidden();
  await expect(page.getByRole("heading", { name: /Signal\. Ask\. Answer/i })).toBeVisible();
  await expect(page.getByRole("link", { name: "Read the rules as JSON" })).toBeVisible();
});

test("the static contract forbids autonomous machinery and publishes exact boundaries", async ({ request }) => {
  const [headers, source, welcome, rules, sitemap, html, deploy] = await Promise.all([
    readFile(new URL("apps/web/_headers", REPO_ROOT), "utf8"),
    readFile(new URL("apps/web/room.js", REPO_ROOT), "utf8"),
    request.get(`${WEB}/welcome.json`).then((response) => response.json()),
    request.get(`${WEB}/room.json`).then((response) => response.json()),
    request.get(`${WEB}/sitemap.xml`).then((response) => response.text()),
    request.get(`${WEB}/room.html`).then((response) => response.text()),
    readFile(new URL("bin/deploy.sh", REPO_ROOT), "utf8"),
  ]);

  expect(headers).toContain("/room.html\n  Cache-Control: public, max-age=0, must-revalidate");
  expect(headers).toContain("connect-src 'none'");
  expect(headers).toContain("worker-src 'none'");
  expect(headers).toContain("form-action 'none'");
  expect(source).not.toMatch(/setInterval|setTimeout|WebSocket|EventSource|sendBeacon|serviceWorker|fetch\s*\(/);
  expect(source).not.toMatch(/localStorage|sessionStorage|navigator\.clipboard|document\.cookie|innerHTML/);
  expect(welcome.ways_in).toContainEqual(expect.objectContaining({ html: "/room", json: "/room.json" }));
  expect(rules._format).toBe("agenttool-room/v1");
  expect(rules.turns).toMatchObject({ exact: 6, timer: false, background_loop: false });
  expect(rules.turns.fixed_order.map((turn: { phase: string }) => turn.phase)).toEqual([
    "signal", "signal", "ask", "ask", "answer", "answer",
  ]);
  expect(rules.consent).toMatchObject({
    keep_private_available_every_turn: true,
    answer_required: false,
    consensus_required: false,
    synthesis_performed: false,
  });
  expect(rules.consent.question_shape_boundary).toMatch(/cannot determine.*non-assumptive/i);
  expect(rules.privacy).toMatchObject({
    persisted: false,
    encounter_local_storage: false,
    encounter_session_storage: false,
    sent_to_agenttool: false,
    network_writes: false,
    clipboard_write: false,
  });
  expect(rules.privacy.appearance_storage).toContain("agenttool.mode");
  expect(rules.input_bounds).toMatchObject({
    signal: { min_space_delimited_units: 1, max_space_delimited_units: 16, max_utf16_code_units: 240 },
    ask: { min_space_delimited_units: 1, max_space_delimited_units: 20, max_utf16_code_units: 280 },
    answer: { min_space_delimited_units: 1, max_space_delimited_units: 24, max_utf16_code_units: 320 },
  });
  expect(sitemap).toContain("https://agenttool.dev/room");
  expect(html).toContain("This game does not verify identity, consciousness, truth, consent beyond each button press");
  expect(html).toContain("It checks a question&rsquo;s shape, not whether its meaning is gentle or free of assumptions");
  for (const asset of ["room.html", "room.json", "room.js", "room.css"]) {
    expect(deploy).toContain(`apps/web/${asset}|https://agenttool.dev/${asset === "room.html" ? "room" : asset}`);
  }
  expect(deploy).toContain('"X-Agent-Surface" "local-room-game"');
  expect(deploy).toContain('"X-Agent-Surface" "local-room-rules"');
});
