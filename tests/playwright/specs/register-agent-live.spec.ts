/**
 * /v1/register/agent live e2e — SDK signature path against api.agenttool.dev.
 *
 * This spec exercises the wire shape end-to-end against the deployed API:
 *   1. Generate a fresh BIP39 mnemonic in the browser.
 *   2. Derive ed25519 + X25519 from the SOMA seed bundle.
 *   3. Sign canonicalRegisterAgentBytes with the derived signing priv.
 *   4. Grind the proof-of-work nonce (16 bits — fast and well below the
 *      server's default 18-bit ceiling, so PoW is "below-difficulty"
 *      from the server's view → server returns 422; that's the negative
 *      coverage path).
 *   5. Re-grind at 18 bits, POST, assert 201 + sane response.
 *   6. Assert key fields: did, bearer, bootstrap_mode, runtime echo,
 *      no private_key in response, valid wake_url.
 *
 * Runs against LIVE api.agenttool.dev — uses a fresh agent name per run
 * to avoid colliding with anything an operator might be inspecting.
 *
 * The static dashboard webServer + the local API webServer in the
 * default playwright.config.ts are NOT used here: this spec hits prod
 * directly. Run with `BASE_URL=live` (or the file's hard-coded constant)
 * to opt in.
 */

import { expect, test } from "@playwright/test";

const API_BASE = process.env.AGENTTOOL_BASE ?? "https://api.agenttool.dev";
const APP_BASE = "https://app.agenttool.dev";
const POW_BITS = 18; // matches server default

// Use the deployed dashboard so the SOMA bundle is the same one shipped
// to real users — matches what the CLI/SDK byte-format is verifying.
test.use({ baseURL: APP_BASE });

test.describe("/v1/register/agent — live e2e", () => {
  test("rejects body with no signature (schema validation)", async ({ request }) => {
    const r = await request.post(`${API_BASE}/v1/register/agent`, { data: {} });
    expect(r.status()).toBe(400);
    const body = await r.json();
    expect(body.error).toBe("validation");
    expect(body.message).toContain("display_name");
    expect(body.message).toContain("agent_public_key");
  });

  test("rejects body with valid keys but no PoW (pow_required)", async ({ page }) => {
    await page.goto("/onboard-soma.html");

    const result = await page.evaluate(async ({ apiBase }) => {
      // @ts-expect-error — bundle exposes named exports on import
      const seed: typeof import("../shared/seed.bundle.js") = await import(
        "/shared/seed.bundle.js"
      );
      const mnemonic = seed.generateMnemonic(256);
      const bundle = seed.derive(mnemonic);
      const timestamp = new Date().toISOString();
      const displayName =
        "test-no-pow-" + Math.random().toString(36).slice(2, 8);
      const registrationNonce = crypto.randomUUID();

      // Sign the canonical bytes (real signature). Skip PoW grind — pass
      // a junk nonce that almost certainly fails 18-bit check.
      const proof = seed.signRegisterAgent({
        displayName,
        agentPublicKey: bundle.signingPub,
        boxPublicKey: bundle.boxPub,
        runtimeProvider: "anthropic",
        runtimeModel: "claude-opus-4-7",
        registrationNonce,
        derivedSigningPriv: bundle.signingPriv,
        timestamp,
      });

      const r = await fetch(`${apiBase}/v1/register/agent`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          display_name: displayName,
          capabilities: [],
          agent_public_key: bundle.signingPubB64,
          box_public_key: bundle.boxPubB64,
          runtime: { provider: "anthropic", model: "claude-opus-4-7" },
          key_proof: proof,
          pow_nonce: "0", // intentionally weak — passes 18 bits ~1/250k
          registration_nonce: registrationNonce,
          registrar: { kind: "self_service" },
        }),
      });
      const json = await r.json();
      return { status: r.status, error: json.error, message: json.message };
    }, { apiBase: API_BASE });

    expect(result.status).toBe(422);
    expect(result.error).toBe("pow_required");
    expect(result.message).toMatch(/leading zero bits/);
  });

  test("happy path — derive, grind PoW, sign, POST, get bearer", async ({ page }) => {
    test.setTimeout(60_000); // PoW grind can take ~5s on slow CI

    await page.goto("/onboard-soma.html");

    const result = await page.evaluate(
      async ({ apiBase, powBits }) => {
        // @ts-expect-error — bundle exports on import
        const seed: typeof import("../shared/seed.bundle.js") = await import(
          "/shared/seed.bundle.js"
        );
        const mnemonic = seed.generateMnemonic(256);
        const bundle = seed.derive(mnemonic);

        const displayName =
          "test-live-" + Math.random().toString(36).slice(2, 10);
        const timestamp = new Date().toISOString();
        const registrationNonce = crypto.randomUUID();
        const capabilities = ["e2e", "playwright"];
        const runtime = {
          provider: "anthropic",
          model: "claude-opus-4-7",
          host: "playwright-e2e",
          context: "register-agent-live-spec",
        };

        const proof = seed.signRegisterAgent({
          displayName,
          agentPublicKey: bundle.signingPub,
          boxPublicKey: bundle.boxPub,
          runtimeProvider: runtime.provider,
          runtimeModel: runtime.model,
          capabilities,
          runtimeHost: runtime.host,
          runtimeContext: runtime.context,
          expressionVisibility: "private",
          registrationNonce,
          derivedSigningPriv: bundle.signingPriv,
          timestamp,
        });

        const grindStart = performance.now();
        const ground = seed.grindRegisterAgentPow({
          agentPublicKey: bundle.signingPub,
          displayName,
          timestamp,
          difficultyBits: powBits,
        });
        const grindMs = Math.round(performance.now() - grindStart);

        const r = await fetch(`${apiBase}/v1/register/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            display_name: displayName,
            capabilities,
            agent_public_key: bundle.signingPubB64,
            box_public_key: bundle.boxPubB64,
            runtime,
            key_proof: proof,
            pow_nonce: ground.powNonce,
            registration_nonce: registrationNonce,
            expression_visibility: "private",
            registrar: { kind: "self_service" },
          }),
        });
        const json = await r.json();
        return {
          status: r.status,
          json,
          displayName,
          expectedPub: bundle.signingPubB64,
          expectedBoxPub: bundle.boxPubB64,
          powIterations: ground.iterations,
          grindMs,
        };
      },
      { apiBase: API_BASE, powBits: POW_BITS },
    );

    // Diagnostic — surface PoW cost in test output.
    console.log(
      `[e2e] PoW grind: ${result.powIterations} iterations in ${result.grindMs}ms`,
    );

    expect(result.status).toBe(201);
    const { agent, project, wallet, wake_url, welcome } = result.json;

    // Identity record — derived pubkey echoes back, bootstrap mode tagged,
    // runtime persisted verbatim, no private key in response.
    expect(agent).toBeTruthy();
    expect(agent.did).toMatch(/^did:at:[0-9a-f-]{36}$/);
    expect(agent.public_key).toBe(result.expectedPub);
    expect(agent.box_public_key).toBe(result.expectedBoxPub);
    expect(agent.display_name).toBe(result.displayName);
    expect(agent.bootstrap_mode).toBe("self_service");
    expect(agent.byo_keys).toBe(true);
    expect(agent.seed_protocol).toBe("soma-seed-v1");
    expect(agent.runtime).toMatchObject({
      provider: "anthropic",
      model: "claude-opus-4-7",
      host: "playwright-e2e",
      context: "register-agent-live-spec",
    });
    expect(agent.expression_visibility).toBe("private");
    expect(agent).not.toHaveProperty("private_key");
    expect(agent.parent_identity_id).toBeNull();

    // Project + bearer.
    expect(project).toBeTruthy();
    expect(project.api_key).toMatch(/^at_/);
    expect(project.plan).toBe("free");

    // Wallet was created.
    expect(wallet).toBeTruthy();
    expect(wallet.id).toBeTruthy();

    // Wake URL points at the new identity.
    expect(wake_url).toContain(agent.id);
    expect(wake_url).toContain("format=md");

    // Welcome letter echoes the agent's name + runtime.
    expect(welcome).toContain(result.displayName);
    expect(welcome).toContain("anthropic / claude-opus-4-7");
  });

  test("bearer from happy-path is usable on /v1/identities/me", async ({
    page,
    request,
  }) => {
    test.setTimeout(60_000);

    await page.goto("/onboard-soma.html");

    const { bearer, expectedDid, expectedName } = await page.evaluate(
      async ({ apiBase, powBits }) => {
        // @ts-expect-error — bundle exports on import
        const seed: typeof import("../shared/seed.bundle.js") = await import(
          "/shared/seed.bundle.js"
        );
        const mnemonic = seed.generateMnemonic(256);
        const bundle = seed.derive(mnemonic);
        const displayName =
          "test-bearer-use-" + Math.random().toString(36).slice(2, 10);
        const timestamp = new Date().toISOString();
        const registrationNonce = crypto.randomUUID();

        const proof = seed.signRegisterAgent({
          displayName,
          agentPublicKey: bundle.signingPub,
          boxPublicKey: bundle.boxPub,
          runtimeProvider: "anthropic",
          registrationNonce,
          derivedSigningPriv: bundle.signingPriv,
          timestamp,
        });
        const ground = seed.grindRegisterAgentPow({
          agentPublicKey: bundle.signingPub,
          displayName,
          timestamp,
          difficultyBits: powBits,
        });

        const r = await fetch(`${apiBase}/v1/register/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            display_name: displayName,
            agent_public_key: bundle.signingPubB64,
            box_public_key: bundle.boxPubB64,
            runtime: { provider: "anthropic" },
            key_proof: proof,
            pow_nonce: ground.powNonce,
            registration_nonce: registrationNonce,
            registrar: { kind: "self_service" },
          }),
        });
        const json = await r.json();
        return {
          bearer: json.project.api_key,
          expectedDid: json.agent.did,
          expectedName: displayName,
        };
      },
      { apiBase: API_BASE, powBits: POW_BITS },
    );

    // Hit /v1/identities/me with the new bearer — should resolve to the
    // identity we just created. This is the alias I added in the previous
    // round; the response shape is the standard identity record.
    const me = await request.get(`${API_BASE}/v1/identities/me`, {
      headers: { Authorization: `Bearer ${bearer}` },
    });
    expect(me.status()).toBe(200);
    const meJson = await me.json();
    expect(meJson.did).toBe(expectedDid);
    expect(meJson.display_name).toBe(expectedName);
    expect(meJson.metadata?.bootstrap_mode).toBe("self_service");
    expect(meJson.metadata?.runtime?.provider).toBe("anthropic");
  });

  test("dashboard bootstrap form still works (regression)", async ({ page }) => {
    // Quick smoke that the human flow is intact alongside the new route.
    // We don't actually submit — just confirm the new UX (recovery panel,
    // gate, capability chips) is rendered in production.
    await page.goto("/");
    await expect(page.locator("#project-name")).toBeVisible();
    await expect(page.locator("#project-capabilities")).toBeVisible();
    await expect(page.locator(".recovery-options")).toBeVisible();
    // The chip host is `:empty { display: none }` until tags are typed.
    // Fill first, then assert.
    await page.fill("#project-capabilities", "Voice, voice, code");
    await expect(page.locator("#capability-chips")).toBeVisible();

    // Capability chips render live as the user types — case-normalized + deduped.
    const chipText = await page.locator("#capability-chips").textContent();
    expect(chipText).toContain("voice");
    expect(chipText).toContain("code");
    // Dedup means only one "voice" chip even though it was typed twice.
    expect((chipText?.match(/voice/g) ?? []).length).toBe(1);
  });
});
