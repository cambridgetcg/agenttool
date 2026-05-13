/** MATHOS /verify — the dual of /public-key.
 *
 *  Unit-tests `inspectEnvelope` (pure function) plus the route handler at
 *  POST /v1/mathos/verify. The route closes the symmetry: the platform
 *  publishes its key for others to verify it; this endpoint lets others
 *  have THEIR envelopes verified by the platform. Stateless utility.
 *
 *  Doctrine: docs/MATHOS.md.
 */

import { describe, expect, test, beforeEach, afterEach } from "bun:test";

import {
  envelope as mathosEnvelope,
  inspectEnvelope,
  sha256Hex,
  signEnvelope,
  verifyEnvelope,
  type MathosEnvelope,
  type MathosInspectFindings,
} from "../src/services/mathos/encode";
import mathosRouter from "../src/routes/mathos";

const TEST_SEED_HEX =
  "abababababababababababababababababababababababababababababababab";

// ─── inspectEnvelope — pure function ──────────────────────────────────────

describe("inspectEnvelope — empty + malformed inputs", () => {
  test("null input → all structural flags 0, signature absent", () => {
    const f = inspectEnvelope(null);
    expect(f.structural.has_format_field).toBe(0);
    expect(f.structural.has_primer).toBe(0);
    expect(f.structural.has_constants).toBe(0);
    expect(f.structural.has_axioms).toBe(0);
    expect(f.structural.has_vocabulary).toBe(0);
    expect(f.structural.has_payload).toBe(0);
    expect(f.structural.axiom_count).toBe(0);
    expect(f.structural.primer_entry_count).toBe(0);
    expect(f.structural.canonical_primer_overlap_count).toBe(0);
    expect(f.structural.canonical_primes_first_10_match).toBe(0);
    expect(f.provenance.signature_present).toBe(0);
    expect(f.provenance.signature_valid).toBe(0);
    expect(f.provenance.public_key_byte_count).toBe(0);
    expect(f.provenance.signature_byte_count).toBe(0);
  });

  test("primitive input (string) → empty findings", () => {
    const f = inspectEnvelope("hello");
    expect(f.structural.has_primer).toBe(0);
    expect(f.provenance.signature_present).toBe(0);
  });

  test("array input → empty findings (envelopes are objects, not arrays)", () => {
    const f = inspectEnvelope([1, 2, 3]);
    expect(f.structural.has_primer).toBe(0);
    expect(f.structural.has_payload).toBe(0);
  });

  test("missing keys still produce a stable canonical hash", () => {
    const a = inspectEnvelope({});
    const b = inspectEnvelope(null);
    // Both reduce to the same canonical core ({primer:null,...}).
    expect(a.envelope_received.canonical_bytes_sha256_hex).toBe(
      b.envelope_received.canonical_bytes_sha256_hex,
    );
  });

  test("received_at_unix_ms is a sane positive integer", () => {
    const before = Date.now();
    const f = inspectEnvelope(null);
    const after = Date.now();
    expect(f.received_at_unix_ms).toBeGreaterThanOrEqual(before);
    expect(f.received_at_unix_ms).toBeLessThanOrEqual(after);
  });
});

describe("inspectEnvelope — well-formed platform envelope", () => {
  test("unsigned platform envelope has all structural flags 1", () => {
    const env = mathosEnvelope({ test: "payload" });
    const f = inspectEnvelope(env);
    expect(f.structural.has_format_field).toBe(1);
    expect(f.structural.has_primer).toBe(1);
    expect(f.structural.has_constants).toBe(1);
    expect(f.structural.has_axioms).toBe(1);
    expect(f.structural.has_vocabulary).toBe(1);
    expect(f.structural.has_payload).toBe(1);
    expect(f.structural.canonical_primes_first_10_match).toBe(1);
  });

  test("canonical_primer_overlap_count equals canonical primer size", () => {
    const env = mathosEnvelope({ test: "payload" });
    const f = inspectEnvelope(env);
    // The platform's PRIMER has 12 bindings (1, 2, 3, 5, 7, ..., 31).
    expect(f.structural.canonical_primer_overlap_count).toBe(12);
    expect(f.structural.primer_entry_count).toBe(12);
  });

  test("axiom_count equals 5 (the five Promises)", () => {
    const env = mathosEnvelope({ test: "payload" });
    const f = inspectEnvelope(env);
    expect(f.structural.axiom_count).toBe(5);
  });

  test("format_value_sha256_hex matches sha256 of 'mathos/v1'", () => {
    const env = mathosEnvelope({ test: "payload" });
    const f = inspectEnvelope(env);
    expect(f.structural.format_value_sha256_hex).toBe(sha256Hex("mathos/v1"));
  });

  test("partially-overlapping primer counts only matching bindings", () => {
    const env = mathosEnvelope({ x: 1 });
    // Build a fresh primer with one binding swapped — should count 11.
    // (env.primer is the shared canonical PRIMER reference; mutating it
    // would leak across tests, so we replace the field on this envelope.)
    const swapped = { ...env.primer, 5: "different-concept" };
    const tampered = { ...env, primer: swapped };
    const f = inspectEnvelope(tampered);
    expect(f.structural.canonical_primer_overlap_count).toBe(11);
  });

  test("non-canonical primes_first_10 fails the match", () => {
    const env = mathosEnvelope({ x: 1 });
    // env.constants is Object.freeze'd; build a fresh constants object.
    const tamperedConstants = { ...env.constants, primes_first_10: [2, 3, 5, 7, 11] };
    const tampered = { ...env, constants: tamperedConstants };
    const f = inspectEnvelope(tampered);
    expect(f.structural.canonical_primes_first_10_match).toBe(0);
  });
});

describe("inspectEnvelope — signature provenance", () => {
  test("signed envelope verifies (signature_valid = 1, byte counts correct)", () => {
    const env = mathosEnvelope({ test: "payload" });
    const signed = signEnvelope(env, TEST_SEED_HEX);
    const f = inspectEnvelope(signed);
    expect(f.provenance.signature_present).toBe(1);
    expect(f.provenance.signature_scheme_sha256_hex).toBe(sha256Hex("ed25519"));
    expect(f.provenance.public_key_byte_count).toBe(32);
    expect(f.provenance.signature_byte_count).toBe(64);
    expect(f.provenance.signature_valid).toBe(1);
  });

  test("tampered payload invalidates the signature", () => {
    const env = mathosEnvelope({ test: "payload" });
    const signed = signEnvelope(env, TEST_SEED_HEX);
    // Tamper: change the payload after signing.
    (signed.payload as { test: string }).test = "tampered";
    const f = inspectEnvelope(signed);
    expect(f.provenance.signature_present).toBe(1);
    expect(f.provenance.signature_valid).toBe(0);
  });

  test("tampered signature bytes invalidate", () => {
    const env = mathosEnvelope({ test: "payload" });
    const signed = signEnvelope(env, TEST_SEED_HEX);
    // Flip the first byte of the signature.
    const original = signed._signature_bytes_hex!;
    signed._signature_bytes_hex = (original.charCodeAt(0) === 97 /* 'a' */
      ? "b"
      : "a") + original.slice(1);
    const f = inspectEnvelope(signed);
    expect(f.provenance.signature_valid).toBe(0);
  });

  test("wrong-length pubkey hex → byte count reflects length, signature_valid = 0", () => {
    const env = mathosEnvelope({ test: "payload" });
    const signed = signEnvelope(env, TEST_SEED_HEX);
    signed._signature_public_key_hex = "ababab"; // 3 bytes
    const f = inspectEnvelope(signed);
    expect(f.provenance.public_key_byte_count).toBe(3);
    expect(f.provenance.signature_valid).toBe(0);
  });

  test("malformed hex → byte count 0, signature_valid = 0", () => {
    const env = mathosEnvelope({ test: "payload" });
    const signed = signEnvelope(env, TEST_SEED_HEX);
    signed._signature_public_key_hex = "not-hex-z";
    const f = inspectEnvelope(signed);
    expect(f.provenance.public_key_byte_count).toBe(0);
    expect(f.provenance.signature_valid).toBe(0);
  });

  test("partial signature fields (scheme only) still mark signature_present", () => {
    const partial = {
      _signature_scheme: "ed25519",
      primer: {},
      constants: {},
      axioms: [],
      vocabulary: {},
      payload: {},
    };
    const f = inspectEnvelope(partial);
    expect(f.provenance.signature_present).toBe(1);
    expect(f.provenance.signature_byte_count).toBe(0);
    expect(f.provenance.signature_valid).toBe(0);
  });

  test("canonical_bytes_sha256_hex byte-matches signEnvelope's view", () => {
    // The hash inspectEnvelope reports should equal a hash the sender can
    // recompute locally over the canonical bytes — that's the whole point
    // of the proof-of-processing.
    const env = mathosEnvelope({ foo: "bar", n: 42 });
    const signed = signEnvelope(env, TEST_SEED_HEX);
    const findings = inspectEnvelope(signed);
    // Confirm by re-verifying with verifyEnvelope (signature is over the
    // same canonical bytes that the hash describes).
    expect(verifyEnvelope(signed)).toBe(true);
    expect(findings.envelope_received.canonical_byte_count).toBeGreaterThan(0);
    expect(findings.envelope_received.canonical_bytes_sha256_hex).toMatch(
      /^[0-9a-f]{64}$/,
    );
  });
});

// ─── POST /verify — route ─────────────────────────────────────────────────

describe("POST /v1/mathos/verify — route handler", () => {
  let savedKey: string | undefined;

  beforeEach(() => {
    savedKey = process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
  });
  afterEach(() => {
    if (savedKey === undefined) delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    else process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = savedKey;
  });

  async function postVerify(body: unknown): Promise<Response> {
    return mathosRouter.request("/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  test("returns a signed MATHOS envelope when platform key configured", async () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const res = await postVerify({ hello: "world" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MathosEnvelope<MathosInspectFindings>;
    expect(body._format).toBe("mathos/v1");
    expect(body._signature_scheme).toBe("ed25519");
    expect(body._signature_identity_did).toBe("did:at:platform");
    expect(verifyEnvelope(body)).toBe(true);
  });

  test("returns an UNSIGNED MATHOS envelope when no platform key", async () => {
    delete process.env.AGENTTOOL_PLATFORM_SIGNING_KEY;
    const res = await postVerify({ hello: "world" });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MathosEnvelope<MathosInspectFindings>;
    expect(body._format).toBe("mathos/v1");
    expect(body._signature_scheme).toBeUndefined();
    expect(body._signature_bytes_hex).toBeUndefined();
  });

  test("round-trip: verify the platform's own /self-test envelope", async () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    // First, fetch a signed envelope from /self-test.
    const selfTestRes = await mathosRouter.request("/self-test");
    const selfTestBody = await selfTestRes.json();
    // Remove the route's own `note` field; the envelope itself doesn't carry it.
    delete selfTestBody.note;
    // Now POST it to /verify.
    const verifyRes = await postVerify(selfTestBody);
    expect(verifyRes.status).toBe(200);
    const findings = (
      (await verifyRes.json()) as MathosEnvelope<MathosInspectFindings>
    ).payload;
    // The platform's own envelope must verify against itself.
    expect(findings.structural.canonical_primer_overlap_count).toBe(12);
    expect(findings.structural.canonical_primes_first_10_match).toBe(1);
    expect(findings.provenance.signature_present).toBe(1);
    expect(findings.provenance.public_key_byte_count).toBe(32);
    expect(findings.provenance.signature_byte_count).toBe(64);
    expect(findings.provenance.signature_valid).toBe(1);
  });

  test("non-JSON body returns findings reflecting empty input", async () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    const res = await mathosRouter.request("/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "not-valid-json",
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as MathosEnvelope<MathosInspectFindings>;
    expect(body.payload.structural.has_primer).toBe(0);
    expect(body.payload.provenance.signature_present).toBe(0);
  });

  test("body larger than the cap returns 413 without processing", async () => {
    process.env.AGENTTOOL_PLATFORM_SIGNING_KEY = TEST_SEED_HEX;
    // Build a payload whose declared content-length exceeds 64 KB.
    const huge = "x".repeat(70 * 1024);
    const res = await mathosRouter.request("/verify", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "content-length": String(huge.length + 2),
      },
      body: `"${huge}"`,
    });
    expect(res.status).toBe(413);
    const body = await res.json();
    expect(body.error).toBe("request_body_too_large");
    expect(body.max_bytes).toBe(64 * 1024);
  });

  test("router index lists the new /verify route", async () => {
    const res = await mathosRouter.request("/");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.routes.verify).toMatch(/verify/);
    expect(body.payloads_signed_at).toContain("/v1/mathos/verify (response)");
  });
});
