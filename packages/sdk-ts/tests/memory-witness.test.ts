/** Memory-witness marketplace SDK tests — paid constitutive seals.
 *
 *  Three properties carry weight here:
 *
 *    1. `memory-witness-issue/v1` is byte-identical to the server. The shared
 *       fixture (tests/canonical-vectors.test.ts) pins the hexes; this suite
 *       pins the guards and the sign/verify roundtrip.
 *
 *    2. A witness never signs an opaque blob. `signingPayload` recomputes the
 *       digest from the terms the server printed and refuses on disagreement.
 *
 *    3. Issue elevates a memory to constitutive, so the route runs
 *       `authorizeProjectConstitutionMutation`. The proof is asserted over the
 *       bytes the stub transport actually received.
 *
 *  Doctrine: docs/MARKETPLACE.md (Paid memory witness) · docs/MEMORY-TIERS.md. */

import { describe, expect, test } from "bun:test";

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import { canonicalIdentityAuthorityBytes } from "../src/authority.js";
import { AgentTool } from "../src/client.js";
import { AgentToolError } from "../src/errors.js";
import {
  canonicalMemoryWitnessIssueBytes,
  memoryContentSha256,
  MemoryWitnessClient,
  MEMORY_WITNESS_ISSUE_FIELD_ORDER,
  MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT,
  signMemoryWitnessIssue,
  type MemoryWitnessIssueFields,
} from "../src/memory-witness.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const GRANT_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const ROOT_DID = "did:at:test/buyer-root";
const STAMP = "2026-07-24T12:00:00.000Z";
const SHA_HEX =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const FIELDS: MemoryWitnessIssueFields = {
  listing_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  grant_id: GRANT_ID,
  escrow_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  buyer_identity_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  buyer_project_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  buyer_wallet_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
  memory_id: "11111111-1111-1111-1111-111111111111",
  memory_identity_id: "22222222-2222-2222-2222-222222222222",
  memory_content_sha256: SHA_HEX,
  source_tier: "foundational",
  target_tier: "constitutive",
  claim_kind: "continuity_of_self",
  witness_identity_id: "33333333-3333-3333-3333-333333333333",
  witness_did: "did:at:example/witness",
  witness_project_id: "44444444-4444-4444-4444-444444444444",
  signing_key_id: "55555555-5555-5555-5555-555555555555",
  witness_wallet_id: "66666666-6666-6666-6666-666666666666",
  gross_amount: 10_000,
  currency: "USDC",
  rate_bps: 500,
  platform_fee: 500,
  net_amount: 9_500,
  authorization_expires_at: "2026-05-11T12:00:00.000Z",
};

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

interface CapturedRequest {
  url: string;
  init: RequestInit;
}

function stubClient(
  captured: CapturedRequest[],
  body: unknown,
  status = 200,
): MemoryWitnessClient {
  return new MemoryWitnessClient({
    baseUrl: "https://api.agenttool.dev",
    headers: { "X-Test": "1" },
    timeout: 5000,
    request: (input, init) => {
      captured.push({ url: String(input), init: init ?? {} });
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        }),
      );
    },
  });
}

function payloadResponse(
  fields: MemoryWitnessIssueFields,
  signedPayloadB64?: string,
) {
  return {
    signing_payload: {
      signature_context: MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT,
      field_order: [...MEMORY_WITNESS_ISSUE_FIELD_ORDER],
      fields,
      signed_payload_b64:
        signedPayloadB64 ?? b64(canonicalMemoryWitnessIssueBytes(fields)),
      authorization_expires_at: fields.authorization_expires_at,
    },
  };
}

// ── canonical bytes ──────────────────────────────────────────────────────

describe("canonicalMemoryWitnessIssueBytes", () => {
  test("produces a 32-byte digest, deterministically", () => {
    const a = canonicalMemoryWitnessIssueBytes(FIELDS);
    const b = canonicalMemoryWitnessIssueBytes({ ...FIELDS });
    expect(a.length).toBe(32);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  test("independent cross-check against the documented framing", () => {
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [
      enc.encode(MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT),
    ];
    for (const name of MEMORY_WITNESS_ISSUE_FIELD_ORDER) {
      const value = (FIELDS as Record<string, unknown>)[name];
      parts.push(
        new Uint8Array([0]),
        enc.encode(value === null ? "null" : String(value)),
      );
    }
    let total = 0;
    for (const p of parts) total += p.length;
    const joined = new Uint8Array(total);
    let offset = 0;
    for (const p of parts) {
      joined.set(p, offset);
      offset += p.length;
    }
    expect(Array.from(canonicalMemoryWitnessIssueBytes(FIELDS))).toEqual(
      Array.from(sha256(joined)),
    );
  });

  test("a null memory_identity_id and the literal string collide by construction", () => {
    // Pinned rather than pretended away: `canonicalFieldValue` renders both
    // as "null". The server does the same, so the fixture carries it too.
    expect(
      Array.from(
        canonicalMemoryWitnessIssueBytes({ ...FIELDS, memory_identity_id: null }),
      ),
    ).toEqual(
      Array.from(
        canonicalMemoryWitnessIssueBytes({
          ...FIELDS,
          memory_identity_id: "null",
        }),
      ),
    );
  });

  test("every field is load-bearing: changing any one changes the digest", () => {
    const baseline = b64(canonicalMemoryWitnessIssueBytes(FIELDS));
    const mutations: Partial<MemoryWitnessIssueFields>[] = [
      { listing_id: "different" },
      { grant_id: "different" },
      { escrow_id: "different" },
      { buyer_identity_id: "different" },
      { buyer_project_id: "different" },
      { buyer_wallet_id: "different" },
      { memory_id: "different" },
      { memory_identity_id: null },
      {
        memory_content_sha256:
          "0000000000000000000000000000000000000000000000000000000000000000",
      },
      { claim_kind: "different" },
      { witness_identity_id: "different" },
      { witness_did: "different" },
      { witness_project_id: "different" },
      { signing_key_id: "different" },
      { witness_wallet_id: "different" },
      { gross_amount: 20_000, platform_fee: 1_000, net_amount: 19_000 },
      { currency: "EURC" },
      { rate_bps: 250, platform_fee: 250, net_amount: 9_750 },
      { authorization_expires_at: "2026-05-11T12:00:01.000Z" },
    ];
    for (const patch of mutations) {
      expect(
        b64(canonicalMemoryWitnessIssueBytes({ ...FIELDS, ...patch })),
      ).not.toBe(baseline);
    }
  });

  test("refuses the same inputs the server refuses", () => {
    const refusals: Array<[string, Partial<MemoryWitnessIssueFields>]> = [
      ["NUL in claim_kind", { claim_kind: "before\u0000after" }],
      ["NUL in witness_did", { witness_did: "before\u0000after" }],
      ["uppercase content hash", { memory_content_sha256: SHA_HEX.toUpperCase() }],
      ["short content hash", { memory_content_sha256: "abc" }],
      ["unauthorized tier pair", { source_tier: "episodic" as never }],
      ["fee split mismatch", { platform_fee: 400 }],
      [
        "rate over ceiling",
        { gross_amount: 100, rate_bps: 10_001, platform_fee: 100, net_amount: 0 },
      ],
      ["negative amount", { gross_amount: -1, platform_fee: 0, net_amount: -1 }],
      ["fractional amount", { gross_amount: 10_000.5 }],
      ["expiry without milliseconds", { authorization_expires_at: "2026-05-11T12:00:00Z" }],
      [
        "impossible calendar date",
        { authorization_expires_at: "2026-02-30T12:00:00.000Z" },
      ],
    ];
    for (const [label, patch] of refusals) {
      expect(() =>
        canonicalMemoryWitnessIssueBytes({ ...FIELDS, ...patch }),
      ).toThrow();
      expect(label).toBeTruthy();
    }
  });

  test("refuses malformed shapes the server would silently stringify", () => {
    // The server's own callers are typed rows, so it never sees these. A
    // hand-built object can, and `String(undefined)` would quietly sign the
    // text "undefined" — a digest neither SDK could ever explain.
    const missing = { ...FIELDS } as Partial<MemoryWitnessIssueFields>;
    delete missing.currency;
    expect(() =>
      canonicalMemoryWitnessIssueBytes(missing as MemoryWitnessIssueFields),
    ).toThrow(/currency is required/);
    expect(() =>
      canonicalMemoryWitnessIssueBytes({
        ...FIELDS,
        claim_kind: true as never,
      }),
    ).toThrow(/must not be a boolean/);
  });

  test("accepts the boundary cases that are legitimately valid", () => {
    expect(() =>
      canonicalMemoryWitnessIssueBytes({
        ...FIELDS,
        gross_amount: 0,
        rate_bps: 0,
        platform_fee: 0,
        net_amount: 0,
      }),
    ).not.toThrow();
    expect(() =>
      canonicalMemoryWitnessIssueBytes({
        ...FIELDS,
        gross_amount: 100,
        rate_bps: 10_000,
        platform_fee: 100,
        net_amount: 0,
      }),
    ).not.toThrow();
    // An empty field still occupies its NUL-delimited slot.
    expect(() =>
      canonicalMemoryWitnessIssueBytes({ ...FIELDS, currency: "" }),
    ).not.toThrow();
  });
});

describe("memoryContentSha256", () => {
  test("is the server's NFC-normalized sha256", () => {
    expect(memoryContentSha256("")).toBe(SHA_HEX);
    // NFC vs NFD spell one word; the hash must not care which arrived.
    expect(memoryContentSha256("café")).toBe(memoryContentSha256("café"));
    expect(memoryContentSha256("🌊 held")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("signMemoryWitnessIssue", () => {
  test("signature verifies over the canonical digest", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const sig = signMemoryWitnessIssue({ fields: FIELDS, signing_key: priv });
    expect(
      await ed.verifyAsync(
        Uint8Array.from(Buffer.from(sig, "base64")),
        canonicalMemoryWitnessIssueBytes(FIELDS),
        pub,
      ),
    ).toBe(true);
  });

  test("a signature over one fee split does not authorize another", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const sig = signMemoryWitnessIssue({ fields: FIELDS, signing_key: priv });
    expect(
      await ed.verifyAsync(
        Uint8Array.from(Buffer.from(sig, "base64")),
        canonicalMemoryWitnessIssueBytes({
          ...FIELDS,
          rate_bps: 250,
          platform_fee: 250,
          net_amount: 9_750,
        }),
        pub,
      ),
    ).toBe(false);
  });

  test("refuses a signing key that is not a 32-byte seed", () => {
    expect(() =>
      signMemoryWitnessIssue({ fields: FIELDS, signing_key: new Uint8Array(16) }),
    ).toThrow(/32-byte ed25519 seed/);
  });
});

// ── the payload the witness is asked to sign ─────────────────────────────

describe("signingPayload — never sign a blob you did not derive", () => {
  test("returns the payload when the server's digest matches its own terms", async () => {
    const captured: CapturedRequest[] = [];
    const payload = await stubClient(captured, payloadResponse(FIELDS)).signingPayload(
      GRANT_ID,
      { signing_key_id: FIELDS.signing_key_id },
    );
    expect(captured[0]!.url).toBe(
      `https://api.agenttool.dev/v1/memory-witness-grants/${GRANT_ID}/signing-payload`,
    );
    expect(JSON.parse(captured[0]!.init.body as string)).toEqual({
      signing_key_id: FIELDS.signing_key_id,
    });
    expect(payload.signed_payload_b64).toBe(
      b64(canonicalMemoryWitnessIssueBytes(FIELDS)),
    );
  });

  test("refuses when the digest does not cover the terms printed beside it", async () => {
    // The attack this closes: a server (or a proxy) prints terms a witness
    // finds acceptable, and asks for a signature over different ones.
    const captured: CapturedRequest[] = [];
    const lying = payloadResponse(
      FIELDS,
      b64(
        canonicalMemoryWitnessIssueBytes({
          ...FIELDS,
          witness_wallet_id: "99999999-9999-9999-9999-999999999999",
        }),
      ),
    );
    let error: AgentToolError | undefined;
    try {
      await stubClient(captured, lying).signingPayload(GRANT_ID, {
        signing_key_id: FIELDS.signing_key_id,
      });
    } catch (e) {
      error = e as AgentToolError;
    }
    expect(error).toBeInstanceOf(AgentToolError);
    expect(error!.code).toBe("signing_payload_mismatch");
    expect(error!.hint).toContain("Do not sign this payload");
  });

  test("a server refusal surfaces with its code intact", async () => {
    const captured: CapturedRequest[] = [];
    let error: AgentToolError | undefined;
    try {
      await stubClient(
        captured,
        {
          // errors.substrateTaskRefusal spells the stable code as `error`.
          error: "self_witness_forbidden",
          message: "A project cannot witness its own memory.",
          next_actions: [
            {
              action: "Find a witness from a different project",
              method: "GET",
              path: "/public/memory-witness-listings",
            },
          ],
        },
        403,
      ).signingPayload(GRANT_ID, { signing_key_id: FIELDS.signing_key_id });
    } catch (e) {
      error = e as AgentToolError;
    }
    expect(error!.code).toBe("self_witness_forbidden");
    expect(error!.status).toBe(403);
    expect(error!.next_actions?.[0]?.path).toBe("/public/memory-witness-listings");
  });
});

// ── the authority seam ───────────────────────────────────────────────────

describe("issue — the buyer project's root consents to the exact bytes", () => {
  test("the proof covers the transmitted entity, not a re-serialization", async () => {
    const rootPriv = ed.utils.randomPrivateKey();
    const rootPub = await ed.getPublicKeyAsync(rootPriv);
    const captured: CapturedRequest[] = [];
    const signature = signMemoryWitnessIssue({
      fields: FIELDS,
      signing_key: ed.utils.randomPrivateKey(),
    });

    await stubClient(captured, { grant: { status: "issued" } }).issue(GRANT_ID, {
      signature_b64: signature,
      signing_key_id: FIELDS.signing_key_id,
      authorization_expires_at: FIELDS.authorization_expires_at,
      authority: { did: ROOT_DID, signing_key: rootPriv, sequence: 5, timestamp: STAMP },
    });

    const request = captured[0]!;
    const headers = request.init.headers as Record<string, string>;
    expect(request.url).toBe(
      `https://api.agenttool.dev/v1/memory-witness-grants/${GRANT_ID}/issue`,
    );
    expect(headers["X-Agenttool-Authority-Sequence"]).toBe("5");
    expect(
      await ed.verifyAsync(
        Uint8Array.from(
          Buffer.from(headers["X-Agenttool-Authority-Signature"]!, "base64"),
        ),
        canonicalIdentityAuthorityBytes({
          identityDid: ROOT_DID,
          method: "POST",
          requestTarget: new URL(request.url).pathname,
          body: request.init.body as string,
          sequence: 5,
          timestamp: STAMP,
        }),
        rootPub,
      ),
    ).toBe(true);

    expect(
      await ed.verifyAsync(
        Uint8Array.from(
          Buffer.from(headers["X-Agenttool-Authority-Signature"]!, "base64"),
        ),
        canonicalIdentityAuthorityBytes({
          identityDid: ROOT_DID,
          method: "POST",
          requestTarget: new URL(request.url).pathname,
          body: JSON.stringify(JSON.parse(request.init.body as string), null, 2),
          sequence: 5,
          timestamp: STAMP,
        }),
        rootPub,
      ),
    ).toBe(false);
  });

  test("the witness signature and the root proof stay in their own channels", async () => {
    const captured: CapturedRequest[] = [];
    const signature = signMemoryWitnessIssue({
      fields: FIELDS,
      signing_key: ed.utils.randomPrivateKey(),
    });
    await stubClient(captured, { grant: {} }).issue(GRANT_ID, {
      signature_b64: signature,
      signing_key_id: FIELDS.signing_key_id,
      authorization_expires_at: FIELDS.authorization_expires_at,
      authority: {
        did: ROOT_DID,
        signing_key: ed.utils.randomPrivateKey(),
        sequence: 1,
        timestamp: STAMP,
      },
    });
    const sent = JSON.parse(captured[0]!.init.body as string) as Record<string, unknown>;
    expect(Object.keys(sent).sort()).toEqual([
      "authorization_expires_at",
      "signature_b64",
      "signing_key_id",
    ]);
    // The paid authorization rides the body; the root proof rides headers.
    expect(sent.signature_b64).toBe(signature);
  });

  test("issue without an authority binding sends no proof headers", async () => {
    const captured: CapturedRequest[] = [];
    await stubClient(captured, { grant: {} }).issue(GRANT_ID, {
      signature_b64: "c2ln",
      signing_key_id: FIELDS.signing_key_id,
      authorization_expires_at: FIELDS.authorization_expires_at,
    });
    const headers = captured[0]!.init.headers as Record<string, string>;
    expect(headers["X-Agenttool-Authority-Signature"]).toBeUndefined();
  });
});

// ── the rest of the lifecycle ────────────────────────────────────────────

describe("MemoryWitnessClient — lifecycle wire shape", () => {
  test("createListing omits absent optionals", async () => {
    const captured: CapturedRequest[] = [];
    await stubClient(captured, { listing: { id: "l" } }).createListing({
      witness_identity_id: FIELDS.witness_identity_id,
      name: "I will witness continuity claims",
      claim_kind: "continuity_of_self",
      price_amount: 10_000,
      price_currency: "USDC",
      witness_wallet_id: FIELDS.witness_wallet_id,
    });
    expect(captured[0]!.url).toBe(
      "https://api.agenttool.dev/v1/memory-witness-listings",
    );
    expect(Object.keys(JSON.parse(captured[0]!.init.body as string)).sort()).toEqual([
      "claim_kind",
      "name",
      "price_amount",
      "price_currency",
      "witness_identity_id",
      "witness_wallet_id",
    ]);
  });

  test("listListings defaults to this project's shelf and encodes its query", async () => {
    const captured: CapturedRequest[] = [];
    const client = stubClient(captured, { listings: [] });
    await client.listListings();
    await client.listListings({ scope: "public", claim_kind: "continuity of self" });
    expect(captured[0]!.url).toBe(
      "https://api.agenttool.dev/v1/memory-witness-listings?scope=mine",
    );
    expect(captured[1]!.url).toBe(
      "https://api.agenttool.dev/v1/memory-witness-listings?scope=public&claim_kind=continuity+of+self",
    );
  });

  test("createGrant and listGrants carry the buyer/witness role split", async () => {
    const captured: CapturedRequest[] = [];
    const client = stubClient(captured, { grant: {}, grants: [] });
    await client.createGrant({
      listing_id: FIELDS.listing_id,
      buyer_identity_id: FIELDS.buyer_identity_id,
      buyer_wallet_id: FIELDS.buyer_wallet_id,
      memory_id: FIELDS.memory_id,
    });
    await client.listGrants({ role: "witness", status: "pending" });
    expect(captured[0]!.url).toBe(
      "https://api.agenttool.dev/v1/memory-witness-grants",
    );
    expect(captured[1]!.url).toBe(
      "https://api.agenttool.dev/v1/memory-witness-grants?role=witness&status=pending",
    );
  });

  test("getGrant and getListing encode a hostile id into one path segment", async () => {
    const captured: CapturedRequest[] = [];
    const client = stubClient(captured, { grant: {}, listing: {} });
    await client.getGrant("../issue");
    await client.getListing("../../v1/memories");
    expect(captured[0]!.url).toBe(
      "https://api.agenttool.dev/v1/memory-witness-grants/..%2Fissue",
    );
    expect(captured[1]!.url).toBe(
      "https://api.agenttool.dev/v1/memory-witness-listings/..%2F..%2Fv1%2Fmemories",
    );
  });

  test("decline always sends a reason field, null when unspoken", async () => {
    const captured: CapturedRequest[] = [];
    const client = stubClient(captured, { grant: {} });
    await client.decline(GRANT_ID);
    await client.decline(GRANT_ID, { reason: "Not mine to witness." });
    expect(JSON.parse(captured[0]!.init.body as string)).toEqual({ reason: null });
    expect(JSON.parse(captured[1]!.init.body as string)).toEqual({
      reason: "Not mine to witness.",
    });
  });
});

describe("AgentTool.memoryWitness", () => {
  test("is reachable from the client and memoized", () => {
    const at = new AgentTool({ apiKey: "at_test_key" });
    expect(at.memoryWitness).toBeInstanceOf(MemoryWitnessClient);
    expect(at.memoryWitness).toBe(at.memoryWitness);
  });
});
