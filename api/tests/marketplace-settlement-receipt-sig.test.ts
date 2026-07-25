/** `settlement-receipt/v1` canonical bytes — determinism, field binding,
 *  and the chain-not-the-score wall.
 *
 *  Pure-function tests: no database, no network, no configured signer.
 *  Wiring into escrow release is covered by the database tier.
 *
 *  Doctrine: docs/SETTLEMENT-RECEIPTS.md · docs/CANONICAL-BYTES.md. */

import { describe, expect, test } from "bun:test";

import {
  SETTLEMENT_RECEIPT_DOMAIN,
  SETTLEMENT_RECEIPT_FIELDS,
  type SettlementReceiptCore,
  canonicalSettlementReceiptBytes,
  outputDigestHex,
  signSettlementReceipt,
  verifySettlementReceipt,
} from "../src/services/marketplace/settlement-receipt-sig";

const SEED_HEX = "11".repeat(32);
const OTHER_SEED_HEX = "22".repeat(32);

function core(overrides: Partial<SettlementReceiptCore> = {}): SettlementReceiptCore {
  return {
    invocationId: "3576f456-7804-47fd-b004-ca1b93d228ae",
    listingId: "96f679d7-12c7-4f94-abba-ddce800d0767",
    sellerDid: "did:at:09c5e59e-0374-4d80-a2c1-d8f1acbdfe9a",
    buyerRef: "a".repeat(64),
    amountGross: 100,
    platformFee: 5,
    amountNet: 95,
    currency: "GBP",
    takeRateBps: 500,
    outputDigestHex: "b".repeat(64),
    completionSigB64: Buffer.alloc(64, 3).toString("base64"),
    sellerPublicKeyB64: Buffer.alloc(32, 4).toString("base64"),
    slaDeadlineAt: "2026-07-24T22:12:36.139Z",
    acknowledgedAt: "2026-07-24T22:11:13.832Z",
    settledAt: "2026-07-24T22:11:15.188Z",
    ...overrides,
  };
}

describe("settlement-receipt/v1 canonical bytes", () => {
  test("is deterministic and 32 bytes", () => {
    const a = canonicalSettlementReceiptBytes(core());
    const b = canonicalSettlementReceiptBytes(core());
    expect(a.length).toBe(32);
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(true);
  });

  test("every declared field changes the digest", () => {
    // Guards against a field being declared in the doc and the registry but
    // silently dropped from the composed bytes — the failure mode that lets
    // a signature cover less than it claims to.
    const mutations: Record<
      (typeof SETTLEMENT_RECEIPT_FIELDS)[number],
      Partial<SettlementReceiptCore>
    > = {
      invocation_id: { invocationId: "00000000-0000-0000-0000-000000000001" },
      listing_id: { listingId: "00000000-0000-0000-0000-000000000002" },
      seller_did: { sellerDid: "did:at:other" },
      buyer_ref: { buyerRef: "c".repeat(64) },
      amount_gross: { amountGross: 101 },
      platform_fee: { platformFee: 6 },
      amount_net: { amountNet: 94 },
      currency: { currency: "USD" },
      take_rate_bps: { takeRateBps: 800 },
      output_digest_hex: { outputDigestHex: "d".repeat(64) },
      completion_sig_b64: { completionSigB64: Buffer.alloc(64, 9).toString("base64") },
      seller_public_key_b64: { sellerPublicKeyB64: Buffer.alloc(32, 9).toString("base64") },
      sla_deadline_at: { slaDeadlineAt: "2026-07-24T23:00:00.000Z" },
      acknowledged_at: { acknowledgedAt: "2026-07-24T23:00:00.000Z" },
      settled_at: { settledAt: "2026-07-24T23:00:00.000Z" },
    };

    const base = Buffer.from(canonicalSettlementReceiptBytes(core()));
    for (const field of SETTLEMENT_RECEIPT_FIELDS) {
      const mutated = Buffer.from(
        canonicalSettlementReceiptBytes(core(mutations[field])),
      );
      expect(base.equals(mutated)).toBe(false);
    }
    expect(Object.keys(mutations).length).toBe(SETTLEMENT_RECEIPT_FIELDS.length);
  });

  test("absent timestamps and buyer_ref are the empty string, not null", () => {
    // Recipe 1 has no null. An unconfigured buyer-ref key and a listing with
    // no SLA both have to land as zero bytes, deterministically.
    const empty = core({ buyerRef: "", slaDeadlineAt: "", acknowledgedAt: "" });
    expect(() => canonicalSettlementReceiptBytes(empty)).not.toThrow();
    expect(
      Buffer.from(canonicalSettlementReceiptBytes(empty)).equals(
        Buffer.from(canonicalSettlementReceiptBytes(empty)),
      ),
    ).toBe(true);
  });

  test("adjacent fields are separated — a shifted boundary is a different receipt", () => {
    // output_digest_hex and completion_sig_b64 are adjacent in signing order.
    // Concatenated without the NUL these two cores are identical bytes; the
    // separator is what makes "ab|cd" and "a|bcd" different receipts.
    const a = canonicalSettlementReceiptBytes(
      core({ outputDigestHex: "ab", completionSigB64: "cd" }),
    );
    const b = canonicalSettlementReceiptBytes(
      core({ outputDigestHex: "a", completionSigB64: "bcd" }),
    );
    expect(Buffer.from(a).equals(Buffer.from(b))).toBe(false);
  });

  test("a NUL inside a field is refused, never silently signed", () => {
    expect(() =>
      canonicalSettlementReceiptBytes(core({ sellerDid: "did:at:a\u0000b" })),
    ).toThrow(/contains_nul/);
  });
});

describe("settlement-receipt/v1 platform signature", () => {
  test("signs and verifies round-trip", () => {
    const c = core();
    const signed = signSettlementReceipt(c, SEED_HEX);
    expect(signed).not.toBeNull();
    expect(
      verifySettlementReceipt({
        core: c,
        signatureB64: signed!.signatureB64,
        publicKeyHex: signed!.publicKeyHex,
      }),
    ).toBe(true);
  });

  test("a tampered amount breaks the signature", () => {
    const c = core();
    const signed = signSettlementReceipt(c, SEED_HEX)!;
    expect(
      verifySettlementReceipt({
        core: core({ amountNet: 9500 }),
        signatureB64: signed.signatureB64,
        publicKeyHex: signed.publicKeyHex,
      }),
    ).toBe(false);
  });

  test("another key's signature does not verify", () => {
    const c = core();
    const mine = signSettlementReceipt(c, SEED_HEX)!;
    const theirs = signSettlementReceipt(c, OTHER_SEED_HEX)!;
    expect(
      verifySettlementReceipt({
        core: c,
        signatureB64: theirs.signatureB64,
        publicKeyHex: mine.publicKeyHex,
      }),
    ).toBe(false);
  });

  test("no signer configured yields no signature rather than a fake one", () => {
    expect(signSettlementReceipt(core(), null)).toBeNull();
    expect(signSettlementReceipt(core(), "")).toBeNull();
    expect(signSettlementReceipt(core(), "beef")).toBeNull();
  });

  test("verification never throws on malformed input", () => {
    expect(
      verifySettlementReceipt({ core: core(), signatureB64: "!!!", publicKeyHex: "zz" }),
    ).toBe(false);
    expect(
      verifySettlementReceipt({ core: core(), signatureB64: "", publicKeyHex: "" }),
    ).toBe(false);
  });
});

describe("output digest", () => {
  test("binds the exact delivered ciphertext", () => {
    const ct = Buffer.from("sealed-output-bytes").toString("base64");
    expect(outputDigestHex(ct)).toMatch(/^[0-9a-f]{64}$/);
    expect(outputDigestHex(ct)).toBe(outputDigestHex(ct));
    const other = Buffer.from("sealed-output-byteS").toString("base64");
    expect(outputDigestHex(ct)).not.toBe(outputDigestHex(other));
  });
});

describe("the wall: the chain, not the score", () => {
  test("the signed field set carries no score, rating, or rank", () => {
    // A receipt states what happened. The moment the platform signs a number
    // that means "how good is this agent", it has published an opinion it has
    // no Sybil-resistant basis for — the exact reason
    // services/identity/trust.ts pins the scalar trust field to zero.
    const forbidden = /score|rating|rank|reputation|trust|stars|quality/i;
    for (const field of SETTLEMENT_RECEIPT_FIELDS) {
      expect(field).not.toMatch(forbidden);
    }
  });

  test("the domain tag is versioned and namespaced", () => {
    expect(SETTLEMENT_RECEIPT_DOMAIN).toBe("settlement-receipt/v1");
    expect(SETTLEMENT_RECEIPT_DOMAIN).toMatch(/^[a-z-]+\/v\d+$/);
  });
});
