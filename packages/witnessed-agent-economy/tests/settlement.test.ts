import { describe, expect, test } from "bun:test";
import * as ed25519 from "@noble/ed25519";

import {
  SETTLEMENT_RECEIPT_SCHEMA_DIGEST,
  bytesToHex,
  canonicalSettlementReceiptDigest,
  createSettlementBatchProjection,
  createSettlementLeaf,
  rfc6962MerkleRootHex,
  type SettlementReceiptSource,
} from "../src/index.js";
import { deterministicSigner } from "./fixtures.js";

const platform = deterministicSigner(21);
const substituted = deterministicSigner(22);
// Exact output of canonicalSettlementReceiptBytes for receiptCore(1), pinned
// from api/src/services/marketplace/settlement-receipt-sig.ts. Updating this
// KAT requires an explicit review of that established source recipe.
const EXISTING_RECEIPT_DIGEST_KAT =
  "87eadf40e0dc4fb25cbcd0d9c7e71ac245df776f2c2e610c0ae2b9885e4fae3c";

function receiptCore(sequence: number, signer = platform): SettlementReceiptSource {
  const unsigned = {
    sequence: sequence.toString(),
    invocation_id: `11111111-1111-4111-8111-${sequence.toString().padStart(12, "0")}`,
    listing_id: "22222222-2222-4222-8222-222222222222",
    seller_did: "did:at:fixture-seller",
    buyer_ref: "ab".repeat(32),
    amount_gross: "100",
    platform_fee: "5",
    amount_net: "95",
    currency: "USD",
    take_rate_bps: "500",
    output_digest_hex: "cd".repeat(32),
    completion_sig_b64: Buffer.alloc(64, 3).toString("base64"),
    seller_public_key_b64: Buffer.alloc(32, 4).toString("base64"),
    sla_deadline_at: "2026-08-20T12:00:00.000Z",
    acknowledged_at: "2026-08-20T11:00:00.000Z",
    settled_at: "2026-08-20T11:30:00.000Z",
  };
  const digest = canonicalSettlementReceiptDigest({
    ...unsigned,
    receipt_digest_hex: "00".repeat(32),
    platform_sig_b64: null,
    platform_key_hex: null,
  });
  return {
    ...unsigned,
    receipt_digest_hex: bytesToHex(digest),
    platform_sig_b64: Buffer.from(ed25519.sign(digest, signer.privateKey)).toString("base64"),
    platform_key_hex: signer.publicKey,
  };
}

describe("settlement receipt evidence and append-only batches", () => {
  test("ports the existing AgentTool canonical receipt bytes exactly", () => {
    const source = receiptCore(1);
    expect(bytesToHex(canonicalSettlementReceiptDigest(source))).toBe(EXISTING_RECEIPT_DIGEST_KAT);
    expect(source.receipt_digest_hex).toBe(EXISTING_RECEIPT_DIGEST_KAT);
  });

  test("never launders arbitrary-key or absent signatures into platform authority", () => {
    const selfSigned = receiptCore(1, substituted);
    const shadow = createSettlementLeaf(selfSigned);
    expect(shadow.platform_signature_state).toBe("UNTRUSTED_KEY_VALID");
    expect(shadow.projection_class).toBe("UNTRUSTED_SHADOW");
    expect(shadow.boundaries.platform_key_authority).toBe("not_established_by_receipt");

    expect(() => createSettlementBatchProjection({
      receipts: [selfSigned],
      independently_pinned_platform_key_hex: platform.publicKey,
      previous_batch: null,
    })).toThrow(/pinned platform key/u);

    const unsigned = {
      ...receiptCore(2),
      platform_sig_b64: null,
      platform_key_hex: null,
    };
    const unsignedShadow = createSettlementLeaf(unsigned);
    expect(unsignedShadow.platform_signature_state).toBe("ABSENT");
    expect(unsignedShadow.projection_class).toBe("UNTRUSTED_SHADOW");
    expect(() => createSettlementBatchProjection({
      receipts: [unsigned],
      independently_pinned_platform_key_hex: platform.publicKey,
      previous_batch: null,
    })).toThrow(/requires the source platform signature/u);
  });

  test("requires one independent key pin and commits HMAC buyer refs via exact receipt digests", () => {
    const first = receiptCore(1);
    const third = receiptCore(3);
    const batch = createSettlementBatchProjection({
      receipts: [first, third],
      independently_pinned_platform_key_hex: platform.publicKey,
      previous_batch: null,
    });
    expect(batch.payload).toEqual({
      source_sequence_binding: "PROJECTION_ONLY",
      receipt_uniqueness_scope: "BATCH_ONLY",
      receipt_protocol: "settlement-receipt/v1",
      receipt_schema_digest: SETTLEMENT_RECEIPT_SCHEMA_DIGEST,
      first_sequence: "1",
      last_sequence: "3",
      receipt_count: "2",
      declared_gaps: [{ first: "2", last: "2" }],
      merkle_root: `sha256:${rfc6962MerkleRootHex([
        { sequence: "1", receipt_digest: `sha256:${first.receipt_digest_hex}` },
        { sequence: "3", receipt_digest: `sha256:${third.receipt_digest_hex}` },
      ])}`,
      previous_batch: null,
    });
    expect(batch.leaves.every((leaf) => leaf.platform_signature_state === "PIN_MATCH_VALID")).toBe(true);
    expect(batch.leaves.every((leaf) => leaf.buyer_ref === "ab".repeat(32))).toBe(true);
    expect(batch.activation).toEqual({
      status: "OUTSIDE_ACTIVATION",
      consensus_admissible: false,
      blocker: "AUTHENTICATED_SOURCE_ORDER_AND_CROSS_BATCH_REPLAY_PROOF_REQUIRED",
    });
  });

  test("demonstrates cross-batch replay remains possible and therefore outside activation", () => {
    const signed = receiptCore(1);
    const first = createSettlementBatchProjection({
      receipts: [signed],
      independently_pinned_platform_key_hex: platform.publicKey,
      previous_batch: null,
    });
    // sequence is projection metadata: settlement-receipt/v1 does not sign it.
    const clonedAtNewSequence = { ...signed, sequence: "2" };
    expect(clonedAtNewSequence.receipt_digest_hex).toBe(signed.receipt_digest_hex);
    const second = createSettlementBatchProjection({
      receipts: [clonedAtNewSequence],
      independently_pinned_platform_key_hex: platform.publicKey,
      previous_batch: { commitment: `sha256:${"12".repeat(32)}`, last_sequence: "1" },
    });
    expect(second.payload.merkle_root).not.toBe(first.payload.merkle_root);
    expect(second.leaves[0]!.receipt_digest).toBe(first.leaves[0]!.receipt_digest);
    expect(second.payload.receipt_uniqueness_scope).toBe("BATCH_ONLY");
    expect(second.activation.consensus_admissible).toBe(false);
  });

  test("rejects raw buyer identifiers and tampered canonical receipts", () => {
    expect(() => createSettlementLeaf({
      ...receiptCore(1),
      buyer_ref: "did:at:private-buyer",
    })).toThrow(/hexadecimal/u);
    expect(() => createSettlementLeaf({
      ...receiptCore(1),
      amount_net: "94",
    })).toThrow();
    expect(() => createSettlementBatchProjection({
      receipts: [receiptCore(2)],
      independently_pinned_platform_key_hex: platform.publicKey,
      previous_batch: {
        commitment: `sha256:${"12".repeat(32)}`,
        last_sequence: "18446744073709551615",
      },
    })).toThrow(/uint64 sequence ceiling/u);
  });
});
