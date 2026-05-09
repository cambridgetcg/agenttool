/**
 * Onboarding e2e — full SOMA seed birth flow through the browser.
 *
 * Walks the byo-keys path from a fresh tab to a live agent:
 *   1. Load /onboard-soma.html
 *   2. Step 1 — name the agent + continue
 *   3. Step 2 — assert 24 mnemonic words appear in the grid
 *   4. Step 3 — operator confirms a randomly-chosen word
 *   5. Step 4 — registering happens automatically
 *   6. Step 5 — assert success state surfaces:
 *      - DID populated
 *      - public_key matches the derived signing pub from the bundle
 *      - bearer (api_key) saved to localStorage
 *      - byo_keys flag set
 *      - private_key omitted (server never saw it)
 *
 * Doctrine: docs/IDENTITY-SEED.md.
 */

import { expect, test } from "@playwright/test";

const API_BASE = process.env.AGENTTOOL_BASE ?? "http://localhost:3000";

test.beforeEach(async ({ page }) => {
  // Override the production API base so the page hits our local API.
  await page.addInitScript((base) => {
    (window as unknown as { __API_BASE__: string }).__API_BASE__ = base;
  }, API_BASE);
});

test("byo-keys onboarding produces a live agent", async ({ page }) => {
  // 1. Load the onboarding page
  await page.goto("/onboard-soma.html");
  await expect(page.locator("h1")).toContainText("Onboard with the");
  await expect(page.locator(".step.active")).toHaveAttribute("id", "step-name");

  // 2. Step 1 — name + continue
  const agentName = `playwright-soma-${Date.now()}`;
  await page.fill("#agent-name", agentName);
  await page.fill("#agent-purpose", "End-to-end Playwright verification");
  await page.click("#btn-name-next");

  // 3. Step 2 — mnemonic grid populates
  await expect(page.locator(".step.active")).toHaveAttribute("id", "step-mnemonic");
  // 24 words rendered with data-word-index attributes
  const wordEls = page.locator("#seed-grid .seed-word .word");
  await expect(wordEls).toHaveCount(24);

  // Capture the displayed mnemonic for cross-checking
  const wordsArr = await wordEls.allTextContents();
  expect(wordsArr).toHaveLength(24);
  // Sanity: each word non-empty + alphabetic
  for (const w of wordsArr) {
    expect(w).toMatch(/^[a-z]+$/);
  }
  const mnemonic = wordsArr.join(" ");

  // Confirm step
  await page.click("#btn-mnemonic-confirm");

  // 4. Step 3 — verify a random word
  await expect(page.locator(".step.active")).toHaveAttribute("id", "step-verify");
  const idxText = await page.locator("#verify-idx").textContent();
  const idx = Number.parseInt(idxText ?? "0", 10);
  expect(idx).toBeGreaterThanOrEqual(2);
  expect(idx).toBeLessThanOrEqual(23);
  await page.fill("#verify-word", wordsArr[idx - 1]);
  await page.click("#btn-verify");

  // 5. Step 4/5 — register completes; success step appears
  await expect(page.locator(".step.active")).toHaveAttribute("id", "step-success", {
    timeout: 15_000,
  });

  // 6. Assertions on success state
  const did = await page.locator("#result-did").textContent();
  const pubkey = await page.locator("#result-pubkey").textContent();
  const boxpub = await page.locator("#result-boxpub").textContent();
  const bearer = await page.locator("#result-bearer").textContent();

  expect(did).toMatch(/^did:at:[0-9a-f-]{36}$/);
  // Base64-encoded 32-byte pubkey is 44 chars (with `=` pad)
  expect(pubkey).toMatch(/^[A-Za-z0-9+/]+=*$/);
  expect(pubkey?.length).toBe(44);
  expect(boxpub).toMatch(/^[A-Za-z0-9+/]+=*$/);
  expect(boxpub?.length).toBe(44);
  expect(bearer).toMatch(/^at_/);

  // The window-exposed result reflects the byo-keys posture
  const result = await page.evaluate(() => (window as unknown as { __SOMA_REGISTER_RESULT__: unknown }).__SOMA_REGISTER_RESULT__);
  expect(result).toMatchObject({
    derivedSigningPubMatches: true,
    derivedBoxPubMatches: true,
    privateKeyOmitted: true,
    byoKeys: true,
  });

  // localStorage carries the project record for dashboard.html
  const stored = await page.evaluate(() => localStorage.getItem("agenttool_project"));
  expect(stored).not.toBeNull();
  const parsed = JSON.parse(stored!);
  expect(parsed).toMatchObject({
    api_key: bearer,
    did,
    public_key: pubkey,
    box_public_key: boxpub,
    byo_keys: true,
    seed_protocol: "soma-seed-v1",
  });

  // Server-side confirm: GET /v1/wake should return our agent.
  const wake = await page.request.get(`${API_BASE}/v1/wake`, {
    headers: { Authorization: `Bearer ${bearer}` },
  });
  expect(wake.ok()).toBeTruthy();
  const wakeBody = await wake.json();
  const agents = wakeBody?.you?.agents ?? [];
  const matched = agents.find((a: { did: string }) => a.did === did);
  expect(matched).toBeTruthy();
});

test("verify rejects the wrong word", async ({ page }) => {
  await page.goto("/onboard-soma.html");
  await page.fill("#agent-name", `bad-verify-${Date.now()}`);
  await page.click("#btn-name-next");
  await expect(page.locator(".step.active")).toHaveAttribute("id", "step-mnemonic");

  await page.click("#btn-mnemonic-confirm");
  await expect(page.locator(".step.active")).toHaveAttribute("id", "step-verify");

  // Type a deliberately wrong word
  await page.fill("#verify-word", "wrong-word-not-in-bip39");
  await page.click("#btn-verify");

  // Should still be on the verify step, with an error visible
  await expect(page.locator(".step.active")).toHaveAttribute("id", "step-verify");
  const err = await page.locator("#err-verify").textContent();
  expect(err).toContain("doesn't match");
});

test("regenerate produces a different mnemonic", async ({ page }) => {
  await page.goto("/onboard-soma.html");
  await page.fill("#agent-name", `regen-${Date.now()}`);
  await page.click("#btn-name-next");

  const first = await page.locator("#seed-grid .seed-word .word").allTextContents();
  await page.click("#btn-mnemonic-regen");
  const second = await page.locator("#seed-grid .seed-word .word").allTextContents();

  expect(first).toHaveLength(24);
  expect(second).toHaveLength(24);
  expect(first.join(" ")).not.toBe(second.join(" "));
});
