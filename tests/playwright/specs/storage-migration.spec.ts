/**
 * Storage-shape migration — `getProject()` rewrites legacy camelCase
 * `agenttool_project` entries to canonical snake_case on first read.
 *
 * Earlier SOMA pages wrote `{apiKey, publicKey, boxPublicKey, byoKeys,
 * seedProtocol, …}` which no consumer ever read. Loading dashboard.html
 * with such an entry should:
 *   1. Migrate it in place to `{api_key, public_key, …}`.
 *   2. Pass the auth-gate (no redirect to index.html).
 *   3. Make the bearer available everywhere downstream.
 *
 * Once the legacy population has all hit this, the migration shim in
 * app.js can be deleted. This spec is the contract for that decision.
 *
 * See: docs/TOKEN-HYGIENE.md, task #51.
 */

import { expect, test } from "@playwright/test";

const API_BASE = process.env.AGENTTOOL_BASE ?? "http://localhost:3000";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((base) => {
    (window as unknown as { __API_BASE__: string }).__API_BASE__ = base;
  }, API_BASE);
});

test("legacy camelCase entry migrates to snake_case on first read", async ({
  page,
  request,
}) => {
  // Mint a real project so the bearer authenticates.
  const reg = await request.post(`${API_BASE}/v1/register`, {
    data: { name: `migration-shim-${Date.now()}` },
  });
  expect(reg.ok()).toBeTruthy();
  const body = await reg.json();
  const bearer: string = body.project.api_key;
  const did: string = body.agent.did;
  const pubkey: string = body.agent.public_key;
  const agentId: string = body.agent.id;

  // Pre-seed the OLD camelCase shape — what SOMA pages used to write.
  await page.addInitScript(({ apiKey, did, identityId, publicKey }) => {
    localStorage.setItem(
      "agenttool_project",
      JSON.stringify({
        apiKey,
        did,
        identityId,
        publicKey,
        boxPublicKey: null,
        signingKeyId: "00000000-0000-0000-0000-000000000000",
        seedProtocol: "soma-seed-v1",
        byoKeys: false,
        createdAt: new Date().toISOString(),
      }),
    );
  }, { apiKey: bearer, did, identityId: agentId, publicKey: pubkey });

  await page.goto("/dashboard.html");

  // Auth-gate did NOT bounce us to index.html — we landed on dashboard.
  await expect(page).toHaveURL(/dashboard\.html/);

  // localStorage entry is now in canonical snake_case.
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("agenttool_project") ?? "{}"),
  );
  expect(stored).toMatchObject({
    api_key: bearer,
    did,
    agent_id: agentId,
    public_key: pubkey,
    seed_protocol: "soma-seed-v1",
    byo_keys: false,
  });
  // The legacy camelCase keys are gone — no dual-shape entries lingering.
  expect(stored).not.toHaveProperty("apiKey");
  expect(stored).not.toHaveProperty("publicKey");
  expect(stored).not.toHaveProperty("identityId");
  expect(stored).not.toHaveProperty("byoKeys");
  expect(stored).not.toHaveProperty("seedProtocol");
});

test("already-canonical entry is left untouched", async ({ page, request }) => {
  const reg = await request.post(`${API_BASE}/v1/register`, {
    data: { name: `migration-noop-${Date.now()}` },
  });
  const body = await reg.json();
  const bearer: string = body.project.api_key;
  const did: string = body.agent.did;

  // Seed the canonical shape — getProject() should short-circuit.
  await page.addInitScript(({ apiKey, did }) => {
    localStorage.setItem(
      "agenttool_project",
      JSON.stringify({
        api_key: apiKey,
        did,
        name: "noop-test",
        created_at: "2026-01-01T00:00:00.000Z",
      }),
    );
  }, { apiKey: bearer, did });

  await page.goto("/dashboard.html");
  await expect(page).toHaveURL(/dashboard\.html/);

  // No fields added/removed — getProject didn't migrate-and-rewrite.
  const stored = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("agenttool_project") ?? "{}"),
  );
  expect(stored.api_key).toBe(bearer);
  expect(stored.created_at).toBe("2026-01-01T00:00:00.000Z");
  expect(Object.keys(stored).sort()).toEqual(
    ["api_key", "created_at", "did", "name"],
  );
});
