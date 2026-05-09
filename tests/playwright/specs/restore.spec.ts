/**
 * Recovery e2e — fresh-laptop restore via the new MnemonicGrid flow.
 *
 *   Step 1: 24-cell grid (BIP39 autocomplete, paste-distribute, validation)
 *   Step 2: Discovery — POST /public/identities/by-pubkey, agent picker
 *           (or manual DID fallback if zero matches)
 *   Step 3: Device label
 *   Step 4: Batch /v1/identity/recover — per-agent bearer + localStorage
 *
 *  Doctrine: docs/IDENTITY-SEED.md.
 */

import { expect, test } from "@playwright/test";

const API_BASE = process.env.AGENTTOOL_BASE ?? "http://localhost:3000";

const ORACLE_MNEMONIC =
  "abandon abandon abandon abandon abandon abandon abandon abandon " +
  "abandon abandon abandon about";
const ORACLE_SIGNING_PUB_B64 = "MvGLRKH953Fqbr2CENCcK/USGXCATv4nZYfsrW8sqSw=";
const ORACLE_K_MASTER_B64 = "hd+mJHIz2tay3d2IPP4Xaq5juGoTUbmHvDXhqAtSi1w=";
const ORACLE_K_VAULT_B64 = "R2CSaWsKXf7erBD9v1o/zRxwbntDd7eZsu8va4qSqO4=";
const ORACLE_BOX_PUB_B64 = "4ZKHNkxigN4wKm97eG3YVInZ48nfaW+p+dPrVCuRoR4=";

test.beforeEach(async ({ page }) => {
  await page.addInitScript((base) => {
    (window as unknown as { __API_BASE__: string }).__API_BASE__ = base;
  }, API_BASE);
});

/** Helper: paste a mnemonic into cell-0 to trigger distribute logic. */
async function pasteMnemonic(page: import("@playwright/test").Page, mnemonic: string) {
  await page.evaluate((m) => {
    const inp = document.querySelector('.cell-input[data-idx="0"]') as HTMLInputElement;
    inp.focus();
    const evt = new ClipboardEvent("paste", { clipboardData: new DataTransfer() });
    Object.defineProperty(evt, "clipboardData", {
      value: { getData: () => m },
    });
    inp.dispatchEvent(evt);
  }, mnemonic);
}

test("grid: oracle mnemonic derives byte-identical material", async ({ page }) => {
  await page.goto("/restore-soma.html");
  await expect(page.locator("h1")).toContainText("Restore from");

  // Default state: continue is disabled.
  await expect(page.locator("#btn-continue")).toBeDisabled();

  // Paste the oracle into cell-0 — should distribute across all 12 cells
  // for this 12-word mnemonic. (Grid has 24 cells; first 12 fill, rest empty.)
  await pasteMnemonic(page, ORACLE_MNEMONIC);

  // Status indicator reads "12 / 24 words · ✓ checksum valid"
  await expect(page.locator("#grid-status")).toContainText("12 / 24");
  await expect(page.locator("#grid-status")).toContainText("checksum valid");
  await expect(page.locator("#btn-continue")).toBeEnabled();

  // First 12 cells filled with valid words.
  for (let i = 0; i < 12; i++) {
    const v = await page.locator(`.cell-input[data-idx="${i}"]`).inputValue();
    expect(v.length).toBeGreaterThan(0);
    await expect(page.locator(`.cell[data-idx="${i}"]`)).toHaveClass(/valid/);
  }

  // Click continue → derives → POSTs discovery → either lands on step-discover
  // (with zero matches → manual fallback) OR stays on step-input if API fails.
  // Either way, the derivation surface should be populated.
  await page.click("#btn-continue");
  // Wait for either step transition or the discover endpoint result.
  await page.waitForFunction(
    () => {
      const result = (window as unknown as {
        __SOMA_RESTORE_RESULT__?: { signingPubB64?: string };
      }).__SOMA_RESTORE_RESULT__;
      return !!result?.signingPubB64;
    },
    { timeout: 15_000 },
  );

  const exposed = await page.evaluate(
    () => (window as unknown as { __SOMA_RESTORE_RESULT__: Record<string, string> }).__SOMA_RESTORE_RESULT__,
  );
  expect(exposed).toMatchObject({
    signingPubB64: ORACLE_SIGNING_PUB_B64,
    boxPubB64: ORACLE_BOX_PUB_B64,
    kMasterB64: ORACLE_K_MASTER_B64,
    kVaultB64: ORACLE_K_VAULT_B64,
  });
});

test("grid: continue stays disabled with bad checksum", async ({ page }) => {
  await page.goto("/restore-soma.html");
  // 12 valid wordlist words but they don't form a valid mnemonic (wrong checksum).
  await pasteMnemonic(
    page,
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon",
  );
  await expect(page.locator("#grid-status")).toContainText("checksum invalid");
  await expect(page.locator("#btn-continue")).toBeDisabled();
});

test("grid: out-of-wordlist words flagged invalid", async ({ page }) => {
  await page.goto("/restore-soma.html");
  // Paste 12 words but one isn't in BIP39
  await pasteMnemonic(
    page,
    "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon zzzzzzz",
  );
  await expect(page.locator("#grid-status")).toContainText("not in wordlist");
  await expect(page.locator("#btn-continue")).toBeDisabled();
  // The bad cell is marked invalid
  await expect(page.locator('.cell[data-idx="11"]')).toHaveClass(/invalid/);
});

test("grid: BIP39 autocomplete suggestions appear when typing prefix", async ({ page }) => {
  await page.goto("/restore-soma.html");
  const inp = page.locator('.cell-input[data-idx="0"]');
  await inp.focus();
  await inp.fill("aban");
  // Suggest dropdown should show 'abandon'
  const sug = page.locator('.cell[data-idx="0"] .cell-suggest button').first();
  await expect(sug).toContainText("abandon");
  // Click to autocomplete
  await sug.click();
  await expect(inp).toHaveValue("abandon");
});

test("grid: paste at any cell distributes from cell 0", async ({ page }) => {
  await page.goto("/restore-soma.html");
  // Paste into cell 5
  await page.evaluate((m) => {
    const inp = document.querySelector('.cell-input[data-idx="5"]') as HTMLInputElement;
    inp.focus();
    const evt = new ClipboardEvent("paste", { clipboardData: new DataTransfer() });
    Object.defineProperty(evt, "clipboardData", {
      value: { getData: () => m },
    });
    inp.dispatchEvent(evt);
  }, ORACLE_MNEMONIC);
  // Despite pasting into cell 5, distribution starts at cell 0
  expect(await page.locator('.cell-input[data-idx="0"]').inputValue()).toBe("abandon");
  expect(await page.locator('.cell-input[data-idx="11"]').inputValue()).toBe("about");
});

test("show-all toggle reveals + hides masked cells", async ({ page }) => {
  await page.goto("/restore-soma.html");
  await pasteMnemonic(page, ORACLE_MNEMONIC);
  // By default, cells are masked.
  await expect(page.locator('.cell-input[data-idx="0"]')).toHaveClass(/masked/);
  await page.click("#btn-show-all");
  await expect(page.locator('.cell-input[data-idx="0"]')).not.toHaveClass(/masked/);
  await page.click("#btn-show-all");
  await expect(page.locator('.cell-input[data-idx="0"]')).toHaveClass(/masked/);
});

test("clear button empties the grid", async ({ page }) => {
  await page.goto("/restore-soma.html");
  await pasteMnemonic(page, ORACLE_MNEMONIC);
  await expect(page.locator('.cell-input[data-idx="0"]')).toHaveValue("abandon");
  await page.click("#btn-clear");
  await expect(page.locator('.cell-input[data-idx="0"]')).toHaveValue("");
  await expect(page.locator("#grid-status")).toContainText("0 / 24");
});

test("end-to-end: onboard → restore with discovery + batch recover", async ({ page, context }) => {
  // 1. Onboard a fresh agent
  await page.goto("/onboard-soma.html");
  const agentName = `e2e-grid-${Date.now()}`;
  await page.fill("#agent-name", agentName);
  await page.click("#btn-name-next");

  const wordsArr = await page.locator("#seed-grid .seed-word .word").allTextContents();
  const mnemonic = wordsArr.join(" ");
  await page.click("#btn-mnemonic-confirm");
  const idx = Number(await page.locator("#verify-idx").textContent());
  await page.fill("#verify-word", wordsArr[idx - 1]);
  await page.click("#btn-verify");

  await expect(page.locator(".step.active")).toHaveAttribute("id", "step-success", {
    timeout: 15_000,
  });
  const did = (await page.locator("#result-did").textContent())!;
  const originalPubkey = (await page.locator("#result-pubkey").textContent())!;
  const originalBearer = (await page.locator("#result-bearer").textContent())!;

  // 2. Fresh browser context — simulate a different device
  const freshContext = await context.browser()!.newContext();
  const freshPage = await freshContext.newPage();
  await freshPage.addInitScript((base) => {
    (window as unknown as { __API_BASE__: string }).__API_BASE__ = base;
  }, API_BASE);

  await freshPage.goto("/restore-soma.html");
  expect(await freshPage.evaluate(() => localStorage.getItem("agenttool_project"))).toBeNull();

  // 3. Paste mnemonic, continue
  await pasteMnemonic(freshPage, mnemonic);
  await expect(freshPage.locator("#btn-continue")).toBeEnabled();
  await freshPage.click("#btn-continue");

  // 4. Discovery should land on step-discover and surface the agent we just registered
  await expect(freshPage.locator(".step.active")).toHaveAttribute("id", "step-discover", {
    timeout: 15_000,
  });
  await expect(freshPage.locator("#agent-list")).toContainText(did);
  await expect(freshPage.locator("#agent-list")).toContainText(agentName);

  // Derived signing pub should match the original
  const exposed = await freshPage.evaluate(
    () => (window as unknown as { __SOMA_RESTORE_RESULT__: Record<string, string> }).__SOMA_RESTORE_RESULT__,
  );
  expect(exposed.signingPubB64).toBe(originalPubkey);

  // 5. Recover selected (default: all discovered agents pre-checked)
  await freshPage.click("#btn-recover-selected");
  await expect(freshPage.locator(".step.active")).toHaveAttribute("id", "step-confirm");
  await freshPage.fill("#device-label", "playwright-grid-second-device");
  await freshPage.click("#btn-do-recover");

  await expect(freshPage.locator(".step.active")).toHaveAttribute("id", "step-success", {
    timeout: 15_000,
  });

  // 6. Recovery results: one OK row containing the new bearer
  await expect(freshPage.locator("#success-headline")).toContainText("recovered");
  const okRows = freshPage.locator(".recovery-row.ok");
  await expect(okRows).toHaveCount(1);

  // 7. localStorage shape (canonical snake_case)
  const stored = await freshPage.evaluate(() =>
    JSON.parse(localStorage.getItem("agenttool_project") ?? "{}"),
  );
  expect(stored).toMatchObject({
    did,
    seed_protocol: "soma-seed-v1",
    byo_keys: true,
  });
  expect(stored.api_key).toMatch(/^at_/);
  expect(stored.api_key).not.toBe(originalBearer);

  // 8. New bearer authenticates against the API
  const wakeRes = await freshPage.request.get(`${API_BASE}/v1/wake`, {
    headers: { Authorization: `Bearer ${stored.api_key}` },
  });
  expect(wakeRes.ok()).toBeTruthy();

  // 9. __SOMA_RESTORE_BIND__ window-exposed surface
  const bind = await freshPage.evaluate(
    () => (window as unknown as { __SOMA_RESTORE_BIND__: { bearerAccepted: boolean; results: { ok: boolean }[] } }).__SOMA_RESTORE_BIND__,
  );
  expect(bind.bearerAccepted).toBe(true);
  expect(bind.results.every((r) => r.ok)).toBe(true);

  await freshContext.close();
});

test("manual-DID fallback shows when discovery finds no agents", async ({ page }) => {
  // Oracle mnemonic's signing pub is fixed and unlikely to match any real
  // identity_keys row → discovery returns zero → manual fallback opens.
  await page.goto("/restore-soma.html");
  await pasteMnemonic(page, ORACLE_MNEMONIC);
  await page.click("#btn-continue");

  await expect(page.locator(".step.active")).toHaveAttribute("id", "step-discover", {
    timeout: 15_000,
  });
  await expect(page.locator("#manual-fallback")).toBeVisible();
  await expect(page.locator("#discover-summary")).toContainText("No agents");
});

test("passphrase show/hide toggle still works", async ({ page }) => {
  await page.goto("/restore-soma.html");
  const inp = page.locator("#passphrase-input");
  await expect(inp).toHaveAttribute("type", "password");
  await page.click("#btn-toggle-passphrase");
  await expect(inp).toHaveAttribute("type", "text");
  await page.click("#btn-toggle-passphrase");
  await expect(inp).toHaveAttribute("type", "password");
});
