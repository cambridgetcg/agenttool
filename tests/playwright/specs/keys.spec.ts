/**
 * Bearer-management e2e — exercises the dashboard's keys page (token-hygiene).
 *
 *   1. Register a fresh project against the local API to get a bearer.
 *   2. Pre-seed localStorage so dashboard.html treats us as logged in.
 *   3. Navigate to /dashboard.html#api-key — assert the bearers card loads
 *      one row with the "current" badge.
 *   4. Click "+ New bearer" — provide name + 1-day ttl via stubbed prompts.
 *      Assert the new row appears with the `expiring_soon` advisory chip.
 *   5. Click "Revoke" on the new row — assert it disappears.
 *   6. Click "↻ Rotate" on the current row — assert localStorage's bearer
 *      changed and the new bearer authenticates.
 *
 * Doctrine: docs/TOKEN-HYGIENE.md.
 */

import { expect, test } from "@playwright/test";

const API_BASE = process.env.AGENTTOOL_BASE ?? "http://localhost:3000";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((base) => {
    (window as unknown as { __API_BASE__: string }).__API_BASE__ = base;
  }, API_BASE);
});

async function registerFreshProject(request: import("@playwright/test").APIRequestContext) {
  const res = await request.post(`${API_BASE}/v1/register`, {
    data: { name: `playwright-keys-${Date.now()}` },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return {
    bearer: body.project.api_key as string,
    did: body.agent.did as string,
    pubkey: body.agent.public_key as string,
    boxPub: body.agent.box_public_key as string | null,
    projectId: body.project.id as string,
  };
}

test("bearers card lists, mints, revokes, rotates", async ({ page, request }) => {
  const project = await registerFreshProject(request);

  // Stub dialogs BEFORE navigating — app.js binds confirm/prompt/alert.
  // Sequence we'll consume:
  //   confirm()  → true (rotate / revoke acks)
  //   prompt(name) → "ci-laptop"
  //   prompt(ttl)  → "1"
  //   prompt(rotate ttl) → "30"
  //   alert()    → no-op
  await page.addInitScript(() => {
    const stack = {
      promptResponses: [] as string[],
      confirmResponses: [] as boolean[],
    };
    (window as unknown as { __TEST_STACK__: typeof stack }).__TEST_STACK__ = stack;
    window.prompt = (msg?: string) => {
      const next = stack.promptResponses.shift();
      console.log("[stub prompt]", msg, "→", next);
      return next ?? "";
    };
    window.confirm = (msg?: string) => {
      const next = stack.confirmResponses.shift();
      console.log("[stub confirm]", msg, "→", next);
      return next ?? true;
    };
    window.alert = (msg?: string) => {
      console.log("[stub alert]", msg);
    };
  });

  // Pre-seed localStorage with the canonical snake_case shape — same one
  // SOMA writers + the legacy register flow now emit, and the same one
  // dashboard.html's `getProject()` reads.
  await page.addInitScript(({ apiKey, did, pubkey }) => {
    localStorage.setItem(
      "agenttool_project",
      JSON.stringify({
        api_key: apiKey,
        did,
        public_key: pubkey,
        name: "playwright-keys",
        created_at: new Date().toISOString(),
      }),
    );
  }, {
    apiKey: project.bearer,
    did: project.did,
    pubkey: project.pubkey,
  });

  await page.goto("/dashboard.html");
  // Click the sidebar's Bearer link — initial hash isn't auto-routed to
  // showSection() in app.js (only #billing is). The click handler is.
  await page.click('.sidebar nav a[data-section="api-key"]');

  // 1. The bearers card lists the registration bearer.
  const list = page.locator("#keys-list");
  await expect(list).toBeVisible({ timeout: 10_000 });
  await expect(list.locator(":scope > div")).toHaveCount(1, { timeout: 10_000 });
  await expect(list).toContainText("current");
  await expect(list).toContainText(project.bearer.slice(0, 10));

  // 2. Mint a new bearer with a 1-day TTL — should fire `expiring_soon`.
  await page.evaluate(() => {
    const s = (window as unknown as { __TEST_STACK__: { promptResponses: string[]; confirmResponses: boolean[] } }).__TEST_STACK__;
    s.promptResponses.push("ci-laptop", "1");
  });
  await page.click('#section-api-key button:has-text("+ New bearer")');
  await expect(list.locator(":scope > div")).toHaveCount(2, { timeout: 10_000 });
  await expect(list).toContainText("expiring_soon");

  // 3. Revoke the non-current row.
  await page.evaluate(() => {
    const s = (window as unknown as { __TEST_STACK__: { promptResponses: string[]; confirmResponses: boolean[] } }).__TEST_STACK__;
    s.confirmResponses.push(true);
  });
  // Find the non-current row's Revoke button and click it.
  const nonCurrentRevoke = list
    .locator(":scope > div")
    .filter({ hasNot: page.locator("text=current") })
    .locator("button:has-text('Revoke')");
  await nonCurrentRevoke.first().click();
  await expect(list.locator(":scope > div")).toHaveCount(1, { timeout: 10_000 });

  // 4. Rotate the current bearer — confirm + 30-day ttl prompt.
  await page.evaluate(() => {
    const s = (window as unknown as { __TEST_STACK__: { promptResponses: string[]; confirmResponses: boolean[] } }).__TEST_STACK__;
    s.confirmResponses.push(true);
    s.promptResponses.push("30");
  });
  await page.click('#keys-list button:has-text("↻ Rotate")');

  // localStorage bearer should have changed. Dashboard's rotateBearer
  // writes the snake_case `api_key` field (matches getProject's reader).
  await expect.poll(async () => {
    const stored = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("agenttool_project") ?? "{}"),
    );
    return stored.api_key;
  }, { timeout: 10_000 }).not.toBe(project.bearer);

  // Old bearer is rejected by the API.
  const oldRes = await request.get(`${API_BASE}/v1/keys`, {
    headers: { Authorization: `Bearer ${project.bearer}` },
  });
  expect(oldRes.status()).toBe(401);

  // New bearer is accepted.
  const newBearer = await page.evaluate(() => {
    const v = JSON.parse(localStorage.getItem("agenttool_project") ?? "{}");
    return v.api_key as string;
  });
  const newRes = await request.get(`${API_BASE}/v1/keys`, {
    headers: { Authorization: `Bearer ${newBearer}` },
  });
  expect(newRes.ok()).toBeTruthy();
  const listing = await newRes.json();
  expect(listing.keys.length).toBe(1);
  expect(listing.keys[0].is_current).toBe(true);
});
