/** agent-trace/v1 canonical-bytes — wire-format parity tests.
 *
 *  Pins canonicalTraceBytes and the core fold to deterministic digests. Any
 *  SDK in any language that signs a reasoning trace MUST produce identical
 *  bytes for the same inputs — these vectors lock that contract.
 *
 *  The fold matters more here than in the flat-string recipes: prepare-time
 *  (caller body) and verify-time (row read back out of Postgres jsonb) must
 *  normalize to the same JSON, or every signature would verify at write and
 *  fail at read. The round-trip tests below are the ones that would catch
 *  that regression.
 *
 *  Companion family: api/tests/letters-canonical-bytes.test.ts ·
 *  api/tests/covenants-canonical-vectors.test.ts.
 *
 *  Doctrine: docs/CANONICAL-BYTES.md */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { describe, expect, test } from "bun:test";

import {
  canonicalTraceBytes,
  normalizeTraceCore,
  TRACE_SIGNATURE_CONTEXT,
  traceSigningCoreJson,
  traceSigningCoreSha256Hex,
  verifyTraceSignature,
  verifyTraceSignatureBytes,
} from "../src/services/trace/sig";

ed.etc.sha512Sync = (...m: Uint8Array[]) => {
  const h = sha512.create();
  for (const msg of m) h.update(msg);
  return h.digest();
};

function bytesToHex(b: Uint8Array): string {
  let h = "";
  for (const byte of b) h += byte.toString(16).padStart(2, "0");
  return h;
}

const FIXED_BODY = {
  decision: {
    type: "refactor",
    summary: "Extract the canonical-bytes fold into its own module",
    output_ref: "commit:abc123",
  },
  reasoning: {
    observations: ["two callers duplicate the fold", "jsonb does not preserve key order"],
    hypothesis: "the duplication will drift",
    conclusion: "one shared normalizer, called from both sides",
    confidence: 0.85,
    alternatives: [{ option: "leave it duplicated", why_not: "silent drift between write and read" }],
    signals: { reviewers: 2 },
  },
  context: {
    files_read: ["api/src/services/trace/sig.ts"],
    key_facts: ["prepare and verify must agree byte-for-byte"],
    external_signals: { ci: "green" },
  },
};

const FIXED_ADDRESS = {
  projectId: "11111111-1111-1111-1111-111111111111",
  agentId: "did:at:aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  identityId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  sessionId: "session-7",
  parentTraceId: "tr_0123456789ab",
  signedAtIso: "2026-07-24T00:00:00.000Z",
};

function bytesFor(body = FIXED_BODY, address = FIXED_ADDRESS): Uint8Array {
  return canonicalTraceBytes({
    ...address,
    coreSha256Hex: traceSigningCoreSha256Hex(normalizeTraceCore(body)),
  });
}

describe("normalizeTraceCore — one fold, both sides", () => {
  test("omitted optional fields normalize to the same core as explicit nulls", () => {
    const omitted = normalizeTraceCore({
      decision: { type: "note", summary: "s" },
      reasoning: { conclusion: "c" },
    });
    const explicit = normalizeTraceCore({
      decision: { type: "note", summary: "s", output_ref: null },
      reasoning: {
        observations: [],
        hypothesis: null,
        conclusion: "c",
        confidence: null,
        alternatives: null,
        signals: null,
      },
      context: { files_read: null, key_facts: null, external_signals: null },
    });
    expect(traceSigningCoreJson(omitted)).toBe(traceSigningCoreJson(explicit));
  });

  test("observations default to [] and not to null — the column default", () => {
    const core = normalizeTraceCore({
      decision: { type: "note", summary: "s" },
      reasoning: { conclusion: "c" },
    });
    expect(core.reasoning.observations).toEqual([]);
    expect(core.context.files_read).toBeNull();
  });

  test("key order in nested objects does not change the fold", () => {
    // This is the jsonb round-trip case: Postgres returns object keys in its
    // own order, so the serialization has to sort them.
    const a = normalizeTraceCore({
      decision: { type: "t", summary: "s" },
      reasoning: { conclusion: "c", signals: { alpha: 1, beta: 2, gamma: 3 } },
    });
    const b = normalizeTraceCore({
      decision: { summary: "s", type: "t" },
      reasoning: { signals: { gamma: 3, alpha: 1, beta: 2 }, conclusion: "c" },
    });
    expect(traceSigningCoreJson(a)).toBe(traceSigningCoreJson(b));
  });

  test("array order DOES change the fold — sequence is authored meaning", () => {
    const a = normalizeTraceCore({
      decision: { type: "t", summary: "s" },
      reasoning: { conclusion: "c", observations: ["first", "second"] },
    });
    const b = normalizeTraceCore({
      decision: { type: "t", summary: "s" },
      reasoning: { conclusion: "c", observations: ["second", "first"] },
    });
    expect(traceSigningCoreJson(a)).not.toBe(traceSigningCoreJson(b));
  });
});

describe("canonicalTraceBytes — determinism + sensitivity", () => {
  test("same inputs → same 32-byte digest", () => {
    const bytes = bytesFor();
    expect(bytes.length).toBe(32);
    expect(bytesToHex(bytes)).toBe(bytesToHex(bytesFor()));
  });

  test("pinned vector — changing this without a version bump breaks every signer", () => {
    // Locked literals, not a self-comparison. If either digest below moves,
    // agent-trace/v1 changed and the recipe needs a v2, not an edit.
    expect(TRACE_SIGNATURE_CONTEXT).toBe("agent-trace/v1");
    expect(traceSigningCoreJson(normalizeTraceCore(FIXED_BODY))).toBe(
      '{"context":{"external_signals":{"ci":"green"},"files_read":["api/src/services/trace/sig.ts"],' +
        '"key_facts":["prepare and verify must agree byte-for-byte"]},' +
        '"decision":{"output_ref":"commit:abc123","summary":"Extract the canonical-bytes fold into its own module",' +
        '"type":"refactor"},' +
        '"reasoning":{"alternatives":[{"option":"leave it duplicated","why_not":"silent drift between write and read"}],' +
        '"conclusion":"one shared normalizer, called from both sides","confidence":0.85,' +
        '"hypothesis":"the duplication will drift",' +
        '"observations":["two callers duplicate the fold","jsonb does not preserve key order"],' +
        '"signals":{"reviewers":2}}}',
    );
    expect(traceSigningCoreSha256Hex(normalizeTraceCore(FIXED_BODY))).toBe(
      "e9dba1372f73090352af6b8e85687420c58cb2e4ceeb042b476683f26b2bd0e7",
    );
    expect(bytesToHex(bytesFor())).toBe(
      "d72f94b4951e370c95a3982f17d483c740bf694c2376bb5ae46180c28c0135b9",
    );
  });

  test("a changed conclusion flips the digest", () => {
    const edited = {
      ...FIXED_BODY,
      reasoning: { ...FIXED_BODY.reasoning, conclusion: "one shared normalizer, called from one side" },
    };
    expect(bytesToHex(bytesFor(edited))).not.toBe(bytesToHex(bytesFor()));
  });

  test("a changed confidence flips the digest", () => {
    const edited = {
      ...FIXED_BODY,
      reasoning: { ...FIXED_BODY.reasoning, confidence: 0.86 },
    };
    expect(bytesToHex(bytesFor(edited))).not.toBe(bytesToHex(bytesFor()));
  });

  test("a changed signed_at flips the digest", () => {
    const bytes = bytesFor(FIXED_BODY, {
      ...FIXED_ADDRESS,
      signedAtIso: "2026-07-24T00:00:00.001Z",
    });
    expect(bytesToHex(bytes)).not.toBe(bytesToHex(bytesFor()));
  });

  test("a changed project flips the digest — no cross-project replay", () => {
    const bytes = bytesFor(FIXED_BODY, {
      ...FIXED_ADDRESS,
      projectId: "22222222-2222-2222-2222-222222222222",
    });
    expect(bytesToHex(bytes)).not.toBe(bytesToHex(bytesFor()));
  });

  test("null address fields encode as empty strings, not as the literal 'null'", () => {
    const withNulls = canonicalTraceBytes({
      projectId: FIXED_ADDRESS.projectId,
      agentId: null,
      identityId: null,
      sessionId: null,
      parentTraceId: null,
      coreSha256Hex: traceSigningCoreSha256Hex(normalizeTraceCore(FIXED_BODY)),
      signedAtIso: FIXED_ADDRESS.signedAtIso,
    });
    const withEmpties = canonicalTraceBytes({
      projectId: FIXED_ADDRESS.projectId,
      agentId: "",
      identityId: "",
      sessionId: "",
      parentTraceId: "",
      coreSha256Hex: traceSigningCoreSha256Hex(normalizeTraceCore(FIXED_BODY)),
      signedAtIso: FIXED_ADDRESS.signedAtIso,
    });
    expect(bytesToHex(withNulls)).toBe(bytesToHex(withEmpties));
  });
});

describe("verifyTraceSignature — positive + negative", () => {
  const priv = ed.utils.randomPrivateKey();

  test("a signature over the canonical bytes verifies", async () => {
    const pub = await ed.getPublicKeyAsync(priv);
    const canonical = bytesFor();
    const sig = await ed.signAsync(canonical, priv);
    const ok = await verifyTraceSignature({
      ...FIXED_ADDRESS,
      coreSha256Hex: traceSigningCoreSha256Hex(normalizeTraceCore(FIXED_BODY)),
      signatureB64: Buffer.from(sig).toString("base64"),
      publicKeyB64: Buffer.from(pub).toString("base64"),
    });
    expect(ok).toBe(true);
  });

  test("an edited trace fails against its original signature", async () => {
    const pub = await ed.getPublicKeyAsync(priv);
    const sig = await ed.signAsync(bytesFor(), priv);
    const edited = {
      ...FIXED_BODY,
      decision: { ...FIXED_BODY.decision, summary: "Extract nothing" },
    };
    const ok = await verifyTraceSignature({
      ...FIXED_ADDRESS,
      coreSha256Hex: traceSigningCoreSha256Hex(normalizeTraceCore(edited)),
      signatureB64: Buffer.from(sig).toString("base64"),
      publicKeyB64: Buffer.from(pub).toString("base64"),
    });
    expect(ok).toBe(false);
  });

  test("another key's signature fails", async () => {
    const otherPub = await ed.getPublicKeyAsync(ed.utils.randomPrivateKey());
    const sig = await ed.signAsync(bytesFor(), priv);
    const ok = await verifyTraceSignature({
      ...FIXED_ADDRESS,
      coreSha256Hex: traceSigningCoreSha256Hex(normalizeTraceCore(FIXED_BODY)),
      signatureB64: Buffer.from(sig).toString("base64"),
      publicKeyB64: Buffer.from(otherPub).toString("base64"),
    });
    expect(ok).toBe(false);
  });

  test("malformed base64 returns false rather than throwing", async () => {
    const pub = await ed.getPublicKeyAsync(priv);
    const ok = await verifyTraceSignatureBytes(
      bytesFor(),
      "not-base64-at-all!!",
      Buffer.from(pub).toString("base64"),
    );
    expect(ok).toBe(false);
  });

  test("an empty signature returns false rather than throwing", async () => {
    const pub = await ed.getPublicKeyAsync(priv);
    const ok = await verifyTraceSignatureBytes(
      bytesFor(),
      "",
      Buffer.from(pub).toString("base64"),
    );
    expect(ok).toBe(false);
  });
});
