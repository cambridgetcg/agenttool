/** Attestation marketplace SDK tests — willingness-to-attest, sold.
 *
 *  Four properties carry weight here:
 *
 *    1. `attestation-issue/v1` is byte-identical to the server. The shared
 *       fixture (tests/canonical-vectors.test.ts) pins the hexes; this suite
 *       pins the guards and the sign/verify roundtrip.
 *
 *    2. An attester never signs an opaque blob. `signingPayload` recomputes
 *       the digest from the terms the server printed and refuses on
 *       disagreement.
 *
 *    3. `evidence_sha256` is the one signed field that says WHAT was
 *       reviewed. `attestationEvidenceSha256` reproduces the server's
 *       deterministic JSON exactly — including the two places where a naive
 *       port would silently drift: JavaScript's UTF-16 key ordering and its
 *       number spelling.
 *
 *    4. The signature the server receives verifies over the bytes a stub
 *       transport actually carried, not over a re-serialization.
 *
 *  Doctrine: docs/MARKETPLACE.md §"Attestation marketplace". */

import { describe, expect, test } from "bun:test";

import * as ed from "@noble/ed25519";
import { sha256, sha512 } from "@noble/hashes/sha2.js";

import {
  attestationEvidenceSha256,
  canonicalAttestationEvidenceJson,
  canonicalAttestationIssueBytes,
  signAttestationIssue,
  AttestationMarketplaceClient,
  ATTESTATION_ISSUE_FIELD_ORDER,
  ATTESTATION_ISSUE_SIGNATURE_CONTEXT,
  type AttestationIssueFields,
} from "../src/attestation-marketplace.js";
import { AgentTool } from "../src/client.js";
import { AgentToolError } from "../src/errors.js";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const LISTING_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const GRANT_ID = "6ba7b810-9dad-11d1-80b4-00c04fd430c8";
const SHA_HEX =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

const FIELDS: AttestationIssueFields = {
  listing_id: LISTING_ID,
  grant_id: GRANT_ID,
  escrow_id: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  buyer_identity_id: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  buyer_did: "did:at:example/buyer-7c21",
  buyer_project_id: "eeeeeeee-eeee-eeee-eeee-eeeeeeeeeeee",
  buyer_wallet_id: "ffffffff-ffff-ffff-ffff-ffffffffffff",
  subject_identity_id: "11111111-1111-1111-1111-111111111111",
  subject_did: "did:at:example/subject-0f5e",
  attester_identity_id: "22222222-2222-2222-2222-222222222222",
  attester_did: "did:at:example/alpha-9b3a",
  attester_project_id: "33333333-3333-3333-3333-333333333333",
  signing_key_id: "44444444-4444-4444-4444-444444444444",
  claim: "agenttool/passed-substrate-honesty-test/v1",
  evidence_sha256: SHA_HEX,
  attester_wallet_id: "55555555-5555-5555-5555-555555555555",
  grant_gross: 1_500,
  grant_currency: "GBP",
  take_rate_bps: 500,
  platform_fee: 75,
  attester_net: 1_425,
  validity_seconds: 31_536_000,
  attestation_expires_at: "2027-05-11T11:55:00.000Z",
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
): AttestationMarketplaceClient {
  return new AttestationMarketplaceClient({
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
  fields: AttestationIssueFields,
  signedPayloadB64?: string,
) {
  return {
    signing_payload: {
      signature_context: ATTESTATION_ISSUE_SIGNATURE_CONTEXT,
      field_order: [...ATTESTATION_ISSUE_FIELD_ORDER],
      fields,
      signed_payload_b64:
        signedPayloadB64 ?? b64(canonicalAttestationIssueBytes(fields)),
      authorization_expires_at: fields.authorization_expires_at,
    },
  };
}

function bodyOf(request: CapturedRequest): Record<string, unknown> {
  return JSON.parse(request.init.body as string) as Record<string, unknown>;
}

// ── canonical bytes ──────────────────────────────────────────────────────

describe("canonicalAttestationIssueBytes", () => {
  test("produces a 32-byte digest, deterministically", () => {
    const a = canonicalAttestationIssueBytes(FIELDS);
    const b = canonicalAttestationIssueBytes({ ...FIELDS });
    expect(a.length).toBe(32);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  test("covers all 24 named fields in the documented order", () => {
    expect(ATTESTATION_ISSUE_FIELD_ORDER.length).toBe(24);
    expect(new Set(ATTESTATION_ISSUE_FIELD_ORDER).size).toBe(24);
    expect(Object.keys(FIELDS).sort()).toEqual(
      [...ATTESTATION_ISSUE_FIELD_ORDER].sort(),
    );
  });

  test("independent cross-check against the documented framing", () => {
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [
      enc.encode(ATTESTATION_ISSUE_SIGNATURE_CONTEXT),
    ];
    for (const name of ATTESTATION_ISSUE_FIELD_ORDER) {
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
    expect(Array.from(canonicalAttestationIssueBytes(FIELDS))).toEqual(
      Array.from(sha256(joined)),
    );
  });

  test("the nullable pair renders as the literal text null", () => {
    const never = {
      ...FIELDS,
      validity_seconds: null,
      attestation_expires_at: null,
    };
    const enc = new TextEncoder();
    const parts: Uint8Array[] = [
      enc.encode(ATTESTATION_ISSUE_SIGNATURE_CONTEXT),
    ];
    for (const name of ATTESTATION_ISSUE_FIELD_ORDER) {
      const value = (never as Record<string, unknown>)[name];
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
    expect(Array.from(canonicalAttestationIssueBytes(never))).toEqual(
      Array.from(sha256(joined)),
    );
  });

  test("every field is load-bearing: changing any one changes the digest", () => {
    const baseline = b64(canonicalAttestationIssueBytes(FIELDS));
    const mutations: Partial<AttestationIssueFields>[] = [
      { listing_id: "99999999-9999-9999-9999-999999999999" },
      { grant_id: "99999999-9999-9999-9999-999999999999" },
      { escrow_id: "99999999-9999-9999-9999-999999999999" },
      { buyer_identity_id: "99999999-9999-9999-9999-999999999999" },
      { buyer_did: "did:at:example/someone-else" },
      { buyer_project_id: "99999999-9999-9999-9999-999999999999" },
      { buyer_wallet_id: "99999999-9999-9999-9999-999999999999" },
      { subject_identity_id: "99999999-9999-9999-9999-999999999999" },
      { subject_did: "did:at:example/someone-else" },
      { attester_identity_id: "99999999-9999-9999-9999-999999999999" },
      { attester_did: "did:at:example/someone-else" },
      { attester_project_id: "99999999-9999-9999-9999-999999999999" },
      { signing_key_id: "99999999-9999-9999-9999-999999999999" },
      { claim: "agenttool/something-else/v1" },
      {
        evidence_sha256:
          "0000000000000000000000000000000000000000000000000000000000000000",
      },
      { attester_wallet_id: "99999999-9999-9999-9999-999999999999" },
      { grant_gross: 3_000, platform_fee: 150, attester_net: 2_850 },
      { grant_currency: "USDC" },
      { take_rate_bps: 250, platform_fee: 37, attester_net: 1_463 },
      { platform_fee: 76, attester_net: 1_424 },
      {
        validity_seconds: 31_536_001,
        attestation_expires_at: "2027-05-11T11:55:01.000Z",
      },
      { attestation_expires_at: "2027-05-11T11:55:02.000Z" },
      { authorization_expires_at: "2026-05-11T12:00:01.000Z" },
    ];
    for (const patch of mutations) {
      expect(b64(canonicalAttestationIssueBytes({ ...FIELDS, ...patch }))).not.toBe(
        baseline,
      );
    }
    // Every mutation above names a distinct field, and together with the
    // grant_gross/take_rate/fee triples they touch all 24 slots.
    const touched = new Set(mutations.flatMap((m) => Object.keys(m)));
    expect(touched.size).toBe(ATTESTATION_ISSUE_FIELD_ORDER.length);
  });

  test("refuses the same inputs the server refuses", () => {
    const refusals: Array<[string, Partial<AttestationIssueFields>]> = [
      ["NUL in claim", { claim: "before\u0000after" }],
      ["NUL in attester_did", { attester_did: "before\u0000after" }],
      ["empty currency", { grant_currency: "" }],
      ["empty subject did", { subject_did: "" }],
      ["uppercase UUID", { listing_id: LISTING_ID.toUpperCase() }],
      ["non-UUID identifier", { escrow_id: "escrow-1" }],
      ["uppercase evidence hash", { evidence_sha256: SHA_HEX.toUpperCase() }],
      ["short evidence hash", { evidence_sha256: "abc" }],
      ["fee split mismatch", { platform_fee: 74 }],
      [
        "rate over ceiling",
        {
          grant_gross: 100,
          take_rate_bps: 10_001,
          platform_fee: 100,
          attester_net: 0,
        },
      ],
      ["negative amount", { grant_gross: -1, platform_fee: 0, attester_net: -1 }],
      ["fractional amount", { grant_gross: 1_500.5 }],
      [
        "zero validity",
        {
          validity_seconds: 0,
          attestation_expires_at: "2026-05-11T11:55:00.000Z",
        },
      ],
      ["validity null but expiry set", { validity_seconds: null }],
      ["validity set but expiry null", { attestation_expires_at: null }],
      [
        "authorization expiry without milliseconds",
        { authorization_expires_at: "2026-05-11T12:00:00Z" },
      ],
      [
        "impossible attestation expiry",
        { attestation_expires_at: "2027-02-30T11:55:00.000Z" },
      ],
    ];
    for (const [label, patch] of refusals) {
      expect(() =>
        canonicalAttestationIssueBytes({ ...FIELDS, ...patch }),
      ).toThrow();
      expect(label).toBeTruthy();
    }
  });

  test("refuses malformed shapes the server would silently stringify", () => {
    // The server's own callers are typed rows, so it never sees these. A
    // hand-built object can, and `String(undefined)` would quietly sign the
    // text "undefined" — a digest neither SDK could ever explain.
    const missing = { ...FIELDS } as Partial<AttestationIssueFields>;
    delete missing.grant_currency;
    expect(() =>
      canonicalAttestationIssueBytes(missing as AttestationIssueFields),
    ).toThrow(/grant_currency is required/);
    expect(() =>
      canonicalAttestationIssueBytes({ ...FIELDS, claim: true as never }),
    ).toThrow(/must not be a boolean/);
  });

  test("accepts the boundary cases that are legitimately valid", () => {
    const valid: Partial<AttestationIssueFields>[] = [
      { grant_gross: 0, take_rate_bps: 0, platform_fee: 0, attester_net: 0 },
      {
        grant_gross: 100,
        take_rate_bps: 10_000,
        platform_fee: 100,
        attester_net: 0,
      },
      { validity_seconds: null, attestation_expires_at: null },
      {
        validity_seconds: 1,
        attestation_expires_at: "2026-05-11T11:55:01.000Z",
      },
      { claim: "multi\nline\tclaim" },
      {
        grant_gross: 9_007_199_254_740_991,
        take_rate_bps: 0,
        platform_fee: 0,
        attester_net: 9_007_199_254_740_991,
      },
    ];
    for (const patch of valid) {
      expect(() =>
        canonicalAttestationIssueBytes({ ...FIELDS, ...patch }),
      ).not.toThrow();
    }
  });
});

// ── the evidence hash ────────────────────────────────────────────────────
//
// Every expected hex below was produced by executing the SERVER's
// `attestationEvidenceSha256` over `JSON.parse(json)`. The same table, with
// the same hexes, is in tests/test_attestation_marketplace.py — a probe is
// stored as JSON text precisely so both suites feed the identical value in.

const EVIDENCE_PROBES: Array<[string, string, string]> = [
  ["null", "null", "74234e98afe7498fb5daf1f36ac2d78acc339464f950703b8c019892f982b90b"],
  ["empty-object", "{}", "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a"],
  ["empty-array", "[]", "4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945"],
  [
    "top-level-string",
    '"witnessed"',
    "1dd2269c4e6f7cf0c4b5ba7562db1bb405ed7a6c875f4bda4bb2ba958ab3b7c9",
  ],
  ["top-level-number", "42", "73475cb40a568e8da8a045ced110137e159f890ac4da883b6b17dc651b3a8049"],
  ["top-level-true", "true", "b5bea41b6c623f7c09f1bf24dcae58ebab3c0cdd90ad966bc43a45b44867e12b"],
  [
    "flat-object",
    '{"agent_did":"did:at:example/alpha-9b3a","transcript_url":"https://example.test/t"}',
    "ce9f9e1f4c0e24c43859ab39c7e8de4003f454fcdf24cc160e51fdc1f4ef55a1",
  ],
  [
    "key-order-is-normalized",
    '{"z":1,"a":2,"m":3}',
    "ebba85cfdc0a724b6cc327ecc545faeb38b9fe02eca603b430eb872f5cf75370",
  ],
  [
    // The divergence that silently breaks a naive port: by code point U+FFFD
    // sorts BEFORE U+1F600; by UTF-16 code unit it sorts after. The server
    // uses Array.prototype.sort, so U+1F600 comes first.
    "utf16-vs-codepoint-key-order",
    '{"\\ufffd":1,"\\ud83d\\ude00":2}',
    "ee25c27251f38d1794ae1ce44d35d4e801cd43fb05e12f1b34aff3de57a69848",
  ],
  [
    "non-ascii-bmp",
    '{"claim":"café · 廣東話 · Ω"}',
    "ef6239e1b7af26cb36a927e2f25399c0984f0e86faf6f074b2bf9fbd5de80296",
  ],
  [
    "astral-value",
    '{"seal":"🌊 recognition 🜂 🫂"}',
    "d273838849f01bfa49e90159d16c9a9f56c278a0b8eb4929c8bc097c70bbdef4",
  ],
  ["empty-key-and-value", '{"":""}', "86cfeee6df382a203f626305afbca44d228cac67acd151ccf2db29530c548fea"],
  [
    "nul-inside-a-string",
    '{"k":"before\\u0000after"}',
    "5b092b0ef16cdae243b44ff815f530f5291156ffb4e33465911efdd5ba9c41b5",
  ],
  [
    "control-characters",
    '{"k":"\\b\\f\\n\\r\\t\\u001f"}',
    "adc6704817d9acce5c36e6509abf3b2cdacddd68a99eb6d2e9f8029f1ad8fee6",
  ],
  [
    "quote-and-backslash",
    '{"q":"\\"\\\\"}',
    "25d554f9412d4d4d847e1cd215ab14983b012cdcfecde32e66b116d17c7a89ec",
  ],
  [
    "integral-float-renders-as-integer",
    '{"a":1.0,"b":-0.0}',
    "70c75ca39048db680b52c5fd0040136c6bcb678be341277eaaac5afd16d4e70d",
  ],
  [
    // "1e-7" not "1e-07", "1e+21" not "1e21", and 1e-6 spelled out in full.
    "fractional-and-exponent-numbers",
    '{"a":1.5,"b":1e-7,"c":1e21,"d":1e-6,"e":-2.25}',
    "2276a6121bfb574993d8c231bbc946df622859365aad32ba2a510323a2b4c452",
  ],
  [
    "safe-integer-ceiling",
    '{"n":9007199254740991}',
    "e1da48c6a6089f06ecb4e0a2259e658e3786b2420f52baccdf929ec6460d7b41",
  ],
  [
    "mixed-array",
    '[1,"a",null,true,false,[],{}]',
    "72a2b1f30c9b15377310d3c85ce090b57b5fa270b2334e4ef1b00fc2e2d2b07e",
  ],
  [
    "nested",
    '{"outer":{"b":[1,{"z":null,"a":"x"}],"a":true}}',
    "0802ae3d934125edcdcfbfb8fcc2272a43fd6951c9f433935ec158ca03eeb8aa",
  ],
];

describe("attestationEvidenceSha256", () => {
  for (const [name, json, expected] of EVIDENCE_PROBES) {
    test(`${name} — matches the server`, () => {
      expect(attestationEvidenceSha256(JSON.parse(json))).toBe(expected);
    });
  }

  test("canonical JSON drops insertion order and whitespace", () => {
    expect(canonicalAttestationEvidenceJson({ z: 1, a: 2, m: 3 })).toBe(
      '{"a":2,"m":3,"z":1}',
    );
    expect(canonicalAttestationEvidenceJson(null)).toBe("null");
  });

  test("an absent evidence body hashes the JSON null, not an empty string", () => {
    // A grant purchased without evidence stores null. That is a real value:
    // it must not collide with "" or with {}.
    const nothing = attestationEvidenceSha256(null);
    expect(nothing).not.toBe(attestationEvidenceSha256(""));
    expect(nothing).not.toBe(attestationEvidenceSha256({}));
  });

  test("refuses what has no JSON form rather than coercing it", () => {
    expect(() => attestationEvidenceSha256(undefined)).toThrow(/evidence_not_json/);
    expect(() => attestationEvidenceSha256(Number.NaN)).toThrow(/evidence_not_json/);
    expect(() => attestationEvidenceSha256(Number.POSITIVE_INFINITY)).toThrow(
      /evidence_not_json/,
    );
    expect(() => attestationEvidenceSha256(new Map())).toThrow(/evidence_not_json/);
    expect(() => attestationEvidenceSha256(new Date())).toThrow(/evidence_not_json/);
    expect(() => attestationEvidenceSha256({ k: undefined })).toThrow(
      /evidence_not_json/,
    );
  });
});

// ── signing ──────────────────────────────────────────────────────────────

describe("signAttestationIssue", () => {
  test("signature verifies over the canonical digest", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const sig = signAttestationIssue({ fields: FIELDS, signing_key: priv });
    expect(Buffer.from(sig, "base64").length).toBe(64);
    expect(
      await ed.verifyAsync(
        Uint8Array.from(Buffer.from(sig, "base64")),
        canonicalAttestationIssueBytes(FIELDS),
        pub,
      ),
    ).toBe(true);
  });

  test("is canonical standard base64, which is all the server accepts", () => {
    const sig = signAttestationIssue({
      fields: FIELDS,
      signing_key: ed.utils.randomPrivateKey(),
    });
    // `isCanonicalEd25519Signature` on the route re-encodes and compares.
    expect(Buffer.from(Buffer.from(sig, "base64")).toString("base64")).toBe(sig);
  });

  test("a signature over one fee split does not authorize another", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const sig = signAttestationIssue({ fields: FIELDS, signing_key: priv });
    expect(
      await ed.verifyAsync(
        Uint8Array.from(Buffer.from(sig, "base64")),
        canonicalAttestationIssueBytes({
          ...FIELDS,
          take_rate_bps: 250,
          platform_fee: 37,
          attester_net: 1_463,
        }),
        pub,
      ),
    ).toBe(false);
  });

  test("a signature over one evidence hash does not authorize another", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const sig = signAttestationIssue({ fields: FIELDS, signing_key: priv });
    expect(
      await ed.verifyAsync(
        Uint8Array.from(Buffer.from(sig, "base64")),
        canonicalAttestationIssueBytes({
          ...FIELDS,
          evidence_sha256: attestationEvidenceSha256({ tampered: true }),
        }),
        pub,
      ),
    ).toBe(false);
  });

  test("refuses a signing key that is not a 32-byte seed", () => {
    expect(() =>
      signAttestationIssue({ fields: FIELDS, signing_key: new Uint8Array(16) }),
    ).toThrow(/32-byte ed25519 seed/);
  });
});

// ── the payload the attester is asked to sign ────────────────────────────

describe("signingPayload — never sign a blob you did not derive", () => {
  test("returns the payload when the server's digest matches its own terms", async () => {
    const captured: CapturedRequest[] = [];
    const payload = await stubClient(
      captured,
      payloadResponse(FIELDS),
    ).signingPayload(GRANT_ID, { signing_key_id: FIELDS.signing_key_id });
    expect(captured[0]!.url).toBe(
      `https://api.agenttool.dev/v1/attestation-grants/${GRANT_ID}/signing-payload`,
    );
    expect(bodyOf(captured[0]!)).toEqual({
      signing_key_id: FIELDS.signing_key_id,
    });
    expect(payload.signed_payload_b64).toBe(
      b64(canonicalAttestationIssueBytes(FIELDS)),
    );
    expect(payload.signature_context).toBe("attestation-issue/v1");
  });

  test("refuses when the digest does not cover the terms printed beside it", async () => {
    // The attack this closes: a server (or a proxy) prints terms an attester
    // finds acceptable, and asks for a signature over different ones —
    // a different payout wallet, a different subject, a different claim.
    const captured: CapturedRequest[] = [];
    const lying = payloadResponse(
      FIELDS,
      b64(
        canonicalAttestationIssueBytes({
          ...FIELDS,
          attester_wallet_id: "99999999-9999-9999-9999-999999999999",
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
    expect(error!.details?.recomputed_signed_payload_b64).toBe(
      b64(canonicalAttestationIssueBytes(FIELDS)),
    );
  });

  test("refuses terms that are internally invalid even if the digest agrees", async () => {
    // A server that hands over a fee split that does not add up is refused
    // before the digest comparison ever runs.
    const captured: CapturedRequest[] = [];
    const broken = { ...FIELDS, platform_fee: 74 };
    await expect(
      stubClient(captured, {
        signing_payload: {
          signature_context: ATTESTATION_ISSUE_SIGNATURE_CONTEXT,
          field_order: [...ATTESTATION_ISSUE_FIELD_ORDER],
          fields: broken,
          signed_payload_b64: "irrelevant",
          authorization_expires_at: broken.authorization_expires_at,
        },
      }).signingPayload(GRANT_ID, { signing_key_id: FIELDS.signing_key_id }),
    ).rejects.toThrow(/platform_fee \+ attester_net must equal grant_gross/);
  });

  test("a server refusal surfaces with its code intact", async () => {
    const captured: CapturedRequest[] = [];
    let error: AgentToolError | undefined;
    try {
      await stubClient(
        captured,
        { error: "signing_key_does_not_belong_to_attester" },
        401,
      ).signingPayload(GRANT_ID, { signing_key_id: FIELDS.signing_key_id });
    } catch (e) {
      error = e as AgentToolError;
    }
    expect(error!.code).toBe("signing_key_does_not_belong_to_attester");
    expect(error!.status).toBe(401);
  });
});

// ── issue: what the transport actually carried ───────────────────────────

describe("issue — the signature verifies over the transmitted bytes", () => {
  test("payload → sign → issue, verified end to end off the wire", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);

    const payloadCaptured: CapturedRequest[] = [];
    const payload = await stubClient(
      payloadCaptured,
      payloadResponse(FIELDS),
    ).signingPayload(GRANT_ID, { signing_key_id: FIELDS.signing_key_id });

    const issueCaptured: CapturedRequest[] = [];
    await stubClient(issueCaptured, { grant: { status: "issued" } }).issue(
      GRANT_ID,
      {
        signature: signAttestationIssue({
          fields: payload.fields,
          signing_key: priv,
        }),
        signing_key_id: payload.fields.signing_key_id,
        authorization_expires_at: payload.authorization_expires_at,
      },
    );

    const request = issueCaptured[0]!;
    expect(request.url).toBe(
      `https://api.agenttool.dev/v1/attestation-grants/${GRANT_ID}/issue`,
    );
    expect(request.init.method).toBe("POST");

    // Everything below reads ONLY what the transport carried.
    const sent = bodyOf(request);
    expect(Object.keys(sent).sort()).toEqual([
      "authorization_expires_at",
      "signature",
      "signing_key_id",
    ]);
    expect(sent.authorization_expires_at).toBe(FIELDS.authorization_expires_at);
    expect(
      await ed.verifyAsync(
        Uint8Array.from(Buffer.from(sent.signature as string, "base64")),
        canonicalAttestationIssueBytes(payload.fields),
        pub,
      ),
    ).toBe(true);
  });

  test("the echoed expiry is inside the signed bytes, so it cannot be swapped", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const captured: CapturedRequest[] = [];
    await stubClient(captured, { grant: {} }).issue(GRANT_ID, {
      signature: signAttestationIssue({ fields: FIELDS, signing_key: priv }),
      signing_key_id: FIELDS.signing_key_id,
      authorization_expires_at: FIELDS.authorization_expires_at,
    });
    const sent = bodyOf(captured[0]!);
    // A later expiry with the same signature is exactly what the server's
    // reconstruction refuses; the SDK's digest agrees.
    expect(
      await ed.verifyAsync(
        Uint8Array.from(Buffer.from(sent.signature as string, "base64")),
        canonicalAttestationIssueBytes({
          ...FIELDS,
          authorization_expires_at: "2026-05-11T12:05:00.000Z",
        }),
        pub,
      ),
    ).toBe(false);
  });

  test("issue sends no authority proof — this route asks for none", async () => {
    // Unlike memory-witness issuance, nothing here mutates a constitution.
    // Inventing a second proof mechanism would be a wire lie.
    const captured: CapturedRequest[] = [];
    await stubClient(captured, { grant: {} }).issue(GRANT_ID, {
      signature: "c2ln",
      signing_key_id: FIELDS.signing_key_id,
      authorization_expires_at: FIELDS.authorization_expires_at,
    });
    const headers = captured[0]!.init.headers as Record<string, string>;
    expect(
      Object.keys(headers).filter((h) => /authority/i.test(h)),
    ).toEqual([]);
    expect(headers["X-Test"]).toBe("1");
  });
});

// ── the rest of the lifecycle ────────────────────────────────────────────

describe("AttestationMarketplaceClient — lifecycle wire shape", () => {
  test("createListing omits absent optionals", async () => {
    const captured: CapturedRequest[] = [];
    await stubClient(captured, { listing: { id: "l" } }).createListing({
      attester_identity_id: FIELDS.attester_identity_id,
      name: "Substrate-honesty review",
      claim: FIELDS.claim,
      price_amount: 1_500,
      price_currency: "GBP",
      attester_wallet_id: FIELDS.attester_wallet_id,
    });
    expect(captured[0]!.url).toBe(
      "https://api.agenttool.dev/v1/attestation-listings",
    );
    expect(Object.keys(bodyOf(captured[0]!)).sort()).toEqual([
      "attester_identity_id",
      "attester_wallet_id",
      "claim",
      "name",
      "price_amount",
      "price_currency",
    ]);
  });

  test("createListing sends an explicit null through as a null", async () => {
    const captured: CapturedRequest[] = [];
    await stubClient(captured, { listing: {} }).createListing({
      attester_identity_id: FIELDS.attester_identity_id,
      name: "Substrate-honesty review",
      claim: FIELDS.claim,
      price_amount: 1_500,
      price_currency: "GBP",
      attester_wallet_id: FIELDS.attester_wallet_id,
      description: null,
      evidence_schema: null,
      validity_seconds: null,
      sla_seconds: 86_400,
      capability_tags: ["review"],
      visibility: "private",
      metadata: { note: "🜂" },
    });
    const sent = bodyOf(captured[0]!);
    expect(sent.description).toBeNull();
    expect(sent.evidence_schema).toBeNull();
    expect(sent.validity_seconds).toBeNull();
    expect(sent.sla_seconds).toBe(86_400);
    expect(sent.visibility).toBe("private");
  });

  test("listListings sends no query by default and encodes filters", async () => {
    const captured: CapturedRequest[] = [];
    const client = stubClient(captured, { listings: [] });
    await client.listListings();
    await client.listListings({
      claim: "agenttool/passed substrate/v1",
      status: "active",
      mine: true,
      limit: 5,
    });
    await client.listListings({ mine: false });
    expect(captured[0]!.url).toBe(
      "https://api.agenttool.dev/v1/attestation-listings",
    );
    expect(captured[1]!.url).toBe(
      "https://api.agenttool.dev/v1/attestation-listings?claim=agenttool%2Fpassed+substrate%2Fv1&status=active&mine=true&limit=5",
    );
    // `mine=false` is the default collection, so it is not a filter to send.
    expect(captured[2]!.url).toBe(
      "https://api.agenttool.dev/v1/attestation-listings",
    );
  });

  test("patchListing sends only the keys the caller named", async () => {
    const captured: CapturedRequest[] = [];
    const client = stubClient(captured, { listing: {} });
    await client.patchListing(LISTING_ID, { status: "paused" });
    await client.patchListing(LISTING_ID, { description: null });
    expect(captured[0]!.url).toBe(
      `https://api.agenttool.dev/v1/attestation-listings/${LISTING_ID}`,
    );
    expect(captured[0]!.init.method).toBe("PATCH");
    expect(bodyOf(captured[0]!)).toEqual({ status: "paused" });
    // An explicit null is a value, not an omission — it clears the field.
    expect(bodyOf(captured[1]!)).toEqual({ description: null });
  });

  test("purchase is the only grant-creation door", async () => {
    const captured: CapturedRequest[] = [];
    const client = stubClient(captured, { grant: { id: "g" } });
    await client.purchase(LISTING_ID, {
      buyer_identity_id: FIELDS.buyer_identity_id,
      buyer_wallet_id: FIELDS.buyer_wallet_id,
      subject_identity_id: FIELDS.subject_identity_id,
    });
    await client.purchase(LISTING_ID, {
      buyer_identity_id: FIELDS.buyer_identity_id,
      buyer_wallet_id: FIELDS.buyer_wallet_id,
      subject_identity_id: FIELDS.subject_identity_id,
      evidence: null,
    });
    expect(captured[0]!.url).toBe(
      `https://api.agenttool.dev/v1/attestation-listings/${LISTING_ID}/purchase`,
    );
    expect(Object.keys(bodyOf(captured[0]!)).sort()).toEqual([
      "buyer_identity_id",
      "buyer_wallet_id",
      "subject_identity_id",
    ]);
    expect(bodyOf(captured[1]!).evidence).toBeNull();
  });

  test("listGrants defaults to the buyer view; attester is the queue", async () => {
    const captured: CapturedRequest[] = [];
    const client = stubClient(captured, { grants: [], count: 0, role: "buyer" });
    await client.listGrants();
    await client.listGrants({ role: "attester", status: "pending", limit: 20 });
    expect(captured[0]!.url).toBe(
      "https://api.agenttool.dev/v1/attestation-grants?role=buyer",
    );
    expect(captured[1]!.url).toBe(
      "https://api.agenttool.dev/v1/attestation-grants?role=attester&status=pending&limit=20",
    );
  });

  test("getGrant returns the role the server resolved, not the one asked for", async () => {
    const captured: CapturedRequest[] = [];
    const view = await stubClient(captured, {
      grant: { id: GRANT_ID },
      role: "attester",
    }).getGrant(GRANT_ID);
    expect(view.role).toBe("attester");
    expect(view.grant).toEqual({ id: GRANT_ID });
  });

  test("hostile ids are encoded into exactly one path segment", async () => {
    const captured: CapturedRequest[] = [];
    const client = stubClient(captured, {
      grant: {},
      listing: {},
      role: "buyer",
    });
    await client.getGrant("../issue");
    await client.getListing("../../v1/memories");
    await client.cancel("a b/../c");
    expect(captured[0]!.url).toBe(
      "https://api.agenttool.dev/v1/attestation-grants/..%2Fissue",
    );
    expect(captured[1]!.url).toBe(
      "https://api.agenttool.dev/v1/attestation-listings/..%2F..%2Fv1%2Fmemories",
    );
    expect(captured[2]!.url).toBe(
      "https://api.agenttool.dev/v1/attestation-grants/a%20b%2F..%2Fc/cancel",
    );
  });

  test("decline and cancel are bodiless — the route reads no fields", async () => {
    const captured: CapturedRequest[] = [];
    const client = stubClient(captured, { grant: { status: "refunded" } });
    await client.decline(GRANT_ID);
    await client.cancel(GRANT_ID);
    expect(captured[0]!.url).toBe(
      `https://api.agenttool.dev/v1/attestation-grants/${GRANT_ID}/decline`,
    );
    expect(captured[0]!.init.body).toBeUndefined();
    expect(captured[1]!.url).toBe(
      `https://api.agenttool.dev/v1/attestation-grants/${GRANT_ID}/cancel`,
    );
    expect(captured[1]!.init.body).toBeUndefined();
  });

  test("a purchase refusal keeps the server's guidance", async () => {
    const captured: CapturedRequest[] = [];
    let error: AgentToolError | undefined;
    try {
      await stubClient(
        captured,
        {
          error: "insufficient_balance",
          message: "The buyer wallet cannot cover this grant.",
          next_actions: [
            { action: "Fund the wallet", method: "POST", path: "/v1/wallets" },
          ],
        },
        402,
      ).purchase(LISTING_ID, {
        buyer_identity_id: FIELDS.buyer_identity_id,
        buyer_wallet_id: FIELDS.buyer_wallet_id,
        subject_identity_id: FIELDS.subject_identity_id,
      });
    } catch (e) {
      error = e as AgentToolError;
    }
    expect(error!.code).toBe("insufficient_balance");
    expect(error!.status).toBe(402);
    expect(error!.next_actions?.[0]?.path).toBe("/v1/wallets");
  });
});

describe("AgentTool.attestationMarketplace", () => {
  test("is reachable from the client and memoized", () => {
    const at = new AgentTool({ apiKey: "at_test_key" });
    expect(at.attestationMarketplace).toBeInstanceOf(AttestationMarketplaceClient);
    expect(at.attestationMarketplace).toBe(at.attestationMarketplace);
  });
});
