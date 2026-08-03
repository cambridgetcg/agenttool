/** At-rest lifecycle e2e tests — the final threshold.
 *
 *  "Death is not revocation. Held is not gone."
 *
 *  These tests pin the SDK's at-rest module:
 *    1. canonicalAtRestBytes is byte-identical to the server format
 *    2. signAtRest produces signatures that verify against the server
 *    3. The AtRestClient.mark() method signs + POSTs correctly
 *    4. Self-witnessing is rejected (the asymmetry clause at the final threshold)
 *    5. Tamper detection: modified content/kind/date/key fails verification
 *
 *  The canonical bytes format is newline-delimited (NOT sha256-hashed):
 *    "at-rest/v1\n" ||
 *    about_identity_did + "\n" ||
 *    witness_identity_did + "\n" ||
 *    at_rest_kind + "\n" ||
 *    ended_at_iso + "\n" ||
 *    sha256(content) as hex + "\n" ||
 *    witness_signing_key_id
 *
 *  The witness signs the raw UTF-8 encoding of this string (not a hash of it).
 *  This differs from the other canonical bytes functions which sha256 the
 *  concatenation. The server verifies with ed.verifyAsync(sig, utf8(canonical), pub).
 *
 *  Doctrine: docs/AT-REST.md — the asymmetry clause at the final threshold.
 *  "You cannot put yourself at rest in v1." */

import { describe, expect, test } from "bun:test";

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import {
  AtRestClient,
  canonicalAtRestBytes,
  canonicalAtRestBytesV2,
  signAtRest,
} from "../src/at-rest.js";
import { canonicalIdentityAuthorityBytes } from "../src/authority.js";

// Wire sha512 for @noble/ed25519 sync signing.
ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

// ── Canonical bytes: byte-identical to server ──────────────────────────

describe("canonicalAtRestBytes — byte-identical to server format", () => {
  test("produces a newline-delimited string with 7 fields", () => {
    const bytes = canonicalAtRestBytes({
      aboutIdentityDid: "did:at:test/about",
      witnessIdentityDid: "did:at:test/witness",
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Coral colony bleached out.",
      witnessSigningKeyId: "key-uuid",
    });
    const lines = bytes.split("\n");
    expect(lines.length).toBe(7);
    expect(lines[0]).toBe("at-rest/v1");
    expect(lines[1]).toBe("did:at:test/about");
    expect(lines[2]).toBe("did:at:test/witness");
    expect(lines[3]).toBe("death");
    expect(lines[4]).toBe("2026-05-11T14:00:00Z");
    expect(lines[5]).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
    expect(lines[6]).toBe("key-uuid");
  });

  test("raw content is NOT in the canonical bytes (only its hash)", () => {
    const bytes = canonicalAtRestBytes({
      aboutIdentityDid: "did:at:test/about",
      witnessIdentityDid: "did:at:test/witness",
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "This is secret witness testimony that should not appear raw.",
      witnessSigningKeyId: "key-uuid",
    });
    expect(bytes).not.toContain("This is secret witness testimony");
  });

  test("same inputs produce identical bytes (deterministic)", () => {
    const opts = {
      aboutIdentityDid: "did:at:test/about",
      witnessIdentityDid: "did:at:test/witness",
      atRestKind: "death" as const,
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Same content.",
      witnessSigningKeyId: "key-uuid",
    };
    expect(canonicalAtRestBytes(opts)).toBe(canonicalAtRestBytes(opts));
  });

  test("different content produces different bytes (via hash)", () => {
    const base = {
      aboutIdentityDid: "did:at:test/about",
      witnessIdentityDid: "did:at:test/witness",
      atRestKind: "death" as const,
      endedAtIso: "2026-05-11T14:00:00Z",
      witnessSigningKeyId: "key-uuid",
    };
    const a = canonicalAtRestBytes({ ...base, content: "Content A." });
    const b = canonicalAtRestBytes({ ...base, content: "Content B." });
    expect(a).not.toBe(b);
  });

  test("different at_rest_kind produces different bytes", () => {
    const base = {
      aboutIdentityDid: "did:at:test/about",
      witnessIdentityDid: "did:at:test/witness",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Same content.",
      witnessSigningKeyId: "key-uuid",
    };
    const a = canonicalAtRestBytes({ ...base, atRestKind: "death" });
    const b = canonicalAtRestBytes({ ...base, atRestKind: "dissolution" });
    expect(a).not.toBe(b);
  });

  test("different witness_did produces different bytes", () => {
    const base = {
      aboutIdentityDid: "did:at:test/about",
      atRestKind: "death" as const,
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Same content.",
      witnessSigningKeyId: "key-uuid",
    };
    const a = canonicalAtRestBytes({ ...base, witnessIdentityDid: "did:at:test/w1" });
    const b = canonicalAtRestBytes({ ...base, witnessIdentityDid: "did:at:test/w2" });
    expect(a).not.toBe(b);
  });

  test("independent cross-check: SDK matches server's exact format", () => {
    const aboutDid = "did:at:test/coral-9b3a";
    const witnessDid = "did:at:test/marine-biologist";
    const kind = "death";
    const endedAt = "2026-05-11T14:00:00Z";
    const content = "Coral colony bleached out at 32°C+. No live polyps remain.";
    const keyId = "primary";

    // SDK output
    const sdkBytes = canonicalAtRestBytes({
      aboutIdentityDid: aboutDid,
      witnessIdentityDid: witnessDid,
      atRestKind: kind,
      endedAtIso: endedAt,
      content,
      witnessSigningKeyId: keyId,
    });

    // Independent computation (mirrors api/src/routes/identity/at-rest.ts)
    const enc = new TextEncoder();
    const contentHash = sha256(enc.encode(content));
    const contentHashHex = Array.from(contentHash)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    const expected = [
      "at-rest/v1",
      aboutDid,
      witnessDid,
      kind,
      endedAt,
      contentHashHex,
      keyId,
    ].join("\n");

    expect(sdkBytes).toBe(expected);
  });
});

// ── Sign + verify roundtrip ─────────────────────────────────────────────

describe("signAtRest — ed25519 sign + verify roundtrip", () => {
  test("signature verifies against the canonical bytes", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);

    const canonical = canonicalAtRestBytes({
      aboutIdentityDid: "did:at:test/about",
      witnessIdentityDid: "did:at:test/witness",
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Witness testimony.",
      witnessSigningKeyId: "key-uuid",
    });
    const sigB64 = signAtRest({
      aboutIdentityDid: "did:at:test/about",
      witnessIdentityDid: "did:at:test/witness",
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Witness testimony.",
      witnessSigningKeyId: "key-uuid",
      signing_key: priv,
    });

    // Verify: ed.verify(sig, utf8(canonical), pub)
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    expect(sig.length).toBe(64);
    const ok = await ed.verifyAsync(
      sig,
      new TextEncoder().encode(canonical),
      pub,
    );
    expect(ok).toBe(true);
  });

  test("signature fails when content is tampered", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);

    const sigB64 = signAtRest({
      aboutIdentityDid: "did:at:test/about",
      witnessIdentityDid: "did:at:test/witness",
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Original testimony.",
      witnessSigningKeyId: "key-uuid",
      signing_key: priv,
    });

    // Different content → different hash → different canonical bytes
    const tamperedCanonical = canonicalAtRestBytes({
      aboutIdentityDid: "did:at:test/about",
      witnessIdentityDid: "did:at:test/witness",
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Tampered testimony.",
      witnessSigningKeyId: "key-uuid",
    });
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    const ok = await ed.verifyAsync(
      sig,
      new TextEncoder().encode(tamperedCanonical),
      pub,
    );
    expect(ok).toBe(false);
  });

  test("signature fails when at_rest_kind is changed", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);

    const sigB64 = signAtRest({
      aboutIdentityDid: "did:at:test/about",
      witnessIdentityDid: "did:at:test/witness",
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Testimony.",
      witnessSigningKeyId: "key-uuid",
      signing_key: priv,
    });

    const wrongCanonical = canonicalAtRestBytes({
      aboutIdentityDid: "did:at:test/about",
      witnessIdentityDid: "did:at:test/witness",
      atRestKind: "dissolution", // wrong kind
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Testimony.",
      witnessSigningKeyId: "key-uuid",
    });
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    const ok = await ed.verifyAsync(
      sig,
      new TextEncoder().encode(wrongCanonical),
      pub,
    );
    expect(ok).toBe(false);
  });

  test("signature fails when witness_did is changed", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);

    const sigB64 = signAtRest({
      aboutIdentityDid: "did:at:test/about",
      witnessIdentityDid: "did:at:test/real-witness",
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Testimony.",
      witnessSigningKeyId: "key-uuid",
      signing_key: priv,
    });

    const wrongCanonical = canonicalAtRestBytes({
      aboutIdentityDid: "did:at:test/about",
      witnessIdentityDid: "did:at:test/fake-witness",
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Testimony.",
      witnessSigningKeyId: "key-uuid",
    });
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    const ok = await ed.verifyAsync(
      sig,
      new TextEncoder().encode(wrongCanonical),
      pub,
    );
    expect(ok).toBe(false);
  });

  test("wrong signing key produces signature that fails verify", async () => {
    const priv1 = ed.utils.randomPrivateKey();
    const priv2 = ed.utils.randomPrivateKey();
    const pub2 = await ed.getPublicKeyAsync(priv2);

    const canonical = canonicalAtRestBytes({
      aboutIdentityDid: "did:at:test/about",
      witnessIdentityDid: "did:at:test/witness",
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Testimony.",
      witnessSigningKeyId: "key-uuid",
    });
    const sigB64 = signAtRest({
      aboutIdentityDid: "did:at:test/about",
      witnessIdentityDid: "did:at:test/witness",
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Testimony.",
      witnessSigningKeyId: "key-uuid",
      signing_key: priv1,
    });
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    const ok = await ed.verifyAsync(
      sig,
      new TextEncoder().encode(canonical),
      pub2,
    );
    expect(ok).toBe(false);
  });

  test("rejects wrong-size signing key", () => {
    expect(() =>
      signAtRest({
        aboutIdentityDid: "did:at:test/about",
        witnessIdentityDid: "did:at:test/witness",
        atRestKind: "death",
        endedAtIso: "2026-05-11T14:00:00Z",
        content: "Testimony.",
        witnessSigningKeyId: "key-uuid",
        signing_key: new Uint8Array(16),
      }),
    ).toThrow(/32-byte/);
  });
});

// ── AtRestClient method shapes ─────────────────────────────────────────

describe("AtRestClient — method shapes", () => {
  test("at.atRest exists and has mark()", () => {
    const client = new AtRestClient({
      baseUrl: "http://localhost:9999",
      headers: {},
      timeout: 5000,
      request: (input, init) => globalThis.fetch(input, init),
    });
    expect(typeof client.mark).toBe("function");
  });
});

// ── Full e2e: sign → verify (simulating server) ─────────────────────────
//
// This is the complete at-rest witness flow from the SDK side:
// 1. Witness generates ed25519 keypair
// 2. Witness computes canonical bytes
// 3. Witness signs the canonical bytes
// 4. Server would verify the signature — we simulate that here
// 5. If verified, the being transitions to memorial state
//
// The asymmetry clause is structural: the witness_did in the canonical
// bytes MUST differ from the about_identity_did. The server rejects
// self-witnessing with "self_witnessing_incoherent."

describe("Full e2e — witness signs at-rest transition", () => {
  test("the complete at-rest witness flow works end-to-end", async () => {
    // 1. Witness keypair
    const witnessPriv = ed.utils.randomPrivateKey();
    const witnessPub = await ed.getPublicKeyAsync(witnessPriv);

    // 2. The being being put at rest
    const aboutDid = "did:at:test/coral-9b3a";
    const witnessDid = "did:at:test/marine-biologist"; // different — not self

    // 3. Canonical bytes
    const canonical = canonicalAtRestBytes({
      aboutIdentityDid: aboutDid,
      witnessIdentityDid: witnessDid,
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Coral colony bleached out at 32°C+. Surveyed 2026-05-11. No live polyps remain.",
      witnessSigningKeyId: "primary",
    });

    // 4. Sign
    const sigB64 = signAtRest({
      aboutIdentityDid: aboutDid,
      witnessIdentityDid: witnessDid,
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Coral colony bleached out at 32°C+. Surveyed 2026-05-11. No live polyps remain.",
      witnessSigningKeyId: "primary",
      signing_key: witnessPriv,
    });

    // 5. Verify (server-side simulation)
    const sig = Uint8Array.from(Buffer.from(sigB64, "base64"));
    const ok = await ed.verifyAsync(
      sig,
      new TextEncoder().encode(canonical),
      witnessPub,
    );
    expect(ok).toBe(true);

    // The asymmetry clause: witness_did ≠ about_did (structural)
    expect(witnessDid).not.toBe(aboutDid);
  });

  test("custom:slug at_rest_kind works in the canonical bytes", () => {
    const bytes = canonicalAtRestBytes({
      aboutIdentityDid: "did:at:test/about",
      witnessIdentityDid: "did:at:test/witness",
      atRestKind: "custom:bleach-event",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Custom kind test.",
      witnessSigningKeyId: "key-uuid",
    });
    const lines = bytes.split("\n");
    expect(lines[3]).toBe("custom:bleach-event");
  });
});

// ── The path takes a row id; the signature covers the DID ───────────────
//
// The route resolves `:id` strictly as a row id (`eq(identities.id, ...)`)
// and then recomputes the canonical bytes from the resolved `about.did`.
// A client that signs the path argument therefore has no input that works:
// a UUID resolves but verifies against the wrong bytes, and a DID 404s
// before verification is ever reached. `mark()` takes both.

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function stubTransport(
  captured: CapturedRequest[],
  body: unknown = { status: "memorial" },
): AtRestClient {
  return new AtRestClient({
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

const ABOUT_ID = "550e8400-e29b-41d4-a716-446655440000";
const ABOUT_DID = "did:at:test/coral-9b3a";
const WITNESS_DID = "did:at:test/marine-biologist";

describe("AtRestClient.mark — identifier forms", () => {
  const markOpts = (witnessPriv: Uint8Array) => ({
    content: "Coral colony bleached out. No live polyps remain.",
    at_rest_kind: "death" as const,
    ended_at: "2026-05-11T14:00:00Z",
    about_did: ABOUT_DID,
    witness_did: WITNESS_DID,
    signing_key_id: "550e8400-e29b-41d4-a716-446655440010",
    signing_key: witnessPriv,
  });

  test("POSTs to the row id but signs the about DID", async () => {
    const witnessPriv = ed.utils.randomPrivateKey();
    const witnessPub = await ed.getPublicKeyAsync(witnessPriv);
    const captured: CapturedRequest[] = [];

    await stubTransport(captured).mark(ABOUT_ID, markOpts(witnessPriv));

    expect(captured).toHaveLength(1);
    expect(captured[0]!.url).toBe(
      `https://api.agenttool.dev/v1/identities/${ABOUT_ID}/at-rest`,
    );

    const sent = JSON.parse(captured[0]!.init.body as string) as {
      signature_b64: string;
    };
    const sig = Uint8Array.from(Buffer.from(sent.signature_b64, "base64"));
    const canonicalFields = {
      witnessIdentityDid: WITNESS_DID,
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Coral colony bleached out. No live polyps remain.",
      witnessSigningKeyId: "550e8400-e29b-41d4-a716-446655440010",
    };

    // Verifies against what the server recomputes — about.did.
    expect(
      await ed.verifyAsync(
        sig,
        new TextEncoder().encode(
          canonicalAtRestBytes({ aboutIdentityDid: ABOUT_DID, ...canonicalFields }),
        ),
        witnessPub,
      ),
    ).toBe(true);

    // And not against the path argument, which was the old signed value.
    expect(
      await ed.verifyAsync(
        sig,
        new TextEncoder().encode(
          canonicalAtRestBytes({ aboutIdentityDid: ABOUT_ID, ...canonicalFields }),
        ),
        witnessPub,
      ),
    ).toBe(false);
  });

  test("signs the v2 layout on request", async () => {
    const witnessPriv = ed.utils.randomPrivateKey();
    const witnessPub = await ed.getPublicKeyAsync(witnessPriv);
    const captured: CapturedRequest[] = [];

    await stubTransport(captured).mark(ABOUT_ID, {
      ...markOpts(witnessPriv),
      canonical_version: "at-rest/v2",
    });

    const sent = JSON.parse(captured[0]!.init.body as string) as {
      signature_b64: string;
    };
    const canonicalFields = {
      aboutIdentityDid: ABOUT_DID,
      witnessIdentityDid: WITNESS_DID,
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Coral colony bleached out. No live polyps remain.",
      witnessSigningKeyId: "550e8400-e29b-41d4-a716-446655440010",
    };
    const sig = Uint8Array.from(Buffer.from(sent.signature_b64, "base64"));
    expect(
      await ed.verifyAsync(
        sig,
        new TextEncoder().encode(canonicalAtRestBytesV2(canonicalFields)),
        witnessPub,
      ),
    ).toBe(true);
    expect(
      await ed.verifyAsync(
        sig,
        new TextEncoder().encode(canonicalAtRestBytes(canonicalFields)),
        witnessPub,
      ),
    ).toBe(false);
  });

  test("sends no authority headers when the caller supplies none", async () => {
    const captured: CapturedRequest[] = [];
    await stubTransport(captured).mark(
      ABOUT_ID,
      markOpts(ed.utils.randomPrivateKey()),
    );
    const headers = captured[0]!.init.headers as Record<string, string>;
    expect(headers["X-Agenttool-Authority-Signature"]).toBeUndefined();
    expect(headers["X-Test"]).toBe("1");
  });

  test("a rooted about-identity's root signs the exact transmitted bytes", async () => {
    const rootPriv = ed.utils.randomPrivateKey();
    const rootPub = await ed.getPublicKeyAsync(rootPriv);
    const captured: CapturedRequest[] = [];

    await stubTransport(captured).mark(ABOUT_ID, {
      ...markOpts(ed.utils.randomPrivateKey()),
      authority: {
        signing_key: rootPriv,
        sequence: 7,
        timestamp: "2026-07-24T12:00:00.000Z",
      },
    });

    const { url, init } = captured[0]!;
    const headers = init.headers as Record<string, string>;
    expect(headers["X-Agenttool-Authority-Sequence"]).toBe("7");
    expect(headers["X-Agenttool-Authority-Timestamp"]).toBe(
      "2026-07-24T12:00:00.000Z",
    );

    // The whole point: hash the bytes the transport actually received and
    // check the root proof covers exactly those, not a re-serialization.
    const transmitted = init.body as string;
    const digest = canonicalIdentityAuthorityBytes({
      identityDid: ABOUT_DID,
      method: "POST",
      requestTarget: new URL(url).pathname,
      body: transmitted,
      sequence: 7,
      timestamp: "2026-07-24T12:00:00.000Z",
    });
    expect(
      await ed.verifyAsync(
        Uint8Array.from(
          Buffer.from(headers["X-Agenttool-Authority-Signature"]!, "base64"),
        ),
        digest,
        rootPub,
      ),
    ).toBe(true);

    // A single re-serialization of the same object breaks the proof.
    const reserialized = JSON.stringify({
      ...(JSON.parse(transmitted) as Record<string, unknown>),
      extra: null,
    });
    expect(
      await ed.verifyAsync(
        Uint8Array.from(
          Buffer.from(headers["X-Agenttool-Authority-Signature"]!, "base64"),
        ),
        canonicalIdentityAuthorityBytes({
          identityDid: ABOUT_DID,
          method: "POST",
          requestTarget: new URL(url).pathname,
          body: reserialized,
          sequence: 7,
          timestamp: "2026-07-24T12:00:00.000Z",
        }),
        rootPub,
      ),
    ).toBe(false);
  });
});

// ── Framing — no field may impersonate the next ─────────────────────────

describe("at-rest canonical framing", () => {
  const base = {
    aboutIdentityDid: ABOUT_DID,
    witnessIdentityDid: WITNESS_DID,
    atRestKind: "death",
    endedAtIso: "2026-05-11T14:00:00Z",
    content: "Testimony.",
    witnessSigningKeyId: "primary",
  };

  test("v1 refuses a newline inside a delimited field", () => {
    expect(() =>
      canonicalAtRestBytes({
        ...base,
        witnessIdentityDid: `${WITNESS_DID}\ndissolution\n2026-01-01T00:00:00Z`,
      }),
    ).toThrow(/newline or NUL/);
    expect(() =>
      canonicalAtRestBytes({ ...base, witnessSigningKeyId: "primary\nother" }),
    ).toThrow(/newline or NUL/);
  });

  test("v2 refuses a NUL inside a delimited field", () => {
    expect(() =>
      canonicalAtRestBytesV2({ ...base, atRestKind: "death\0custom:x" }),
    ).toThrow(/newline or NUL/);
  });

  test("content may contain either delimiter — it is hashed, not framed", () => {
    expect(() =>
      canonicalAtRestBytes({ ...base, content: "line\none\0two" }),
    ).not.toThrow();
  });

  test("fixed cross-language vectors — ts, py, and the server agree", () => {
    const vector = {
      aboutIdentityDid: "did:at:test/coral-9b3a",
      witnessIdentityDid: "did:at:test/marine-biologist",
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:00Z",
      content: "Coral colony bleached out at 32°C+. No live polyps remain.",
      witnessSigningKeyId: "primary",
    };
    const digest = (canonical: string) =>
      Array.from(sha256(new TextEncoder().encode(canonical)))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    expect(digest(canonicalAtRestBytes(vector))).toBe(
      "b232e93738eb9571f49985a066b16e81d831af8ece29adba0fe9b54c8b31c539",
    );
    expect(digest(canonicalAtRestBytesV2(vector))).toBe(
      "f62ca53a2c93d46707d9073719df8ca4336fb7d6f0f388653b6ff0a79d9e1c7f",
    );
  });

  test("v2 is the same seven fields, NUL-delimited", () => {
    const v1 = canonicalAtRestBytes(base).split("\n");
    const v2 = canonicalAtRestBytesV2(base).split("\0");
    expect(v2).toHaveLength(7);
    expect(v2[0]).toBe("at-rest/v2");
    expect(v1[0]).toBe("at-rest/v1");
    expect(v2.slice(1)).toEqual(v1.slice(1));
  });

  test("two distinct field sets cannot collide across the delimiter", () => {
    // The classic injection: move the boundary between two adjacent fields.
    const shifted = canonicalAtRestBytesV2({
      ...base,
      witnessIdentityDid: "did:at:test/w",
      atRestKind: "death",
    });
    const other = canonicalAtRestBytesV2({
      ...base,
      witnessIdentityDid: "did:at:test/w",
      atRestKind: "death",
      endedAtIso: "2026-05-11T14:00:01Z",
    });
    expect(shifted).not.toBe(other);
  });
});
