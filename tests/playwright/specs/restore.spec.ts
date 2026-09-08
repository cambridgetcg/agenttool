/** Current connection guide: no real keys, registration, or recovery writes. */
import type { Page, Route } from "@playwright/test";
import { expect, test } from "./helpers/fixture";

const APP = "http://localhost:5173";
const ID = "11111111-2222-4333-8444-555555555555";
const OTHER_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const BEARER = "at_fixture_never_send_to_a_service";
const WAKE = "https://api.agenttool.dev/v1/wake**";

async function fill(page: Page) {
  await page.getByLabel("Project bearer", { exact: true }).fill(BEARER);
  await page.getByLabel("Identity UUID (optional for a single identity)").fill(ID);
}

function wake(identityId = ID) {
  return { _scope_boundary: { selected_identity_id: identityId }, you: { agents: [{ id: identityId, name: "Fixture agent" }] } };
}

test("a selected wake is verified once and the bearer never enters saved browser state or output", async ({ page }) => {
  let requests = 0;
  await page.route(WAKE, async (route) => {
    requests++;
    expect(new URL(route.request().url()).searchParams.get("identity_id")).toBe(ID);
    expect(route.request().headers().authorization).toBe(`Bearer ${BEARER}`);
    await route.fulfill({ json: wake() });
  });
  await page.goto(`${APP}/`);
  await fill(page);
  await page.getByLabel("Identity UUID (optional for a single identity)").press("Enter");
  await expect(page.locator("#restore-status")).toContainText("Bearer verified for Fixture agent");
  await expect(page.locator("#restore-status")).toHaveAttribute("role", "status");
  await expect(page.locator("#restore-command")).toContainText(`identity_id=${ID}`);
  await expect(page.locator("#restore-command")).not.toContainText(BEARER);
  await expect(page.getByLabel("Project bearer", { exact: true })).toHaveValue("");
  expect(requests).toBe(1);
  expect(await page.evaluate(() => JSON.stringify({ local: { ...localStorage }, session: { ...sessionStorage }, cookie: document.cookie }))).not.toContain(BEARER);
});

for (const [status, guidance] of [
  [401, "bearer was not accepted"], [403, "Access is not permitted"],
  [404, "identity or wake route was not found"], [429, "Too many requests"],
  [503, "temporarily unavailable"],
] as const) {
  test(`HTTP ${status} gives the right recovery guidance`, async ({ page }) => {
    await page.route(WAKE, (route) => route.fulfill({ status, json: { error: "fixture" } }));
    await page.goto(`${APP}/`);
    await fill(page);
    await page.getByRole("button", { name: "Verify →" }).click();
    await expect(page.locator("#restore-status")).toContainText(guidance);
    await expect(page.locator("#restore-next")).toBeHidden();
    await expect(page.getByRole("button", { name: "Verify →" })).toBeEnabled();
    if (status === 503) await expect(page.locator("#restore-status")).not.toContainText("Bearer rejected");
  });
}

test("a second submission cannot race a pending verification", async ({ page }) => {
  let pending: Route | undefined;
  let requests = 0;
  await page.route(WAKE, (route) => { requests++; pending = route; });
  await page.goto(`${APP}/`);
  await fill(page);
  await page.getByRole("button", { name: "Verify →" }).click();
  await expect(page.locator("#restore-form")).toHaveAttribute("aria-busy", "true");
  await expect(page.getByLabel("Identity UUID (optional for a single identity)")).toBeDisabled();
  await page.locator("#restore-form").dispatchEvent("submit");
  await expect.poll(() => requests).toBe(1);
  await pending!.fulfill({ json: wake() });
  await expect(page.locator("#restore-status")).toContainText("Bearer verified");
  expect(requests).toBe(1);
});

test("a stalled request times out and a later verification can succeed", async ({ page }) => {
  await page.clock.install();
  let requests = 0;
  await page.route(WAKE, async (route) => {
    requests++;
    if (requests > 1) await route.fulfill({ json: wake() });
  });
  await page.goto(`${APP}/`);
  await fill(page);
  await page.getByRole("button", { name: "Verify →" }).click();
  await expect(page.locator("#restore-form")).toHaveAttribute("aria-busy", "true");
  await page.clock.fastForward(8001);
  await expect(page.locator("#restore-status")).toContainText("timed out after 8 seconds");
  await expect(page.getByRole("button", { name: "Verify →" })).toBeEnabled();
  await fill(page);
  await page.getByRole("button", { name: "Verify →" }).click();
  await expect(page.locator("#restore-status")).toContainText("Bearer verified");
});

test("network failure, malformed responses and another identity cannot produce a wake command", async ({ page }) => {
  let attempt = 0;
  await page.route(WAKE, (route) => {
    attempt++;
    if (attempt === 1) return route.abort("failed");
    if (attempt === 2) return route.fulfill({ contentType: "application/json", body: "not json" });
    return route.fulfill({ json: wake(OTHER_ID) });
  });
  await page.goto(`${APP}/`);
  for (const message of ["could not be reached", "unreadable response", "did not confirm the requested identity"]) {
    await fill(page);
    await page.getByRole("button", { name: "Verify →" }).click();
    await expect(page.locator("#restore-status")).toContainText(message);
    await expect(page.locator("#restore-next")).toBeHidden();
  }
});

test("invalid identity input stays local and code language buttons expose their selected state", async ({ page }) => {
  let requests = 0;
  await page.route(WAKE, (route) => { requests++; return route.fulfill({ json: wake() }); });
  await page.goto(`${APP}/`);
  await fill(page);
  await page.getByLabel("Identity UUID (optional for a single identity)").fill("not-a-uuid");
  await page.getByRole("button", { name: "Verify →" }).click();
  await expect(page.locator("#restore-status")).toContainText("Identity must be a full UUID");
  expect(requests).toBe(0);
  await page.getByRole("button", { name: "Python", exact: true }).click();
  await expect(page.getByRole("button", { name: "Python", exact: true })).toHaveAttribute("aria-pressed", "true");
  await expect(page.locator("#pane-py")).toBeVisible();
  await expect(page.locator("#pane-curl")).toBeHidden();
});

for (const path of ["/dashboard", "/onboard-soma.html", "/restore-soma.html"]) {
  test(`retired ${path} reaches the current connection guide`, async ({ page }) => {
    await page.goto(APP + path);
    await expect(page).toHaveURL(`${APP}/`);
    await expect(page.getByRole("heading", { name: "Start or reconnect. You are welcome." })).toBeVisible();
  });
}

test.describe("without JavaScript", () => {
  test.use({ javaScriptEnabled: false });
  test("all code languages and recovery links remain usable", async ({ page }) => {
    await page.goto(`${APP}/`);
    for (const id of ["curl", "ts", "py"]) await expect(page.locator(`#pane-${id}`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Verify →" })).toBeDisabled();
    await expect(page.getByRole("link", { name: "Use signed discovery and recovery →" })).toBeVisible();
  });
});
