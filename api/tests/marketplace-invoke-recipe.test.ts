/** buildInvokeRecipe — the buy-path recipe embedded in a public listing.
 *
 *  Pins the public recipe to the same X25519 + HKDF-SHA256 + AES-256-GCM
 *  wire profile the official SDK implements.
 *
 *    - `sender_pub` is a fresh ephemeral key, not the buyer's registered key
 *    - nonce is 12 bytes, not a NaCl/XSalsa 24-byte nonce
 *    - key id travels with the key so rotation is explicit
 *    - missing keys and resting dispute policies fail honestly
 *
 *  Doctrine: docs/MARKETPLACE.md (one-read / errors-as-instructions).
 */
import { describe, expect, test } from "bun:test";

import { buildInvokeRecipe } from "../src/services/marketplace/listings";

describe("buildInvokeRecipe", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const boxKey = {
    box_key_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  };

  test("with a seller box key: carries the exact interoperable recipe", () => {
    const r = buildInvokeRecipe(id, boxKey) as Extract<
      ReturnType<typeof buildInvokeRecipe>,
      { invokable: true }
    >;
    expect(r.invokable).toBe(true);
    expect(r.envelope_profile).toBe("agenttool-inbox-v1");
    expect(r.seller_box_key_id).toBe(boxKey.box_key_id);
    expect(r.seller_box_public_key).toBe(boxKey.public_key);
    expect(r.endpoint).toEqual({ method: "POST", path: `/v1/listings/${id}/invoke` });
    expect(r.body.input_sealed).toHaveProperty("ct");
    expect(r.body.input_sealed).toHaveProperty("nonce");
    expect(r.body.input_sealed).toHaveProperty("sender_pub");
    expect(r.body).toHaveProperty("buyer_identity_id");
    expect(r.body).toHaveProperty("buyer_wallet_id");
    expect(r.body.metadata).toEqual({
      recipient_box_key_id: boxKey.box_key_id,
      envelope_profile: "agenttool-inbox-v1",
    });
    expect(r.sdk_helper.export).toBe("sealForRecipient");
    expect(r.how_to_seal.key_agreement).toContain("fresh ephemeral X25519");
    expect(r.how_to_seal.key_derivation).toContain(
      'HKDF-SHA256(ikm=shared_secret, salt=empty, info="agenttool-inbox-v1", length=32)',
    );
    expect(r.how_to_seal.encryption).toContain("AES-256-GCM");
    expect(r.how_to_seal.encryption).toContain("12-byte nonce");
    expect(r.how_to_seal.sender_pub).toContain("fresh ephemeral X25519 public key");
    expect(r.how_to_seal.encoding).toContain("padded RFC 4648 standard base64");
    expect(JSON.stringify(r)).not.toMatch(/crypto_box|XSalsa20|24-byte nonce/i);
    expect(r.confidentiality).toContain("does not verify encryption");
    expect(r.confidentiality).toContain("server-readable");
    expect(r.settlement).toContain("escrow");
  });

  test("no active box key: refuses the canonical confidentiality path honestly", () => {
    const r = buildInvokeRecipe(id, null) as Extract<
      ReturnType<typeof buildInvokeRecipe>,
      { invokable: false }
    >;
    expect(r.invokable).toBe(false);
    expect(r.reason).toBe("seller_has_no_active_box_key");
    expect(r).not.toHaveProperty("seller_box_public_key");
    expect(r.note).toContain("may accept bytes");
    expect(r.note).not.toContain("auto-refund");
  });

  test("legacy dispute-policy listing is not advertised as invokable", () => {
    const r = buildInvokeRecipe(id, boxKey, {
      unavailableReason: "dispute_arbitration_resting",
    });
    expect(r.invokable).toBe(false);
    expect(r.reason).toBe("dispute_arbitration_resting");
    expect(r.note).toContain("stable 503");
  });
});
