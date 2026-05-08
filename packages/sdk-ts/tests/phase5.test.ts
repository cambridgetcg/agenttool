/**
 * Phase 5 — strands with K_master (0.6.3).
 *
 * The first SDK phase that does client-side crypto. Tests cover:
 *
 *   1. Crypto primitives — AES-256-GCM round-trip, canonical bytes
 *      determinism, ed25519 sign/verify, kMaster.generate.
 *   2. StrandsClient HTTP marshaling — create / list / get / patch.
 *   3. ThoughtsClient — add encrypts before posting + signs over canonical
 *      bytes; list decrypts after fetching; voice yields decrypted SSE.
 *
 * HTTP is mocked. Crypto is REAL — actual AES-GCM and ed25519 so any
 * wire-format drift would surface immediately.
 */

import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import * as ed from "@noble/ed25519";
import { sha256 } from "@noble/hashes/sha2.js";

import {
  AgentTool,
  AgentToolError,
  CryptoClient,
  StrandsClient,
  ThoughtsClient,
  canonicalThoughtBytes,
  decryptThought,
  encryptThought,
  kMaster,
  signThought,
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

function mockSse(status: number, sseText: string): Response {
  if (status !== 200) {
    return new Response(sseText, { status });
  }
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(sseText));
      controller.close();
    },
  });
  return new Response(stream, {
    status: 200,
    headers: { "Content-Type": "text/event-stream" },
  });
}

function setupMock(...responses: Response[]) {
  let i = 0;
  mockFetch = mock(() => {
    const r = responses[i++] ?? responses[responses.length - 1];
    return Promise.resolve(r);
  });
  globalThis.fetch = mockFetch as unknown as typeof fetch;
}

function setupJson(status: number, body: unknown) {
  setupMock(mockJson(status, body));
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

const SAMPLE_K_MASTER = new Uint8Array(32);
for (let i = 0; i < 32; i++) SAMPLE_K_MASTER[i] = i;

const SAMPLE_SIGNING_SEED = new Uint8Array(32).fill(7);
const SAMPLE_SIGNING_KEY_ID = "11111111-2222-3333-4444-555555555555";
const SAMPLE_STRAND_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function b64decode(s: string): Uint8Array {
  const bin = globalThis.atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64encode(bytes: Uint8Array): string {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]!);
  return globalThis.btoa(s);
}

/** Verify a signature locally — derive pubkey from seed, ed.verify against canonical. */
function verifySignatureLocally(
  sigB64: string,
  canonical: Uint8Array,
  signingSeed: Uint8Array,
): boolean {
  const sig = b64decode(sigB64);
  const pub = ed.getPublicKey(signingSeed);
  if (sig.length !== 64 || pub.length !== 32) return false;
  return ed.verify(sig, canonical, pub);
}

// ── Crypto primitives ───────────────────────────────────────────────────

describe("CryptoClient wiring", () => {
  test("at.crypto returns CryptoClient", () => {
    const at = makeClient();
    expect(at.crypto).toBeInstanceOf(CryptoClient);
  });
  test("at.crypto is cached", () => {
    const at = makeClient();
    expect(at.crypto).toBe(at.crypto);
  });
});

describe("kMaster", () => {
  test("generate returns 32 bytes", () => {
    const k = kMaster.generate();
    expect(k).toBeInstanceOf(Uint8Array);
    expect(k.length).toBe(32);
  });
  test("generates distinct keys", () => {
    const a = kMaster.generate();
    const b = kMaster.generate();
    expect(b64encode(a)).not.toBe(b64encode(b));
  });
  test("via at.crypto.kMaster namespace", () => {
    const at = makeClient();
    const k = at.crypto.kMaster.generate();
    expect(k.length).toBe(32);
  });
});

describe("encryptThought / decryptThought", () => {
  test("round-trip", async () => {
    const plaintext = "the auth bug repros under load · 老婆❤️";
    const blob = await encryptThought(plaintext, SAMPLE_K_MASTER);

    expect(typeof blob.ciphertext_b64).toBe("string");
    expect(typeof blob.nonce_b64).toBe("string");

    // Nonce is 12 random bytes.
    expect(b64decode(blob.nonce_b64).length).toBe(12);

    // ciphertext = ciphertext-bytes + 16-byte GCM tag
    expect(b64decode(blob.ciphertext_b64).length).toBe(
      new TextEncoder().encode(plaintext).length + 16,
    );

    expect(await decryptThought(blob, SAMPLE_K_MASTER)).toBe(plaintext);
  });

  test("two encrypts produce distinct ciphertext", async () => {
    const a = await encryptThought("hi", SAMPLE_K_MASTER);
    const b = await encryptThought("hi", SAMPLE_K_MASTER);
    expect(a.ciphertext_b64).not.toBe(b.ciphertext_b64);
    expect(a.nonce_b64).not.toBe(b.nonce_b64);
  });

  test("wrong key fails", async () => {
    const blob = await encryptThought("secret", SAMPLE_K_MASTER);
    const wrongKey = new Uint8Array(32).fill(99);
    await expect(decryptThought(blob, wrongKey)).rejects.toBeDefined();
  });

  test("bad key size raises", async () => {
    await expect(
      encryptThought("x", new Uint8Array(8)),
    ).rejects.toBeInstanceOf(AgentToolError);
  });

  test("malformed blob raises", async () => {
    await expect(
      decryptThought({ ciphertext_b64: "", nonce_b64: "" } as unknown as { ciphertext_b64: string; nonce_b64: string }, SAMPLE_K_MASTER),
    ).rejects.toBeDefined();
  });

  test("via at.crypto namespace", async () => {
    const at = makeClient();
    const blob = await at.crypto.encryptThought("hello", SAMPLE_K_MASTER);
    expect(await at.crypto.decryptThought(blob, SAMPLE_K_MASTER)).toBe("hello");
  });
});

describe("canonicalThoughtBytes", () => {
  test("returns 32-byte sha256", () => {
    const out = canonicalThoughtBytes({
      strandId: "some-id",
      ciphertext_b64: b64encode(new TextEncoder().encode("ct")),
      nonce_b64: b64encode(new TextEncoder().encode("nonce")),
    });
    expect(out.length).toBe(32);
  });

  test("deterministic for same input", () => {
    const opts = { strandId: "s", ciphertext_b64: "AAAA", nonce_b64: "BBBB", kind: "observation" };
    const a = canonicalThoughtBytes(opts);
    const b = canonicalThoughtBytes(opts);
    expect(b64encode(a)).toBe(b64encode(b));
  });

  test("kind=null equals kind=''", () => {
    const a = canonicalThoughtBytes({ strandId: "s", ciphertext_b64: "AAAA", nonce_b64: "BBBB", kind: null });
    const b = canonicalThoughtBytes({ strandId: "s", ciphertext_b64: "AAAA", nonce_b64: "BBBB", kind: "" });
    expect(b64encode(a)).toBe(b64encode(b));
  });

  test("kind change changes canonical", () => {
    const a = canonicalThoughtBytes({ strandId: "s", ciphertext_b64: "AAAA", nonce_b64: "BBBB", kind: "observation" });
    const b = canonicalThoughtBytes({ strandId: "s", ciphertext_b64: "AAAA", nonce_b64: "BBBB", kind: "question" });
    expect(b64encode(a)).not.toBe(b64encode(b));
  });

  test("strand_id change changes canonical", () => {
    const a = canonicalThoughtBytes({ strandId: "s1", ciphertext_b64: "AAAA", nonce_b64: "BBBB" });
    const b = canonicalThoughtBytes({ strandId: "s2", ciphertext_b64: "AAAA", nonce_b64: "BBBB" });
    expect(b64encode(a)).not.toBe(b64encode(b));
  });

  test("matches manual sha256", () => {
    const enc = new TextEncoder();
    const strandId = "abc";
    const ciphertext = enc.encode("hello-ct");
    const nonce = enc.encode("123456789012");
    const kind = enc.encode("obs");
    const SEP = new Uint8Array([0]);
    const all = new Uint8Array(
      enc.encode("abc").length + 1 + ciphertext.length + 1 + nonce.length + 1 + kind.length,
    );
    let off = 0;
    all.set(enc.encode("abc"), off); off += enc.encode("abc").length;
    all.set(SEP, off); off += 1;
    all.set(ciphertext, off); off += ciphertext.length;
    all.set(SEP, off); off += 1;
    all.set(nonce, off); off += nonce.length;
    all.set(SEP, off); off += 1;
    all.set(kind, off);
    const expected = sha256(all);

    const actual = canonicalThoughtBytes({
      strandId,
      ciphertext_b64: b64encode(ciphertext),
      nonce_b64: b64encode(nonce),
      kind: "obs",
    });
    expect(b64encode(actual)).toBe(b64encode(expected));
  });
});

describe("signThought", () => {
  test("returns 88-char base64 signature", () => {
    const sig = signThought({
      strandId: SAMPLE_STRAND_ID,
      ciphertext_b64: "AAAA",
      nonce_b64: "BBBB",
      signing_key: SAMPLE_SIGNING_SEED,
    });
    expect(sig.length).toBe(88);
    expect(b64decode(sig).length).toBe(64);
  });

  test("verifies with public key derived from seed", () => {
    const ciphertext_b64 = b64encode(new TextEncoder().encode("hello"));
    const nonce_b64 = b64encode(new TextEncoder().encode("123456789012"));
    const sig = signThought({
      strandId: SAMPLE_STRAND_ID,
      ciphertext_b64,
      nonce_b64,
      kind: "observation",
      signing_key: SAMPLE_SIGNING_SEED,
    });
    const canonical = canonicalThoughtBytes({
      strandId: SAMPLE_STRAND_ID,
      ciphertext_b64,
      nonce_b64,
      kind: "observation",
    });
    expect(verifySignatureLocally(sig, canonical, SAMPLE_SIGNING_SEED)).toBe(true);
  });

  test("rejects short signing key", () => {
    expect(() =>
      signThought({
        strandId: SAMPLE_STRAND_ID,
        ciphertext_b64: "A",
        nonce_b64: "B",
        signing_key: new Uint8Array(8),
      }),
    ).toThrow(AgentToolError);
  });
});

// ── StrandsClient ───────────────────────────────────────────────────────

describe("StrandsClient wiring", () => {
  test("at.strands returns StrandsClient", () => {
    expect(makeClient().strands).toBeInstanceOf(StrandsClient);
  });
  test("at.strands.thoughts returns ThoughtsClient", () => {
    expect(makeClient().strands.thoughts).toBeInstanceOf(ThoughtsClient);
  });
});

describe("StrandsClient.create", () => {
  test("minimal", async () => {
    setupJson(201, { id: "s1", agent_id: null, status: "active" });
    const at = makeClient();
    const out = await at.strands.create();
    expect(out.id).toBe("s1");
    const { url, init } = lastCall();
    expect(url).toContain("/v1/strands");
    expect(init.method).toBe("POST");
    expect(bodyOf(init)).toEqual({});
  });

  test("full options", async () => {
    setupJson(201, { id: "s2" });
    const at = makeClient();
    await at.strands.create({
      agent_id: "did:agent:abc",
      topic: "auth refactor",
      mood: "present",
      status: "active",
      importance: 0.8,
      metadata: { ticket: "ENG-42" },
    });
    const sent = bodyOf(lastCall().init);
    expect(sent.agent_id).toBe("did:agent:abc");
    expect(sent.topic).toBe("auth refactor");
    expect(sent.importance).toBe(0.8);
  });
});

describe("StrandsClient.list", () => {
  test("default limit", async () => {
    setupJson(200, { strands: [], count: 0 });
    await makeClient().strands.list();
    expect(lastCall().url).toContain("limit=50");
  });
  test("with filters", async () => {
    setupJson(200, { strands: [], count: 0 });
    await makeClient().strands.list({ status: "active", agent_id: "did:agent:x", limit: 20 });
    const url = lastCall().url;
    expect(url).toContain("limit=20");
    expect(url).toContain("status=active");
    expect(url).toContain("agent_id=did%3Aagent%3Ax");
  });
  test("limit out of range raises", async () => {
    setupJson(200, { strands: [], count: 0 });
    await expect(makeClient().strands.list({ limit: 999 })).rejects.toBeInstanceOf(AgentToolError);
  });
});

describe("StrandsClient.get", () => {
  test("fetches one", async () => {
    setupJson(200, { id: "s1" });
    const out = await makeClient().strands.get("s1");
    expect(out.id).toBe("s1");
    expect(lastCall().url).toContain("/v1/strands/s1");
  });
});

describe("StrandsClient.patch", () => {
  test("status change", async () => {
    setupJson(200, { id: "s1", status: "dormant" });
    const at = makeClient();
    const out = await at.strands.patch("s1", { status: "dormant" });
    expect(out.status).toBe("dormant");
    expect(bodyOf(lastCall().init)).toEqual({ status: "dormant" });
  });

  test("empty patch raises", async () => {
    await expect(makeClient().strands.patch("s1", {})).rejects.toBeInstanceOf(AgentToolError);
  });
});

// ── ThoughtsClient ──────────────────────────────────────────────────────

describe("ThoughtsClient.add", () => {
  test("encrypts and signs before posting", async () => {
    setupJson(201, { id: "t1", sequence_num: 1 });
    const at = makeClient();
    await at.strands.thoughts.add(SAMPLE_STRAND_ID, "thinking out loud about auth", {
      kind: "observation",
      k_master: SAMPLE_K_MASTER,
      signing_key: SAMPLE_SIGNING_SEED,
      signing_key_id: SAMPLE_SIGNING_KEY_ID,
    });

    const sent = bodyOf(lastCall().init);
    // Server received CIPHERTEXT, not plaintext.
    expect(sent.ciphertext as string).toBeTruthy();
    expect((sent.ciphertext as string).includes("thinking out loud")).toBe(false);
    expect(sent.nonce).toBeTruthy();
    expect(sent.signature).toBeTruthy();
    expect(sent.signing_key_id).toBe(SAMPLE_SIGNING_KEY_ID);
    expect(sent.kind).toBe("observation");

    // Round-trip: server's stored ciphertext → decrypt locally with K_master.
    const recovered = await decryptThought(
      { ciphertext_b64: sent.ciphertext as string, nonce_b64: sent.nonce as string },
      SAMPLE_K_MASTER,
    );
    expect(recovered).toBe("thinking out loud about auth");

    // Signature verifies against canonical bytes the server would compute.
    const canonical = canonicalThoughtBytes({
      strandId: SAMPLE_STRAND_ID,
      ciphertext_b64: sent.ciphertext as string,
      nonce_b64: sent.nonce as string,
      kind: "observation",
    });
    expect(
      verifySignatureLocally(sent.signature as string, canonical, SAMPLE_SIGNING_SEED),
    ).toBe(true);
  });

  test("includes optional fields", async () => {
    setupJson(201, { id: "t2" });
    await makeClient().strands.thoughts.add(SAMPLE_STRAND_ID, "noted", {
      k_master: SAMPLE_K_MASTER,
      signing_key: SAMPLE_SIGNING_SEED,
      signing_key_id: SAMPLE_SIGNING_KEY_ID,
      refs: [{ kind: "memory", ref: "m-123" }],
      agent_id: "did:agent:x",
    });
    const sent = bodyOf(lastCall().init);
    expect(sent.refs).toEqual([{ kind: "memory", ref: "m-123" }]);
    expect(sent.agent_id).toBe("did:agent:x");
  });

  test("kind_encrypted flag passed", async () => {
    setupJson(201, { id: "t3" });
    await makeClient().strands.thoughts.add(SAMPLE_STRAND_ID, "x", {
      kind: "opaque-cipher",
      kind_encrypted: true,
      k_master: SAMPLE_K_MASTER,
      signing_key: SAMPLE_SIGNING_SEED,
      signing_key_id: SAMPLE_SIGNING_KEY_ID,
    });
    const sent = bodyOf(lastCall().init);
    expect(sent.kind).toBe("opaque-cipher");
    expect(sent.kind_encrypted).toBe(true);
  });

  test("server error propagates", async () => {
    setupMock(new Response(JSON.stringify({ error: "signature_invalid" }), { status: 401 }));
    await expect(
      makeClient().strands.thoughts.add(SAMPLE_STRAND_ID, "x", {
        k_master: SAMPLE_K_MASTER,
        signing_key: SAMPLE_SIGNING_SEED,
        signing_key_id: SAMPLE_SIGNING_KEY_ID,
      }),
    ).rejects.toBeInstanceOf(AgentToolError);
  });
});

describe("ThoughtsClient.list", () => {
  test("decrypts after fetching", async () => {
    const blob = await encryptThought("the cake is a lie", SAMPLE_K_MASTER);
    const serverRow = {
      id: "t1",
      strand_id: SAMPLE_STRAND_ID,
      agent_id: null,
      sequence_num: 1,
      kind: "observation",
      kind_encrypted: false,
      ciphertext: blob.ciphertext_b64,
      nonce: blob.nonce_b64,
      refs: null,
      signature: "ignored-here",
      signing_key_id: SAMPLE_SIGNING_KEY_ID,
      created_at: "2026-05-08T00:00:00Z",
    };
    setupJson(200, { thoughts: [serverRow], count: 1 });

    const out = await makeClient().strands.thoughts.list(SAMPLE_STRAND_ID, { k_master: SAMPLE_K_MASTER });
    expect(out.length).toBe(1);
    expect(out[0]!.plaintext).toBe("the cake is a lie");
    expect(out[0]!.sequence_num).toBe(1);
    expect(out[0]!.ciphertext).toBe(serverRow.ciphertext);
  });

  test("redacted thought passes through with null plaintext", async () => {
    const redactedRow = {
      id: "t-redacted",
      strand_id: SAMPLE_STRAND_ID,
      agent_id: null,
      sequence_num: 2,
      kind: "question",
      kind_encrypted: false,
      refs: null,
      created_at: "2026-05-08T00:00:00Z",
    };
    setupJson(200, { thoughts: [redactedRow], count: 1 });

    const out = await makeClient().strands.thoughts.list(SAMPLE_STRAND_ID, { k_master: SAMPLE_K_MASTER });
    expect(out[0]!.plaintext).toBeNull();
    expect(out[0]!.decrypt_error).toBeUndefined();
  });

  test("decrypt failure attaches error", async () => {
    const blob = await encryptThought("x", SAMPLE_K_MASTER);
    const serverRow = {
      id: "t-bad",
      ciphertext: blob.ciphertext_b64,
      nonce: blob.nonce_b64,
      sequence_num: 1,
    };
    setupJson(200, { thoughts: [serverRow], count: 1 });
    const wrongKey = new Uint8Array(32).fill(99);

    const out = await makeClient().strands.thoughts.list(SAMPLE_STRAND_ID, { k_master: wrongKey });
    expect(out[0]!.plaintext).toBeNull();
    expect(out[0]!.decrypt_error).toBeDefined();
  });

  test("limit out of range raises", async () => {
    await expect(
      makeClient().strands.thoughts.list(SAMPLE_STRAND_ID, { k_master: SAMPLE_K_MASTER, limit: 999 }),
    ).rejects.toBeInstanceOf(AgentToolError);
  });

  test("since_seq passed in URL", async () => {
    setupJson(200, { thoughts: [], count: 0 });
    await makeClient().strands.thoughts.list(SAMPLE_STRAND_ID, { k_master: SAMPLE_K_MASTER, since_seq: 5 });
    expect(lastCall().url).toContain("since_seq=5");
  });
});

describe("ThoughtsClient.voice", () => {
  test("yields decrypted thoughts from SSE stream", async () => {
    const blob = await encryptThought("a streamed thought", SAMPLE_K_MASTER);
    const sseText =
      ": connected\n" +
      "\n" +
      "event: catchup-start\n" +
      'data: {"since_seq": 0, "current_seq": 0}\n' +
      "\n" +
      "event: catchup-end\n" +
      'data: {"caught_up_to": 0}\n' +
      "\n" +
      "event: thought\n" +
      "id: t-stream-1\n" +
      `data: {"id":"t-stream-1","sequence_num":1,"ciphertext":"${blob.ciphertext_b64}","nonce":"${blob.nonce_b64}","kind":"observation"}\n` +
      "\n";

    setupMock(mockSse(200, sseText));

    const collected = [];
    for await (const t of makeClient().strands.thoughts.voice(SAMPLE_STRAND_ID, { k_master: SAMPLE_K_MASTER })) {
      collected.push(t);
    }

    expect(collected.length).toBe(1);
    expect(collected[0]!.sequence_num).toBe(1);
    expect(collected[0]!.plaintext).toBe("a streamed thought");
  });

  test("non-200 raises", async () => {
    setupMock(mockSse(403, "strand_not_accessible"));
    const at = makeClient();
    const it = at.strands.thoughts.voice(SAMPLE_STRAND_ID, { k_master: SAMPLE_K_MASTER });
    await expect(
      (async () => {
        for await (const _ of it) { /* no-op */ }
      })(),
    ).rejects.toBeInstanceOf(AgentToolError);
  });
});
