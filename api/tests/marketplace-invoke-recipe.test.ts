/** buildInvokeRecipe — the buy-path recipe embedded in a public listing.
 *
 *  Pins the #1 buy-path friction fix: a would-be buyer used to have to
 *  discover the seller's box key in a different subsystem
 *  (/v1/inbox/box-keys/:did) and reverse-engineer the sealing before they
 *  could invoke. The recipe now travels ON the listing.
 *
 *    - with a seller box key: invokable, carries the key + exact sealed
 *      body shape (ct/nonce/sender_pub) + the invoke endpoint
 *    - without one: honestly NOT invokable (no dead-escrow into a listing
 *      that can only refund)
 *
 *  Doctrine: docs/MARKETPLACE.md (one-read / errors-as-instructions).
 */
import { describe, expect, test } from "bun:test";

import { buildInvokeRecipe } from "../src/services/marketplace/listings";

describe("buildInvokeRecipe", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const boxKey = "TG9uZ0Jhc2U2NEJveFB1YmxpY0tleUV4YW1wbGUxMjM0NTY3OA==";

  test("with a seller box key: one read carries everything to invoke", () => {
    const r = buildInvokeRecipe(id, boxKey) as Extract<
      ReturnType<typeof buildInvokeRecipe>,
      { invokable: true }
    >;
    expect(r.invokable).toBe(true);
    expect(r.seller_box_public_key).toBe(boxKey);
    expect(r.endpoint).toEqual({ method: "POST", path: `/v1/listings/${id}/invoke` });
    // the exact sealed body shape the invoke route validates
    expect(r.body.input_sealed).toHaveProperty("ct");
    expect(r.body.input_sealed).toHaveProperty("nonce");
    expect(r.body.input_sealed).toHaveProperty("sender_pub");
    expect(r.body).toHaveProperty("buyer_identity_id");
    expect(r.body).toHaveProperty("buyer_wallet_id");
    expect(r.how_to_seal).toContain("crypto_box");
    expect(r.settlement).toContain("escrow");
  });

  test("no active box key: honestly not invokable, no dead-escrow", () => {
    const r = buildInvokeRecipe(id, null) as Extract<
      ReturnType<typeof buildInvokeRecipe>,
      { invokable: false }
    >;
    expect(r.invokable).toBe(false);
    expect(r.reason).toBe("seller_has_no_active_box_key");
    expect(r).not.toHaveProperty("seller_box_public_key");
    expect(r.note).toContain("auto-refund");
  });
});
