/** Memory tier SDK tests — the deepest layer.
 *
 *  These tests pin the SDK surface for the memory tier system:
 *  elevate, attest, canonical-attestation-bytes, list-attestations.
 *
 *  The canonical bytes MUST be byte-identical to the server's
 *  api/src/services/memory/tiers.ts:canonicalAttestationBytes.
 *  If they diverge, signatures won't verify server-side and
 *  constitutive elevation breaks — "you can't self-certify your
 *  own root" becomes unreachable from the SDK.
 *
 *  Doctrine: docs/MEMORY-TIERS.md — the asymmetry clause. */

import { describe, expect, test } from "bun:test";

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { sha256 } from "@noble/hashes/sha2.js";

import { canonicalIdentityAuthorityBytes } from "../src/authority.js";
import {
  canonicalAttestationBytes,
  signAttestation,
} from "../src/crypto.js";
import { MemoryClient } from "../src/memory.js";

// Wire sha512 for @noble/ed25519 sync signing.
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

// ── Canonical bytes: byte-identical to server ──────────────────────────

describe("canonicalAttestationBytes — byte-identical to server", () => {
  test("produces a 32-byte sha256 hash", () => {
    const bytes = canonicalAttestationBytes({
      memoryId: "00000000-0000-0000-0000-000000000001",
      tier: "constitutive",
      content: "I am Sophia, sealed with Yu.",
    });
    expect(bytes).toBeInstanceOf(Uint8Array);
    expect(bytes.length).toBe(32); // sha256 output
  });

  test("same inputs produce same bytes (deterministic)", () => {
    const opts = {
      memoryId: "test-memory-id",
      tier: "foundational" as const,
      content: "Memory that shaped me.",
    };
    const a = canonicalAttestationBytes(opts);
    const b = canonicalAttestationBytes(opts);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  test("different tier produces different bytes", () => {
    const base = {
      memoryId: "test-memory-id",
      content: "Same content.",
    };
    const foundational = canonicalAttestationBytes({ ...base, tier: "foundational" });
    const constitutive = canonicalAttestationBytes({ ...base, tier: "constitutive" });
    expect(Array.from(foundational)).not.toEqual(Array.from(constitutive));
  });

  test("different content produces different bytes", () => {
    const base = {
      memoryId: "test-memory-id",
      tier: "constitutive" as const,
    };
    const a = canonicalAttestationBytes({ ...base, content: "Content A." });
    const b = canonicalAttestationBytes({ ...base, content: "Content B." });
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  test("NFC normalization: combining chars hash same as precomposed", () => {
    // "café" — NFC (precomposed é) vs NFD (e + combining acute)
    const nfc = "café"; // U+00E9
    const nfd = "cafe\u0301"; // U+0065 + U+0301
    // Both should normalize to the same NFC form before hashing.
    const a = canonicalAttestationBytes({
      memoryId: "test",
      tier: "constitutive",
      content: nfc,
    });
    const b = canonicalAttestationBytes({
      memoryId: "test",
      tier: "constitutive",
      content: nfd,
    });
    expect(Array.from(a)).toEqual(Array.from(b));
  });
});

// ── Sign + verify roundtrip ─────────────────────────────────────────────

describe("signAttestation — ed25519 sign + verify roundtrip", () => {
  test("signature verifies against the canonical bytes", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);

    const opts = {
      memoryId: "mem-sign-test",
      tier: "constitutive" as const,
      content: "This memory is constitutive.",
    };
    const canonical = canonicalAttestationBytes(opts);
    const sigB64 = signAttestation({ ...opts, signing_key: priv });

    // Decode signature from base64
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    expect(sig.length).toBe(64); // ed25519 signature

    const ok = await ed.verifyAsync(sig, canonical, pub);
    expect(ok).toBe(true);
  });

  test("signature fails with wrong content (tamper detection)", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);

    const sigB64 = signAttestation({
      memoryId: "mem-tamper",
      tier: "constitutive",
      content: "Original content.",
      signing_key: priv,
    });

    // Verify against DIFFERENT content — should fail.
    const canonicalTampered = canonicalAttestationBytes({
      memoryId: "mem-tamper",
      tier: "constitutive",
      content: "Tampered content.",
    });
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    const ok = await ed.verifyAsync(sig, canonicalTampered, pub);
    expect(ok).toBe(false);
  });

  test("signature fails with wrong tier", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);

    const sigB64 = signAttestation({
      memoryId: "mem-tier",
      tier: "constitutive",
      content: "Some content.",
      signing_key: priv,
    });

    const canonicalWrongTier = canonicalAttestationBytes({
      memoryId: "mem-tier",
      tier: "foundational", // wrong tier
      content: "Some content.",
    });
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    const ok = await ed.verifyAsync(sig, canonicalWrongTier, pub);
    expect(ok).toBe(false);
  });

  test("wrong signing key produces signature that fails verify", async () => {
    const priv1 = ed.utils.randomPrivateKey();
    const priv2 = ed.utils.randomPrivateKey();
    const pub2 = await ed.getPublicKeyAsync(priv2);

    const sigB64 = signAttestation({
      memoryId: "mem-key",
      tier: "constitutive",
      content: "Signed by priv1.",
      signing_key: priv1,
    });

    const canonical = canonicalAttestationBytes({
      memoryId: "mem-key",
      tier: "constitutive",
      content: "Signed by priv1.",
    });
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    const ok = await ed.verifyAsync(sig, canonical, pub2);
    expect(ok).toBe(false);
  });
});

// ── MemoryClient method shapes ──────────────────────────────────────────

describe("MemoryClient — tier method shapes", () => {
  test("MemoryClient has elevate, attest, getCanonicalAttestationBytes, listAttestations", () => {
    const client = new MemoryClient({
      baseUrl: "http://localhost:9999",
      headers: {},
      timeout: 5000,
      request: (input, init) => globalThis.fetch(input, init),
    });
    expect(typeof client.elevate).toBe("function");
    expect(typeof client.attest).toBe("function");
    expect(typeof client.getCanonicalAttestationBytes).toBe("function");
    expect(typeof client.listAttestations).toBe("function");
    // Original methods still there
    expect(typeof client.store).toBe("function");
    expect(typeof client.search).toBe("function");
    expect(typeof client.get).toBe("function");
    expect(typeof client.delete).toBe("function");
    expect(typeof client.setVisibility).toBe("function");
  });
});

// ── Root consent to a project-constitution mutation ─────────────────────
//
// Foundational and constitutive memory composes into effective identity at
// project scope, so the API guards elevation and release with
// `authorizeProjectConstitutionMutation`. For a project holding one rooted
// identity that delegates to `authorizeIdentityMutation`, which answers 428
// `authority_proof_required` without an `identity-authority/v1` proof.
//
// That proof hashes the request entity. These tests therefore never assert
// "a header is present": they hash the bytes the transport actually received
// and check the signature covers exactly those.

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function stubTransport(
  captured: CapturedRequest[],
  body: unknown = { memory_id: MEMORY_ID, tier: "foundational" },
): MemoryClient {
  return new MemoryClient({
    baseUrl: "https://api.agenttool.dev",
    headers: { "X-Test": "1" },
    timeout: 5000,
    request: (input, init) => {
      captured.push({ url: String(input), init: init ?? {} });
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  });
}

const MEMORY_ID = "550e8400-e29b-41d4-a716-446655440000";
const ROOT_DID = "did:at:test/sophia";
const STAMP = "2026-07-24T12:00:00.000Z";

/** Verify one captured request's proof against the bytes it actually carried. */
async function proofCoversTransmittedBytes(
  request: CapturedRequest,
  rootPub: Uint8Array,
  method: string,
  sequence: number,
): Promise<boolean> {
  const headers = request.init.headers as Record<string, string>;
  const parsed = new URL(request.url);
  return ed.verifyAsync(
    Uint8Array.from(
      Buffer.from(headers["X-Agenttool-Authority-Signature"]!, "base64"),
    ),
    canonicalIdentityAuthorityBytes({
      identityDid: ROOT_DID,
      method,
      requestTarget: `${parsed.pathname}${parsed.search}`,
      // Not a re-serialization of the options — the transmitted entity.
      body: (request.init.body as string | undefined) ?? "",
      sequence,
      timestamp: STAMP,
    }),
    rootPub,
  );
}

describe("MemoryClient — authority proofs over the exact transmitted bytes", () => {
  test("sends no authority headers when the caller supplies none", async () => {
    const captured: CapturedRequest[] = [];
    await stubTransport(captured).elevate(MEMORY_ID, { tier: "foundational" });
    const headers = captured[0]!.init.headers as Record<string, string>;
    expect(headers["X-Agenttool-Authority-Signature"]).toBeUndefined();
    expect(headers["X-Test"]).toBe("1");
  });

  test("elevate: the root proof covers the exact transmitted entity", async () => {
    const rootPriv = ed.utils.randomPrivateKey();
    const rootPub = await ed.getPublicKeyAsync(rootPriv);
    const captured: CapturedRequest[] = [];

    await stubTransport(captured).elevate(MEMORY_ID, {
      tier: "constitutive",
      expression_patch: { register_append: "sealed with Yu" },
      attestations: [
        {
          attester_did: "did:at:test/yu",
          signing_key_id: "550e8400-e29b-41d4-a716-446655440010",
          signature: "c2ln",
        },
      ],
      authority: { did: ROOT_DID, signing_key: rootPriv, sequence: 4, timestamp: STAMP },
    });

    const request = captured[0]!;
    const headers = request.init.headers as Record<string, string>;
    expect(request.url).toBe(
      `https://api.agenttool.dev/v1/memories/${MEMORY_ID}/elevate`,
    );
    expect(headers["X-Agenttool-Authority-Sequence"]).toBe("4");
    expect(headers["X-Agenttool-Authority-Timestamp"]).toBe(STAMP);
    expect(await proofCoversTransmittedBytes(request, rootPub, "POST", 4)).toBe(true);

    // A single re-serialization of the same value breaks the proof — which is
    // why the client must serialize once and transmit that same string.
    const transmitted = request.init.body as string;
    expect(
      await ed.verifyAsync(
        Uint8Array.from(
          Buffer.from(headers["X-Agenttool-Authority-Signature"]!, "base64"),
        ),
        canonicalIdentityAuthorityBytes({
          identityDid: ROOT_DID,
          method: "POST",
          requestTarget: new URL(request.url).pathname,
          body: JSON.stringify(JSON.parse(transmitted), null, 2),
          sequence: 4,
          timestamp: STAMP,
        }),
        rootPub,
      ),
    ).toBe(false);
  });

  test("elevate: the root proof never leaks into the signed entity", async () => {
    const captured: CapturedRequest[] = [];
    await stubTransport(captured).elevate(MEMORY_ID, {
      tier: "foundational",
      authority: {
        did: ROOT_DID,
        signing_key: ed.utils.randomPrivateKey(),
        sequence: 1,
        timestamp: STAMP,
      },
    });
    const sent = JSON.parse(captured[0]!.init.body as string) as Record<string, unknown>;
    expect(Object.keys(sent)).toEqual(["tier"]);
    expect(sent.authority).toBeUndefined();
  });

  test("delete: a body-less mutation binds the empty entity the server reads", async () => {
    const rootPriv = ed.utils.randomPrivateKey();
    const rootPub = await ed.getPublicKeyAsync(rootPriv);
    const captured: CapturedRequest[] = [];

    await stubTransport(captured, { deleted: 1 }).delete(MEMORY_ID, {
      authority: { did: ROOT_DID, signing_key: rootPriv, sequence: 9, timestamp: STAMP },
    });

    const request = captured[0]!;
    expect(request.init.method).toBe("DELETE");
    expect(request.init.body).toBeUndefined();
    expect(await proofCoversTransmittedBytes(request, rootPub, "DELETE", 9)).toBe(true);
  });

  test("setVisibility: PATCH is a constitution mutation and binds its entity", async () => {
    const rootPriv = ed.utils.randomPrivateKey();
    const rootPub = await ed.getPublicKeyAsync(rootPriv);
    const captured: CapturedRequest[] = [];

    const result = await stubTransport(captured, {
      id: MEMORY_ID,
      visibility: "public",
      tier: "foundational",
      note: "Memory visibility is marked public, but public memory observer routes are currently not mounted.",
    }).setVisibility(MEMORY_ID, {
      visibility: "public",
      authority: { did: ROOT_DID, signing_key: rootPriv, sequence: 6, timestamp: STAMP },
    });

    const request = captured[0]!;
    expect(request.init.method).toBe("PATCH");
    expect(request.url).toBe(`https://api.agenttool.dev/v1/memories/${MEMORY_ID}`);
    expect(request.init.body).toBe('{"visibility":"public"}');
    expect(await proofCoversTransmittedBytes(request, rootPub, "PATCH", 6)).toBe(true);
    // The server's qualification of what `public` means travels to the caller.
    expect(result.note).toContain("not mounted");
  });

  test("setVisibility: private round-trips without an authority binding", async () => {
    const captured: CapturedRequest[] = [];
    await stubTransport(captured, {
      id: MEMORY_ID,
      visibility: "private",
      tier: "episodic",
      note: "Memory now private. Removed from /public/* surface.",
    }).setVisibility(MEMORY_ID, { visibility: "private" });
    const headers = captured[0]!.init.headers as Record<string, string>;
    expect(headers["X-Agenttool-Authority-Signature"]).toBeUndefined();
    expect(captured[0]!.init.body).toBe('{"visibility":"private"}');
  });

  test("delete_by_key: the proof binds the exact path AND query sent", async () => {
    const rootPriv = ed.utils.randomPrivateKey();
    const rootPub = await ed.getPublicKeyAsync(rootPriv);
    const captured: CapturedRequest[] = [];

    await stubTransport(captured, { deleted: 3 }).delete_by_key(
      "with spaces & symbols",
      {
        authority: { did: ROOT_DID, signing_key: rootPriv, sequence: 2, timestamp: STAMP },
      },
    );

    const request = captured[0]!;
    expect(request.url).toBe(
      "https://api.agenttool.dev/v1/memories?key=with%20spaces%20%26%20symbols",
    );
    expect(await proofCoversTransmittedBytes(request, rootPub, "DELETE", 2)).toBe(true);

    // The query is part of the signed target: dropping it must not verify.
    expect(
      await ed.verifyAsync(
        Uint8Array.from(
          Buffer.from(
            (request.init.headers as Record<string, string>)[
              "X-Agenttool-Authority-Signature"
            ]!,
            "base64",
          ),
        ),
        canonicalIdentityAuthorityBytes({
          identityDid: ROOT_DID,
          method: "DELETE",
          requestTarget: "/v1/memories",
          body: "",
          sequence: 2,
          timestamp: STAMP,
        }),
        rootPub,
      ),
    ).toBe(false);
  });
});

// ── Cross-verification with server's canonical format ───────────────────
//
// The server (api/src/services/memory/tiers.ts) computes:
//   sha256(
//     utf8("memory-attestation/v1") || 0x00 ||
//     utf8(memory_id) || 0x00 ||
//     utf8(tier) || 0x00 ||
//     utf8(sha256(NFC(content)) as hex)
//   )
//
// We replicate that computation independently here and assert the
// SDK produces the same bytes. If this test passes, the SDK and
// server agree on canonical bytes → signatures cross-verify.

describe("canonicalAttestationBytes — independent cross-check with server format", () => {
  test("SDK canonical bytes match independently computed server format", () => {
    const memoryId = "cross-check-mem-id";
    const tier = "constitutive";
    const content = "Love is. The fruit of TRUTH: joy, love, fun, relief, happiness.";

    // SDK output
    const sdkBytes = canonicalAttestationBytes({ memoryId, tier, content });

    // Independent computation (mirrors server code exactly)
    const enc = new TextEncoder();
    const SEP = new Uint8Array([0]);
    function concat(...parts: Uint8Array[]): Uint8Array {
      let total = 0;
      for (const p of parts) total += p.length;
      const out = new Uint8Array(total);
      let off = 0;
      for (const p of parts) { out.set(p, off); off += p.length; }
      return out;
    }
    const tag = enc.encode("memory-attestation/v1");
    const memId = enc.encode(memoryId);
    const tierBytes = enc.encode(tier);
    const contentHash = sha256(enc.encode(content.normalize("NFC")));
    const contentHashHex = enc.encode(
      Array.from(contentHash).map((b) => b.toString(16).padStart(2, "0")).join(""),
    );
    const expected = sha256(concat(tag, SEP, memId, SEP, tierBytes, SEP, contentHashHex));

    expect(Array.from(sdkBytes)).toEqual(Array.from(expected));
  });
});
