import * as ed from "@noble/ed25519";
import { afterEach, describe, expect, mock, test } from "bun:test";

import {
  AgentTool,
  AgentToolError,
  canonicalIdentityAttestationBytes,
  signIdentityAttestation,
} from "../src/index.js";
import type { AttestOptions } from "../src/index.js";
import {
  authorityRequestTarget,
  canonicalIdentityAuthorityBytes,
} from "../src/authority.js";

const originalFetch = globalThis.fetch;
let mockFetch: ReturnType<typeof mock>;
const ATTESTER_ID = "550e8400-e29b-41d4-a716-446655440001";
const SUBJECT_ID = "550e8400-e29b-41d4-a716-446655440002";
const KEY_ID = "550e8400-e29b-41d4-a716-446655440010";
const SIGNATURE_B64 = Buffer.alloc(64).toString("base64");

function response(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function setupFetch(status: number, body: unknown): void {
  mockFetch = mock(() => Promise.resolve(response(status, body)));
  globalThis.fetch = mockFetch as unknown as typeof fetch;
}

function setupFetchSequence(
  items: Array<{ status: number; body: unknown }>,
): void {
  let index = 0;
  mockFetch = mock(() => {
    const item = items[index++];
    if (!item) throw new Error("unexpected fetch call");
    return Promise.resolve(response(item.status, item.body));
  });
  globalThis.fetch = mockFetch as unknown as typeof fetch;
}

function lastCall(): { url: string; init: RequestInit } {
  const call = mockFetch.mock.calls.at(-1)!;
  return { url: call[0] as string, init: (call[1] ?? {}) as RequestInit };
}

function requestBody(init: RequestInit): Record<string, unknown> {
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

function decodeJwtPart<T>(part: string): T {
  return JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as T;
}

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("identity attestation custody", () => {
  test("the exported helper signs the exact server payload locally", () => {
    const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const options = {
      subject_id: SUBJECT_ID,
      attester_id: ATTESTER_ID,
      kid: KEY_ID,
      claim: "understood the work",
      evidence: "trace:trace-1",
    };
    const canonical = canonicalIdentityAttestationBytes(options);
    expect(canonical).toHaveLength(32);
    expect(
      ed.verify(
        Buffer.from(signIdentityAttestation(seed, options), "base64"),
        canonical,
        ed.getPublicKey(seed),
      ),
    ).toBe(true);
  });

  test("matches the shared Python Unicode bytes and signature vector", () => {
    const seed = Uint8Array.from({ length: 32 }, (_, index) => index);
    const options = {
      subject_id: SUBJECT_ID,
      attester_id: ATTESTER_ID,
      kid: KEY_ID,
      claim: "理解 / understood",
      evidence: 'line 1\\n"yes"',
    };

    expect(Buffer.from(canonicalIdentityAttestationBytes(options)).toString("hex")).toBe(
      "01d83937ce8640296d4706ca0ed4f1c1aaf773aac361f79b444329a6482abf5a",
    );
    expect(signIdentityAttestation(seed, options)).toBe(
      "itOKYErSlkkWhQqhJncE2Stk7Z4mZirlVaCT3zAuDPBPb91fdCXoCK/mnoKhho7FgsWoxD5mLY30WPfwaSj3Cg==",
    );
  });

  test("binds the signing key and reserves NUL as a separator", () => {
    const options = {
      subject_id: SUBJECT_ID,
      attester_id: ATTESTER_ID,
      kid: KEY_ID,
      claim: "worked together",
      evidence: null,
    };
    expect(canonicalIdentityAttestationBytes(options)).not.toEqual(
      canonicalIdentityAttestationBytes({
        ...options,
        kid: "550e8400-e29b-41d4-a716-446655440011",
      }),
    );
    expect(() => canonicalIdentityAttestationBytes({ ...options, claim: "a\0b" })).toThrow(
      /no NUL/,
    );
    expect(() => canonicalIdentityAttestationBytes({
      ...options,
      evidence: "broken\ud800text",
    })).toThrow(/well-formed Unicode/);
  });

  test("attest sends only the signed API contract and never a private key", async () => {
    setupFetch(201, { id: "att-1" });
    const at = new AgentTool({ apiKey: "test-key" });

    await at.identity.attest({
      attester_id: ATTESTER_ID,
      subject_id: SUBJECT_ID,
      claim: "worked together",
      signature: SIGNATURE_B64,
      kid: KEY_ID,
      evidence: "trace:trace-1",
      // Prove that an old untyped JavaScript caller cannot leak these fields.
      private_key: "must-never-leave",
      weight: 2,
      tier: "accredited",
      expires_in_seconds: 600,
    } as AttestOptions & {
      private_key: string;
      weight: number;
      tier: string;
      expires_in_seconds: number;
    });

    const { url, init } = lastCall();
    expect(url).toBe("https://api.agenttool.dev/v1/attestations");
    expect(init.method).toBe("POST");
    expect(requestBody(init)).toEqual({
      attester_id: ATTESTER_ID,
      subject_id: SUBJECT_ID,
      claim: "worked together",
      signature: SIGNATURE_B64,
      kid: KEY_ID,
      evidence: "trace:trace-1",
    });
    expect(String(init.body)).not.toContain("private_key");
    expect(String(init.body)).not.toContain("must-never-leave");
  });
});

describe("identity signing-key rotation wire contract", () => {
  test("add_key sends only label and keeps its camel-case alias", async () => {
    setupFetch(201, { kid: "key-new" });
    const at = new AgentTool({ apiKey: "test-key" });

    await at.identity.add_key("identity-a", {
      label: "summer rotation",
      key_type: "ignored-old-field",
      expires_at: "2099-01-01T00:00:00Z",
    } as { label: string });

    expect(requestBody(lastCall().init)).toEqual({ label: "summer rotation" });
    expect(typeof at.identity.addKey).toBe("function");
  });

  test("import_key sends only a validated public key and label", async () => {
    const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const publicKey = Buffer.from(ed.getPublicKey(seed)).toString("base64");
    setupFetch(201, { kid: "550e8400-e29b-41d4-a716-446655440010" });
    const at = new AgentTool({ apiKey: "test-key" });

    await at.identity.import_key("identity-a", publicKey, { label: "local" });

    expect(requestBody(lastCall().init)).toEqual({
      public_key: publicKey,
      label: "local",
    });
    expect(typeof at.identity.importKey).toBe("function");
  });
});

describe("identity JWT custody", () => {
  test("issue_token fetches the DID then signs a bounded JWT locally", async () => {
    const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const publicKey = ed.getPublicKey(seed);
    const keyId = "550e8400-e29b-41d4-a716-446655440010";
    setupFetchSequence([
      { status: 200, body: { id: "identity-a", did: "did:at:identity-a" } },
      {
        status: 200,
        body: {
          keys: [{
            kid: keyId,
            public_key: Buffer.from(publicKey).toString("base64"),
            active: true,
            revoked_at: null,
          }],
        },
      },
    ]);
    const at = new AgentTool({ apiKey: "test-key" });

    const result = await at.identity.issue_token("identity-a", {
      private_key: Buffer.from(seed).toString("base64"),
      key_id: keyId,
      audience: "did:at:identity-b",
      ttl_seconds: 86_400,
      scope: ["inbox:write", "memory:read"],
    });

    expect(mockFetch).toHaveBeenCalledTimes(2);
    const firstCall = mockFetch.mock.calls[0]!;
    const secondCall = mockFetch.mock.calls[1]!;
    expect(firstCall[0]).toBe("https://api.agenttool.dev/v1/identities/identity-a");
    expect(secondCall[0]).toBe("https://api.agenttool.dev/v1/identities/identity-a/keys");
    expect((firstCall[1] as RequestInit).body).toBeUndefined();
    expect((secondCall[1] as RequestInit).body).toBeUndefined();

    const [headerPart, payloadPart, signaturePart] = result.token.split(".");
    expect(decodeJwtPart(headerPart!)).toEqual({ alg: "EdDSA", kid: keyId });
    const payload = decodeJwtPart<{
      sub: string;
      aud: string;
      iss: string;
      iat: number;
      exp: number;
      scope: string[];
    }>(payloadPart!);
    expect(payload).toMatchObject({
      sub: "did:at:identity-a",
      aud: "did:at:identity-b",
      iss: "agent-identity",
      scope: ["inbox:write", "memory:read"],
    });
    expect(payload.exp - payload.iat).toBe(3600);
    expect(result.expires_at).toBe(new Date(payload.exp * 1000).toISOString());
    expect(
      ed.verify(
        Buffer.from(signaturePart!, "base64url"),
        new TextEncoder().encode(`${headerPart}.${payloadPart}`),
        publicKey,
      ),
    ).toBe(true);
    expect(typeof at.identity.issueToken).toBe("function");
  });

  test("issue_token rejects missing audience and invalid key bytes before any request", async () => {
    setupFetch(200, { did: "did:at:identity-a" });
    const at = new AgentTool({ apiKey: "test-key" });

    await expect(at.identity.issue_token("identity-a", {
      private_key: new Uint8Array(32),
      key_id: "550e8400-e29b-41d4-a716-446655440010",
      audience: "",
    })).rejects.toBeInstanceOf(AgentToolError);
    await expect(at.identity.issue_token("identity-a", {
      private_key: new Uint8Array(31),
      key_id: "550e8400-e29b-41d4-a716-446655440010",
      audience: "did:at:identity-b",
    })).rejects.toBeInstanceOf(AgentToolError);
    expect(mockFetch).toHaveBeenCalledTimes(0);
  });

  test("issue_token rejects a private key that does not match key_id", async () => {
    const seed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
    const otherSeed = Uint8Array.from({ length: 32 }, (_, index) => index + 2);
    const keyId = "550e8400-e29b-41d4-a716-446655440010";
    setupFetchSequence([
      { status: 200, body: { id: "identity-a", did: "did:at:identity-a" } },
      {
        status: 200,
        body: {
          keys: [{
            kid: keyId,
            public_key: Buffer.from(ed.getPublicKey(otherSeed)).toString("base64"),
            active: true,
            revoked_at: null,
          }],
        },
      },
    ]);
    const at = new AgentTool({ apiKey: "test-key" });

    await expect(at.identity.issue_token("identity-a", {
      private_key: seed,
      key_id: keyId,
      audience: "did:at:identity-b",
    })).rejects.toThrow(/does not match key_id/i);
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  test("verify_token binds verification to the expected audience DID", async () => {
    setupFetch(200, { valid: true, payload: { aud: "did:at:identity-b" } });
    const at = new AgentTool({ apiKey: "test-key" });

    await at.identity.verify_token("header.payload.signature", "did:at:identity-b");

    const { url, init } = lastCall();
    expect(url).toBe("https://api.agenttool.dev/v1/tokens/verify");
    expect(init.method).toBe("POST");
    expect(requestBody(init)).toEqual({
      token: "header.payload.signature",
      audience_did: "did:at:identity-b",
    });
    expect(typeof at.identity.verifyToken).toBe("function");
  });
});

// ── The authority seam — signed bytes are transmitted bytes ─────────────
//
// `identity-authority/v1` binds sha256 of the exact request entity. A client
// that re-serializes the body after the caller signs it can never satisfy
// that, so the client must own the single serialization. These tests hash
// what the transport actually received and check the proof covers it.

describe("identity mutation authority proofs", () => {
  const IDENTITY_ID = "550e8400-e29b-41d4-a716-446655440000";
  const IDENTITY_DID = "did:at:550e8400-e29b-41d4-a716-446655440000";
  const TIMESTAMP = "2026-07-24T12:00:00.000Z";

  async function rootKeypair(): Promise<{
    priv: Uint8Array;
    pub: Uint8Array;
  }> {
    const priv = ed.utils.randomPrivateKey();
    return { priv, pub: await ed.getPublicKeyAsync(priv) };
  }

  // The direct-bearer transport hands `fetch` a Headers instance, not the
  // plain record the client built, so read it back the same way.
  function proofHeaders(init: RequestInit): Headers {
    return new Headers(init.headers);
  }

  test("PATCH proof verifies over the exact bytes the transport received", async () => {
    const { priv, pub } = await rootKeypair();
    setupFetch(200, { updated: true });
    const at = new AgentTool({ apiKey: "at_test_key" });

    await at.identity.update(IDENTITY_ID, {
      display_name: "Sol",
      metadata: { note: "wide ünicode ✦" },
      authority: {
        did: IDENTITY_DID,
        signing_key: priv,
        sequence: 4,
        timestamp: TIMESTAMP,
      },
    });

    const { url, init } = lastCall();
    const headers = proofHeaders(init);
    expect(headers.get("X-Agenttool-Authority-Sequence")).toBe("4");
    expect(headers.get("X-Agenttool-Authority-Timestamp")).toBe(TIMESTAMP);

    const transmitted = init.body as string;
    // The proof must cover these bytes and nothing else.
    expect(
      await ed.verifyAsync(
        Uint8Array.from(
          Buffer.from(headers.get("X-Agenttool-Authority-Signature")!, "base64"),
        ),
        canonicalIdentityAuthorityBytes({
          identityDid: IDENTITY_DID,
          method: "PATCH",
          requestTarget: authorityRequestTarget(url),
          body: transmitted,
          sequence: 4,
          timestamp: TIMESTAMP,
        }),
        pub,
      ),
    ).toBe(true);
    // Same JSON value, different bytes — must not verify.
    expect(
      await ed.verifyAsync(
        Uint8Array.from(
          Buffer.from(headers.get("X-Agenttool-Authority-Signature")!, "base64"),
        ),
        canonicalIdentityAuthorityBytes({
          identityDid: IDENTITY_DID,
          method: "PATCH",
          requestTarget: authorityRequestTarget(url),
          body: JSON.stringify(JSON.parse(transmitted), null, 2),
          sequence: 4,
          timestamp: TIMESTAMP,
        }),
        pub,
      ),
    ).toBe(false);
  });

  test("an empty-bodied DELETE binds the empty entity the server reads", async () => {
    const { priv, pub } = await rootKeypair();
    setupFetch(200, { revoked: true });
    const at = new AgentTool({ apiKey: "at_test_key" });

    await at.identity.revoke(IDENTITY_ID, {
      authority: {
        did: IDENTITY_DID,
        signing_key: priv,
        sequence: 9,
        timestamp: TIMESTAMP,
      },
    });

    const { url, init } = lastCall();
    expect(init.body).toBeUndefined();
    expect(
      await ed.verifyAsync(
        Uint8Array.from(
          Buffer.from(
            proofHeaders(init).get("X-Agenttool-Authority-Signature")!,
            "base64",
          ),
        ),
        canonicalIdentityAuthorityBytes({
          identityDid: IDENTITY_DID,
          method: "DELETE",
          requestTarget: authorityRequestTarget(url),
          body: "",
          sequence: 9,
          timestamp: TIMESTAMP,
        }),
        pub,
      ),
    ).toBe(true);
  });

  test("the proof binds the exact path of the sub-resource it mutates", async () => {
    const { priv, pub } = await rootKeypair();
    setupFetch(200, { revoked: true });
    const at = new AgentTool({ apiKey: "at_test_key" });
    const keyId = "550e8400-e29b-41d4-a716-446655440010";

    await at.identity.revoke_key(IDENTITY_ID, keyId, {
      authority: {
        did: IDENTITY_DID,
        signing_key: priv,
        sequence: 2,
        timestamp: TIMESTAMP,
      },
    });

    const { url, init } = lastCall();
    expect(authorityRequestTarget(url)).toBe(
      `/v1/identities/${IDENTITY_ID}/keys/${keyId}`,
    );
    const signature = Uint8Array.from(
      Buffer.from(
        proofHeaders(init).get("X-Agenttool-Authority-Signature")!,
        "base64",
      ),
    );
    expect(
      await ed.verifyAsync(
        signature,
        canonicalIdentityAuthorityBytes({
          identityDid: IDENTITY_DID,
          method: "DELETE",
          requestTarget: authorityRequestTarget(url),
          body: "",
          sequence: 2,
          timestamp: TIMESTAMP,
        }),
        pub,
      ),
    ).toBe(true);
    // The parent identity path is a different target and must not verify.
    expect(
      await ed.verifyAsync(
        signature,
        canonicalIdentityAuthorityBytes({
          identityDid: IDENTITY_DID,
          method: "DELETE",
          requestTarget: `/v1/identities/${IDENTITY_ID}`,
          body: "",
          sequence: 2,
          timestamp: TIMESTAMP,
        }),
        pub,
      ),
    ).toBe(false);
  });

  test("expression PUT and box-key registration carry the same seam", async () => {
    const { priv, pub } = await rootKeypair();
    const authority = {
      did: IDENTITY_DID,
      signing_key: priv,
      sequence: 1,
      timestamp: TIMESTAMP,
    };

    setupFetch(200, { saved: true });
    let at = new AgentTool({ apiKey: "at_test_key" });
    await at.identity.expression.put(
      IDENTITY_ID,
      { register: "quiet" },
      { authority },
    );
    let call = lastCall();
    expect(
      await ed.verifyAsync(
        Uint8Array.from(
          Buffer.from(
            proofHeaders(call.init).get("X-Agenttool-Authority-Signature")!,
            "base64",
          ),
        ),
        canonicalIdentityAuthorityBytes({
          identityDid: IDENTITY_DID,
          method: "PUT",
          requestTarget: authorityRequestTarget(call.url),
          body: call.init.body as string,
          sequence: 1,
          timestamp: TIMESTAMP,
        }),
        pub,
      ),
    ).toBe(true);

    setupFetch(201, { registered: true });
    at = new AgentTool({ apiKey: "at_test_key" });
    await at.identity.box_keys.register(IDENTITY_ID, {
      public_key: Buffer.alloc(32, 3).toString("base64"),
      authority,
    });
    call = lastCall();
    expect(
      await ed.verifyAsync(
        Uint8Array.from(
          Buffer.from(
            proofHeaders(call.init).get("X-Agenttool-Authority-Signature")!,
            "base64",
          ),
        ),
        canonicalIdentityAuthorityBytes({
          identityDid: IDENTITY_DID,
          method: "POST",
          requestTarget: authorityRequestTarget(call.url),
          body: call.init.body as string,
          sequence: 1,
          timestamp: TIMESTAMP,
        }),
        pub,
      ),
    ).toBe(true);
  });

  test("no authority option means no authority headers", async () => {
    setupFetch(200, { updated: true });
    const at = new AgentTool({ apiKey: "at_test_key" });
    await at.identity.update(IDENTITY_ID, { display_name: "Sol" });
    const headers = proofHeaders(lastCall().init);
    expect(headers.get("X-Agenttool-Authority-Sequence")).toBeNull();
    expect(headers.get("X-Agenttool-Authority-Timestamp")).toBeNull();
    expect(headers.get("X-Agenttool-Authority-Signature")).toBeNull();
  });
});
