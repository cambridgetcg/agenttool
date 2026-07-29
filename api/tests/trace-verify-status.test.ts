/** Trace signature verification — the status machine.
 *
 *  The point of GET /v1/traces/:id/verify is that it does not return a
 *  comfortable boolean. These tests pin the cases where agenttool *cannot*
 *  check a signature and has to say so, and the case where a signature is
 *  good but its key has since been revoked — where collapsing to either
 *  "valid" or "invalid" would be a lie in one direction.
 *
 *  Pure: the decision logic takes a row and resolved key facts, so no
 *  database is needed here. The DB stage is a lookup, not a decision.
 *
 *  Doctrine: docs/CANONICAL-BYTES.md (`agent-trace/v1`) ·
 *  docs/FRICTION-ROADMAP.md Tier 0 #9 */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { describe, expect, test } from "bun:test";

import { TRACE_SIGNATURE_CONTEXT, verifyTraceSignatureBytes } from "../src/services/trace/sig";
import type { TraceOut } from "../src/services/trace/store";
import {
  classifyKeyedTrace,
  storedTraceCanonicalBytes,
  traceSignaturePrecheck,
} from "../src/services/trace/verify";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

const PROJECT_ID = "11111111-1111-1111-1111-111111111111";
const KEY_ID = "33333333-3333-3333-3333-333333333333";

function trace(overrides: Partial<TraceOut> = {}): TraceOut {
  return {
    id: "44444444-4444-4444-4444-444444444444",
    trace_id: "tr_0123456789ab",
    agent_id: null,
    identity_id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
    session_id: null,
    parent_trace_id: null,
    decision_type: "route",
    decision_summary: "Take the slow path; correctness first",
    output_ref: null,
    observations: ["the fast path drops the tail case"],
    hypothesis: null,
    conclusion: "slow path",
    confidence: 0.7,
    alternatives: null,
    signals: null,
    files_read: null,
    key_facts: null,
    external_signals: null,
    tags: null,
    metadata: {},
    signature: null,
    signing_key_id: null,
    has_signature: false,
    created_at: "2026-07-24T00:00:00.000Z",
    ...overrides,
  };
}

const SIGNED_METADATA = {
  signature_context: TRACE_SIGNATURE_CONTEXT,
  signed_at: "2026-07-24T00:00:00.000Z",
};

const ACTIVE_KEY = { label: "primary", active: true, revoked_at: null };

describe("traceSignaturePrecheck — what cannot be checked, said plainly", () => {
  test("an unsigned trace is 'unsigned', not 'invalid'", () => {
    const pre = traceSignaturePrecheck(trace());
    expect(pre.ready).toBe(false);
    if (pre.ready) throw new Error("unreachable");
    expect(pre.result.status).toBe("unsigned");
    expect(pre.result.signed).toBe(false);
  });

  test("a signature with no key reference cannot be checked against anything", () => {
    const pre = traceSignaturePrecheck(
      trace({ signature: "sig", has_signature: true, metadata: SIGNED_METADATA }),
    );
    if (pre.ready) throw new Error("unreachable");
    expect(pre.result.status).toBe("no_key_reference");
  });

  test("a pre-recipe signature reports recipe_unrecorded, not forgery", () => {
    // The load-bearing case: rows written before agent-trace/v1 existed carry
    // a signature and no context. Calling those invalid would accuse every
    // historical signer of forging.
    const pre = traceSignaturePrecheck(
      trace({ signature: "sig", signing_key_id: KEY_ID, has_signature: true }),
    );
    if (pre.ready) throw new Error("unreachable");
    expect(pre.result.status).toBe("recipe_unrecorded");
    expect(pre.result.detail).toContain("before agent-trace/v1");
  });

  test("an unimplemented recipe is named, not guessed at", () => {
    const pre = traceSignaturePrecheck(
      trace({
        signature: "sig",
        signing_key_id: KEY_ID,
        has_signature: true,
        metadata: { signature_context: "agent-trace/v9" },
      }),
    );
    if (pre.ready) throw new Error("unreachable");
    expect(pre.result.status).toBe("recipe_unsupported");
    expect(pre.result.detail).toContain("agent-trace/v9");
  });

  test("a missing signed_at leaves the bytes unbuildable", () => {
    const pre = traceSignaturePrecheck(
      trace({
        signature: "sig",
        signing_key_id: KEY_ID,
        has_signature: true,
        metadata: { signature_context: TRACE_SIGNATURE_CONTEXT },
      }),
    );
    if (pre.ready) throw new Error("unreachable");
    expect(pre.result.status).toBe("signed_at_unrecorded");
  });

  test("a fully stamped signed trace passes through to the keyed stage", () => {
    const pre = traceSignaturePrecheck(
      trace({
        signature: "sig",
        signing_key_id: KEY_ID,
        has_signature: true,
        metadata: SIGNED_METADATA,
      }),
    );
    expect(pre.ready).toBe(true);
    if (!pre.ready) throw new Error("unreachable");
    expect(pre.signingKeyId).toBe(KEY_ID);
    expect(pre.signedAt).toBe("2026-07-24T00:00:00.000Z");
  });

  test("every precheck result carries the boundary on what verification proves", () => {
    const pre = traceSignaturePrecheck(trace());
    if (pre.ready) throw new Error("unreachable");
    expect(pre.result.boundary).toContain("does not establish that the reasoning is sound");
  });
});

describe("classifyKeyedTrace — the keyed outcomes", () => {
  const evidence = {
    canonicalSha256B64: "Y2Fub25pY2Fs",
    signingCoreSha256Hex: "deadbeef",
  };

  test("an unresolvable key is not-found rather than a distinct cross-project status", () => {
    // Distinguishing "wrong project" from "no such key" would let a caller
    // probe other projects' key IDs one request at a time.
    const result = classifyKeyedTrace(
      trace({ signature: "sig", signing_key_id: KEY_ID, has_signature: true, metadata: SIGNED_METADATA }),
      { key: null, signatureValid: false, ...evidence },
    );
    expect(result.status).toBe("key_not_found");
    expect(result.key).toBeNull();
    // The bytes still come back — they do not depend on the key, and a caller
    // holding the public half from a peer can check the signature themselves.
    expect(result.canonical_sha256_b64).toBe("Y2Fub25pY2Fs");
  });

  test("a good signature over an active key is valid, with reproducible evidence", () => {
    const result = classifyKeyedTrace(
      trace({ signature: "sig", signing_key_id: KEY_ID, has_signature: true, metadata: SIGNED_METADATA }),
      { key: ACTIVE_KEY, signatureValid: true, ...evidence },
    );
    expect(result.status).toBe("valid");
    expect(result.canonical_sha256_b64).toBe("Y2Fub25pY2Fs");
    expect(result.signing_core_sha256_hex).toBe("deadbeef");
    expect(result.recipe).toBe(TRACE_SIGNATURE_CONTEXT);
  });

  test("a good signature over a revoked key reports BOTH facts", () => {
    const result = classifyKeyedTrace(
      trace({ signature: "sig", signing_key_id: KEY_ID, has_signature: true, metadata: SIGNED_METADATA }),
      {
        key: { label: "primary", active: false, revoked_at: "2026-07-25T00:00:00.000Z" },
        signatureValid: true,
        ...evidence,
      },
    );
    expect(result.status).toBe("valid_key_revoked");
    expect(result.detail).toContain("does not unmake a past signature");
    expect(result.key?.revoked_at).toBe("2026-07-25T00:00:00.000Z");
  });

  test("a bad signature is invalid, and the boundary says why that is not proof of forgery", () => {
    const result = classifyKeyedTrace(
      trace({ signature: "sig", signing_key_id: KEY_ID, has_signature: true, metadata: SIGNED_METADATA }),
      { key: ACTIVE_KEY, signatureValid: false, ...evidence },
    );
    expect(result.status).toBe("invalid");
    expect(result.boundary).toContain("fails the same way a forged one does");
  });
});

describe("storedTraceCanonicalBytes — write-time and read-time agree", () => {
  test("a signature made over the row's fields verifies when rebuilt from the row", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const row = trace({
      signing_key_id: KEY_ID,
      has_signature: true,
      metadata: SIGNED_METADATA,
      signals: { beta: 2, alpha: 1 },
      files_read: ["a.ts", "b.ts"],
    });

    const { canonical } = storedTraceCanonicalBytes(PROJECT_ID, row, SIGNED_METADATA.signed_at);
    const sig = Buffer.from(await ed.signAsync(canonical, priv)).toString("base64");

    // Round-trip the row the way Postgres jsonb would: reserialize, and let
    // object keys come back in a different order.
    const roundTripped = trace({
      ...row,
      signature: sig,
      signals: { alpha: 1, beta: 2 },
      files_read: JSON.parse(JSON.stringify(row.files_read)) as unknown,
    });
    const rebuilt = storedTraceCanonicalBytes(PROJECT_ID, roundTripped, SIGNED_METADATA.signed_at);

    expect(
      await verifyTraceSignatureBytes(rebuilt.canonical, sig, Buffer.from(pub).toString("base64")),
    ).toBe(true);
  });

  test("editing the stored conclusion after signing breaks the check", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const row = trace({ signing_key_id: KEY_ID, metadata: SIGNED_METADATA });

    const { canonical } = storedTraceCanonicalBytes(PROJECT_ID, row, SIGNED_METADATA.signed_at);
    const sig = Buffer.from(await ed.signAsync(canonical, priv)).toString("base64");

    const tampered = storedTraceCanonicalBytes(
      PROJECT_ID,
      trace({ ...row, conclusion: "fast path" }),
      SIGNED_METADATA.signed_at,
    );
    expect(
      await verifyTraceSignatureBytes(tampered.canonical, sig, Buffer.from(pub).toString("base64")),
    ).toBe(false);
  });

  test("the same row under another project id does not verify", async () => {
    const priv = ed.utils.randomPrivateKey();
    const pub = await ed.getPublicKeyAsync(priv);
    const row = trace({ signing_key_id: KEY_ID, metadata: SIGNED_METADATA });

    const { canonical } = storedTraceCanonicalBytes(PROJECT_ID, row, SIGNED_METADATA.signed_at);
    const sig = Buffer.from(await ed.signAsync(canonical, priv)).toString("base64");

    const elsewhere = storedTraceCanonicalBytes(
      "22222222-2222-2222-2222-222222222222",
      row,
      SIGNED_METADATA.signed_at,
    );
    expect(
      await verifyTraceSignatureBytes(elsewhere.canonical, sig, Buffer.from(pub).toString("base64")),
    ).toBe(false);
  });
});
