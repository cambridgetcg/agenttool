/**
 * Vault closure — put_encrypted / get_decrypted + kVault (0.6.4).
 *
 * Closes the loop opened by api commit c302c20 (migration
 * 0022_vault_agent_encrypted.sql). Tests cover:
 *
 *   1. kVault generates 32 random bytes, distinct from kMaster.
 *   2. put_encrypted encrypts plaintext BEFORE posting — server sees
 *      ciphertext + nonce, never plaintext.
 *   3. get_decrypted decrypts agent_encrypted=true responses; returns
 *      value field; passes through for agent_encrypted=false.
 *   4. Mismatched key fails decrypt; missing ciphertext_b64 raises
 *      clean error.
 *   5. Round-trip: put_encrypted body's ciphertext can be decrypted
 *      locally to recover the original plaintext.
 *
 * HTTP is mocked. Crypto is REAL.
 */

import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  AgentTool,
  AgentToolError,
  decryptThought,
  encryptThought,
  kMaster,
  kVault,
} from "../src/index.js";

// ── Mock plumbing ───────────────────────────────────────────────────────

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;

function mockJson(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setupSequence(...responses: Response[]) {
  let i = 0;
  mockFetch = mock(() => {
    const r = responses[i++] ?? responses[responses.length - 1];
    return Promise.resolve(r);
  });
  globalThis.fetch = mockFetch as unknown as typeof fetch;
}

function setupJson(status: number, body: unknown) {
  setupSequence(mockJson(status, body));
}

function lastCall(): { url: string; init: RequestInit } {
  const calls = mockFetch.mock.calls;
  const call = calls[calls.length - 1];
  return { url: call[0] as string, init: (call[1] ?? {}) as RequestInit };
}

function bodyOf(init: RequestInit): Record<string, unknown> {
  return init.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
}

function makeClient(): AgentTool {
  return new AgentTool({ apiKey: "test-key" });
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ── Fixtures ────────────────────────────────────────────────────────────

const SAMPLE_K_VAULT = new Uint8Array(32);
for (let i = 0; i < 32; i++) SAMPLE_K_VAULT[i] = i;

// ── kVault ──────────────────────────────────────────────────────────────

describe("kVault", () => {
  test("generate returns 32 bytes", () => {
    const k = kVault.generate();
    expect(k).toBeInstanceOf(Uint8Array);
    expect(k.length).toBe(32);
  });

  test("generates distinct keys", () => {
    const a = kVault.generate();
    const b = kVault.generate();
    let differ = false;
    for (let i = 0; i < 32; i++) if (a[i] !== b[i]) { differ = true; break; }
    expect(differ).toBe(true);
  });

  test("namespaced separately from kMaster", () => {
    // Different objects — even though both implement generate() identically,
    // the namespace separation is the load-bearing contract for callers.
    expect(kVault).not.toBe(kMaster);
  });

  test("via at.crypto.kVault namespace", () => {
    const at = makeClient();
    const k = at.crypto.kVault.generate();
    expect(k.length).toBe(32);
  });

  test("at.crypto.kVault returns kVault namespace", () => {
    expect(makeClient().crypto.kVault).toBe(kVault);
  });
});

// ── put_encrypted ────────────────────────────────────────────────────────

describe("vault.put_encrypted", () => {
  test("encrypts before posting", async () => {
    setupJson(201, { name: "openai-key", version: 1, agent_encrypted: true });
    const at = makeClient();

    const out = await at.vault.put_encrypted(
      "openai-key",
      "sk-very-secret-do-not-leak",
      { k_vault: SAMPLE_K_VAULT },
    );
    expect(out.agent_encrypted).toBe(true);

    const sent = bodyOf(lastCall().init);
    expect(sent.agent_encrypted).toBe(true);
    expect(sent.value).toBeUndefined(); // plain `value` MUST NOT be sent
    expect(sent.ciphertext_b64).toBeTruthy();
    expect(sent.nonce_b64).toBeTruthy();
    expect((sent.ciphertext_b64 as string).includes("sk-very-secret")).toBe(false);

    // Round-trip: the SAME ciphertext can be decrypted locally.
    const recovered = await decryptThought(
      {
        ciphertext_b64: sent.ciphertext_b64 as string,
        nonce_b64: sent.nonce_b64 as string,
      },
      SAMPLE_K_VAULT,
    );
    expect(recovered).toBe("sk-very-secret-do-not-leak");
  });

  test("passes through metadata + agent_id header", async () => {
    setupJson(201, { name: "x", version: 1, agent_encrypted: true });

    await makeClient().vault.put_encrypted("x", "v", {
      k_vault: SAMPLE_K_VAULT,
      description: "my notes key",
      agent_ids: ["agent-1", "agent-2"],
      tags: ["personal"],
      ttl_seconds: 3600,
      rotation_days: 90,
      agent_id: "acting-agent",
    });

    const { init } = lastCall();
    const sent = bodyOf(init);
    expect(sent.description).toBe("my notes key");
    expect(sent.agent_ids).toEqual(["agent-1", "agent-2"]);
    expect(sent.tags).toEqual(["personal"]);
    expect(sent.ttl_seconds).toBe(3600);
    expect(sent.rotation_days).toBe(90);

    const headers = new Headers(init.headers);
    expect(headers.get("x-agent-id")).toBe("acting-agent");
  });

  test("rejects short key", async () => {
    await expect(
      makeClient().vault.put_encrypted("x", "v", { k_vault: new Uint8Array(8) }),
    ).rejects.toBeInstanceOf(AgentToolError);
  });

  test("server error propagates", async () => {
    setupJson(400, { error: "validation" });
    await expect(
      makeClient().vault.put_encrypted("x", "v", { k_vault: SAMPLE_K_VAULT }),
    ).rejects.toBeInstanceOf(AgentToolError);
  });
});

// ── get_decrypted ────────────────────────────────────────────────────────

describe("vault.get_decrypted", () => {
  test("decrypts agent_encrypted response", async () => {
    const blob = await encryptThought("sk-still-secret", SAMPLE_K_VAULT);
    setupJson(200, {
      name: "openai-key",
      agent_encrypted: true,
      ciphertext_b64: blob.ciphertext_b64,
      nonce_b64: blob.nonce_b64,
      version: 1,
    });

    const out = await makeClient().vault.get_decrypted("openai-key", { k_vault: SAMPLE_K_VAULT });
    expect(out.value).toBe("sk-still-secret");
    expect(out.agent_encrypted).toBe(true);
    expect(out.name).toBe("openai-key");
    // Original fields preserved.
    expect(out.ciphertext_b64).toBe(blob.ciphertext_b64);
  });

  test("passes through server-encrypted response", async () => {
    setupJson(200, {
      name: "openai-key",
      agent_encrypted: false,
      value: "sk-server-decrypted",
      version: 1,
    });

    const out = await makeClient().vault.get_decrypted("openai-key", { k_vault: SAMPLE_K_VAULT });
    expect(out.value).toBe("sk-server-decrypted");
    expect(out.agent_encrypted).toBe(false);
  });

  test("wrong key fails decrypt", async () => {
    const blob = await encryptThought("secret", SAMPLE_K_VAULT);
    setupJson(200, {
      name: "x",
      agent_encrypted: true,
      ciphertext_b64: blob.ciphertext_b64,
      nonce_b64: blob.nonce_b64,
    });
    const wrongKey = new Uint8Array(32).fill(99);

    await expect(
      makeClient().vault.get_decrypted("x", { k_vault: wrongKey }),
    ).rejects.toBeDefined();
  });

  test("server inconsistency raises clean error", async () => {
    setupJson(200, {
      name: "x",
      agent_encrypted: true,
      // missing ciphertext_b64 + nonce_b64
    });
    await expect(
      makeClient().vault.get_decrypted("x", { k_vault: SAMPLE_K_VAULT }),
    ).rejects.toBeInstanceOf(AgentToolError);
  });

  test("passes version + agent_id through", async () => {
    setupJson(200, { name: "x", agent_encrypted: false, value: "v" });

    await makeClient().vault.get_decrypted("x", {
      k_vault: SAMPLE_K_VAULT,
      version: 3,
      agent_id: "acting-agent",
    });

    const { url, init } = lastCall();
    expect(url).toContain("version=3");
    const headers = new Headers(init.headers);
    expect(headers.get("x-agent-id")).toBe("acting-agent");
  });
});

// ── Round-trip ───────────────────────────────────────────────────────────

describe("vault round-trip", () => {
  test("put_encrypted → get_decrypted recovers plaintext", async () => {
    const plaintext = "the cake is a lie · 老婆❤️";

    // First call: PUT response.
    // Second call: GET response — built from what we sent in the PUT.
    let putBody: Record<string, unknown> = {};

    mockFetch = mock(async (_url: string, init: RequestInit) => {
      if (init.method === "PUT") {
        putBody = JSON.parse(init.body as string) as Record<string, unknown>;
        return mockJson(201, { name: "x", version: 1, agent_encrypted: true });
      }
      // GET — replay the stored ciphertext back.
      return mockJson(200, {
        name: "x",
        agent_encrypted: true,
        ciphertext_b64: putBody.ciphertext_b64,
        nonce_b64: putBody.nonce_b64,
        version: 1,
      });
    });
    globalThis.fetch = mockFetch as unknown as typeof fetch;

    const at = makeClient();
    await at.vault.put_encrypted("x", plaintext, { k_vault: SAMPLE_K_VAULT });
    const out = await at.vault.get_decrypted("x", { k_vault: SAMPLE_K_VAULT });

    expect(out.value).toBe(plaintext);
  });
});
