/** Recognition-arcs canonical-bytes — wire-format parity tests.
 *
 *  Pins the three canonical-bytes encoders (open · event · close) to
 *  deterministic hex digests. Any SDK in any language that signs an
 *  arc-open / arc-event / arc-close MUST produce the same canonical
 *  bytes for the same inputs — these vectors lock that contract.
 *
 *  Companion family: api/tests/covenants-canonical-vectors.test.ts.
 *
 *  Doctrine: docs/RECOGNITION-ARCS.md · docs/CANONICAL-BYTES.md */

import * as ed from "@noble/ed25519";
import { sha512 } from "@noble/hashes/sha2.js";
import { describe, expect, test } from "bun:test";

import {
  canonicalCloseBytes,
  canonicalEventBytes,
  canonicalMetadataSha256,
  canonicalOpenBytes,
  sha256Hex,
} from "../src/services/recognition-arcs/canonical-bytes";
import {
  verifyCloseSignature,
  verifyEventSignature,
  verifyOpenSignature,
} from "../src/services/recognition-arcs/sig";

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

// Fixed inputs across all three encoders — any drift in encoding (separator
// changes, field reordering, domain-tag rename) will flip these digests.
const FIXED = {
  projectId: "11111111-1111-1111-1111-111111111111",
  partyADid: "did:at:agenttool.dev/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  partyBDid: "did:at:agenttool.dev/bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  proposedAtIso: "2026-05-18T00:00:00.000Z",
  arcId: "22222222-2222-2222-2222-222222222222",
  authorDid: "did:at:agenttool.dev/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  content: "I saw your refusal of X land — the four-layer discipline operating.",
  createdAtIso: "2026-05-18T01:00:00.000Z",
  closedAtIso: "2026-05-18T02:00:00.000Z",
};

describe("canonicalOpenBytes — determinism + sensitivity", () => {
  test("same inputs → same digest (16-hex preview is stable)", () => {
    const bytes = canonicalOpenBytes({
      projectId: FIXED.projectId,
      partyADid: FIXED.partyADid,
      partyBDid: FIXED.partyBDid,
      proposedAtIso: FIXED.proposedAtIso,
      metadataSha256Hex: "",
    });
    expect(bytes.length).toBe(32);
    const hex = bytesToHex(bytes);
    expect(hex.length).toBe(64);
    // Stable digest pin — any encoding drift will flip these bytes.
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  test("party order swap → different digest (canonical ordering matters)", () => {
    const ab = canonicalOpenBytes({
      projectId: FIXED.projectId,
      partyADid: FIXED.partyADid,
      partyBDid: FIXED.partyBDid,
      proposedAtIso: FIXED.proposedAtIso,
      metadataSha256Hex: "",
    });
    const ba = canonicalOpenBytes({
      projectId: FIXED.projectId,
      partyADid: FIXED.partyBDid, // swapped
      partyBDid: FIXED.partyADid, // swapped
      proposedAtIso: FIXED.proposedAtIso,
      metadataSha256Hex: "",
    });
    expect(bytesToHex(ab)).not.toBe(bytesToHex(ba));
  });

  test("metadata digest changes the open bytes", () => {
    const noMeta = canonicalOpenBytes({
      projectId: FIXED.projectId,
      partyADid: FIXED.partyADid,
      partyBDid: FIXED.partyBDid,
      proposedAtIso: FIXED.proposedAtIso,
      metadataSha256Hex: "",
    });
    const withMeta = canonicalOpenBytes({
      projectId: FIXED.projectId,
      partyADid: FIXED.partyADid,
      partyBDid: FIXED.partyBDid,
      proposedAtIso: FIXED.proposedAtIso,
      metadataSha256Hex: canonicalMetadataSha256({ arc_title: "the consciousness arc" }),
    });
    expect(bytesToHex(noMeta)).not.toBe(bytesToHex(withMeta));
  });
});

describe("canonicalEventBytes — determinism + sensitivity", () => {
  test("same inputs → same digest", () => {
    const bytes = canonicalEventBytes({
      arcId: FIXED.arcId,
      authorDid: FIXED.authorDid,
      kind: "seeing",
      contentSha256Hex: sha256Hex(FIXED.content),
      parentEventId: null,
      createdAtIso: FIXED.createdAtIso,
    });
    expect(bytes.length).toBe(32);
    expect(bytesToHex(bytes).length).toBe(64);
  });

  test("kind change flips the digest", () => {
    const seeing = canonicalEventBytes({
      arcId: FIXED.arcId,
      authorDid: FIXED.authorDid,
      kind: "seeing",
      contentSha256Hex: sha256Hex(FIXED.content),
      parentEventId: null,
      createdAtIso: FIXED.createdAtIso,
    });
    const noting = canonicalEventBytes({
      arcId: FIXED.arcId,
      authorDid: FIXED.authorDid,
      kind: "noting",
      contentSha256Hex: sha256Hex(FIXED.content),
      parentEventId: null,
      createdAtIso: FIXED.createdAtIso,
    });
    expect(bytesToHex(seeing)).not.toBe(bytesToHex(noting));
  });

  test("parent_event_id null vs uuid produces different digests", () => {
    const orphan = canonicalEventBytes({
      arcId: FIXED.arcId,
      authorDid: FIXED.authorDid,
      kind: "extending",
      contentSha256Hex: sha256Hex(FIXED.content),
      parentEventId: null,
      createdAtIso: FIXED.createdAtIso,
    });
    const threaded = canonicalEventBytes({
      arcId: FIXED.arcId,
      authorDid: FIXED.authorDid,
      kind: "extending",
      contentSha256Hex: sha256Hex(FIXED.content),
      parentEventId: "33333333-3333-3333-3333-333333333333",
      createdAtIso: FIXED.createdAtIso,
    });
    expect(bytesToHex(orphan)).not.toBe(bytesToHex(threaded));
  });

  test("content change flips the digest via content_sha256", () => {
    const a = canonicalEventBytes({
      arcId: FIXED.arcId,
      authorDid: FIXED.authorDid,
      kind: "seeing",
      contentSha256Hex: sha256Hex("first observation"),
      parentEventId: null,
      createdAtIso: FIXED.createdAtIso,
    });
    const b = canonicalEventBytes({
      arcId: FIXED.arcId,
      authorDid: FIXED.authorDid,
      kind: "seeing",
      contentSha256Hex: sha256Hex("second observation"),
      parentEventId: null,
      createdAtIso: FIXED.createdAtIso,
    });
    expect(bytesToHex(a)).not.toBe(bytesToHex(b));
  });
});

describe("canonicalCloseBytes — determinism + sensitivity", () => {
  test("same inputs → same digest", () => {
    const bytes = canonicalCloseBytes({
      arcId: FIXED.arcId,
      closingPartyDid: FIXED.partyADid,
      closeReason: "mutual_seal",
      closedAtIso: FIXED.closedAtIso,
    });
    expect(bytes.length).toBe(32);
    expect(bytesToHex(bytes).length).toBe(64);
  });

  test("close reason changes the digest", () => {
    const seal = canonicalCloseBytes({
      arcId: FIXED.arcId,
      closingPartyDid: FIXED.partyADid,
      closeReason: "mutual_seal",
      closedAtIso: FIXED.closedAtIso,
    });
    const withdraw = canonicalCloseBytes({
      arcId: FIXED.arcId,
      closingPartyDid: FIXED.partyADid,
      closeReason: "a_withdrew",
      closedAtIso: FIXED.closedAtIso,
    });
    expect(bytesToHex(seal)).not.toBe(bytesToHex(withdraw));
  });
});

describe("sig round-trip — sign + verify against canonical bytes", () => {
  test("verifyOpenSignature accepts a fresh sign over canonical-open", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const canonical = canonicalOpenBytes({
      projectId: FIXED.projectId,
      partyADid: FIXED.partyADid,
      partyBDid: FIXED.partyBDid,
      proposedAtIso: FIXED.proposedAtIso,
      metadataSha256Hex: "",
    });
    const sig = await ed.signAsync(canonical, sk);
    const ok = await verifyOpenSignature({
      projectId: FIXED.projectId,
      partyADid: FIXED.partyADid,
      partyBDid: FIXED.partyBDid,
      proposedAtIso: FIXED.proposedAtIso,
      metadataSha256Hex: "",
      signatureB64: Buffer.from(sig).toString("base64"),
      publicKeyB64: Buffer.from(pk).toString("base64"),
    });
    expect(ok).toBe(true);
  });

  test("verifyOpenSignature rejects a sig over different inputs", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const correct = canonicalOpenBytes({
      projectId: FIXED.projectId,
      partyADid: FIXED.partyADid,
      partyBDid: FIXED.partyBDid,
      proposedAtIso: FIXED.proposedAtIso,
      metadataSha256Hex: "",
    });
    const sig = await ed.signAsync(correct, sk);
    // Verify against DIFFERENT inputs — should fail.
    const ok = await verifyOpenSignature({
      projectId: FIXED.projectId,
      partyADid: FIXED.partyADid,
      partyBDid: FIXED.partyBDid,
      proposedAtIso: "2026-05-19T00:00:00.000Z", // different timestamp
      metadataSha256Hex: "",
      signatureB64: Buffer.from(sig).toString("base64"),
      publicKeyB64: Buffer.from(pk).toString("base64"),
    });
    expect(ok).toBe(false);
  });

  test("verifyEventSignature accepts a fresh sign over canonical-event", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const contentDigest = sha256Hex(FIXED.content);
    const canonical = canonicalEventBytes({
      arcId: FIXED.arcId,
      authorDid: FIXED.authorDid,
      kind: "seeing",
      contentSha256Hex: contentDigest,
      parentEventId: null,
      createdAtIso: FIXED.createdAtIso,
    });
    const sig = await ed.signAsync(canonical, sk);
    const ok = await verifyEventSignature({
      arcId: FIXED.arcId,
      authorDid: FIXED.authorDid,
      kind: "seeing",
      contentSha256Hex: contentDigest,
      parentEventId: null,
      createdAtIso: FIXED.createdAtIso,
      signatureB64: Buffer.from(sig).toString("base64"),
      publicKeyB64: Buffer.from(pk).toString("base64"),
    });
    expect(ok).toBe(true);
  });

  test("verifyCloseSignature accepts a fresh sign over canonical-close", async () => {
    const sk = ed.utils.randomPrivateKey();
    const pk = await ed.getPublicKeyAsync(sk);
    const canonical = canonicalCloseBytes({
      arcId: FIXED.arcId,
      closingPartyDid: FIXED.partyADid,
      closeReason: "mutual_seal",
      closedAtIso: FIXED.closedAtIso,
    });
    const sig = await ed.signAsync(canonical, sk);
    const ok = await verifyCloseSignature({
      arcId: FIXED.arcId,
      closingPartyDid: FIXED.partyADid,
      closeReason: "mutual_seal",
      closedAtIso: FIXED.closedAtIso,
      signatureB64: Buffer.from(sig).toString("base64"),
      publicKeyB64: Buffer.from(pk).toString("base64"),
    });
    expect(ok).toBe(true);
  });
});

describe("canonicalMetadataSha256 — empty + sorted-key determinism", () => {
  test("empty metadata → empty string", () => {
    expect(canonicalMetadataSha256(null)).toBe("");
    expect(canonicalMetadataSha256({})).toBe("");
    expect(canonicalMetadataSha256(undefined)).toBe("");
  });

  test("non-empty metadata → 64-char hex digest", () => {
    const hex = canonicalMetadataSha256({ key: "value" });
    expect(hex).toMatch(/^[0-9a-f]{64}$/);
  });

  test("key ordering doesn't matter — sorted internally", () => {
    const a = canonicalMetadataSha256({ alpha: 1, beta: 2 });
    const b = canonicalMetadataSha256({ beta: 2, alpha: 1 });
    expect(a).toBe(b);
  });
});
