/** buildCompleteRecipe — the earn-path recipe embedded in a seller's queue.
 *
 *  The twin of marketplace-invoke-recipe.test.ts. A buyer reading one public
 *  listing has always had the whole wire profile; a seller reading their own
 *  queue had to rediscover it from error strings. These pin the other half.
 *
 *    - the buyer's recipient key travels with the row, so no seller needs to
 *      know that GET /v1/inbox/box-keys/{did} exists
 *    - acknowledge-then-complete ordering is stated, not inferred from a 409
 *    - the documented preimage is asserted byte-equal to the real signer, so
 *      the instructions can never drift away from the code they describe
 *    - missing keys and terminal states fail honestly
 *
 *  Doctrine: docs/MARKETPLACE.md (one-read / errors-as-instructions).
 */
import { describe, expect, test } from "bun:test";
import { sha256 } from "@noble/hashes/sha2.js";

import { buildCompleteRecipe } from "../src/services/marketplace/listings";
import { canonicalInvocationCompletionBytes } from "../src/services/marketplace/sig";

type Open = Extract<ReturnType<typeof buildCompleteRecipe>, { completable: true }>;

describe("buildCompleteRecipe", () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const boxKey = {
    box_key_id: "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
    public_key: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
  };

  test("acknowledged: carries the exact interoperable recipe", () => {
    const r = buildCompleteRecipe(id, "acknowledged", boxKey) as Open;
    expect(r.completable).toBe(true);
    expect(r.envelope_profile).toBe("agenttool-inbox-v1");
    expect(r.buyer_box_key_id).toBe(boxKey.box_key_id);
    expect(r.buyer_box_public_key).toBe(boxKey.public_key);
    expect(r.next_step).toBe("complete");
    expect(r.endpoint).toEqual({
      method: "POST",
      path: `/v1/invocations/${id}/complete`,
    });
    expect(r.body.output_sealed).toHaveProperty("ct");
    expect(r.body.output_sealed).toHaveProperty("nonce");
    expect(r.body.output_sealed).toHaveProperty("sender_pub");
    expect(r.body).toHaveProperty("signature");
    expect(r.sdk_helper.export).toBe("sealForRecipient");
    expect(r.sdk_helper.output_mapping.ciphertextB64).toBe("output_sealed.ct");
  });

  test("escrowed: names the acknowledge step first, and the completion after", () => {
    const r = buildCompleteRecipe(id, "escrowed", boxKey) as Open;
    expect(r.next_step).toBe("acknowledge_first");
    expect(r.endpoint.path).toBe(`/v1/invocations/${id}/acknowledge`);
    expect(r.endpoint).toHaveProperty("then");
  });

  test("the two body keys are the only body keys", () => {
    const r = buildCompleteRecipe(id, "acknowledged", boxKey) as Open;
    expect(Object.keys(r.body).sort()).toEqual(["output_sealed", "signature"]);
    expect(Object.keys(r.body.output_sealed).sort()).toEqual([
      "ct",
      "nonce",
      "sender_pub",
    ]);
    expect(r.body_note).toContain("path parameter");
  });

  test("the signing instructions state the two things that actually fail first", () => {
    const r = buildCompleteRecipe(id, "acknowledged", boxKey) as Open;
    expect(r.how_to_sign.domain).toBe("invocation-completion/v1");
    expect(r.how_to_sign.raw_bytes_not_base64).toContain("RAW DECODED");
    expect(r.how_to_sign.sign_the_digest).toContain("DIGEST");
    expect(r.how_to_sign.separator).toContain("None leading, none trailing");
    expect(r.how_to_sign.shape_gates).toContain("32 bytes");
  });

  /** The anti-drift test. Rebuild the preimage from the recipe's own written
   *  description and assert it equals what the real signer produces. If anyone
   *  edits the byte layout without editing the instructions — or the reverse —
   *  this fails, which is the whole point of shipping instructions at all. */
  test("the documented preimage is byte-equal to canonicalInvocationCompletionBytes", () => {
    const output = {
      ct: Buffer.from("sealed-deliverable-bytes").toString("base64"),
      nonce: Buffer.from(new Uint8Array(12).fill(7)).toString("base64"),
      sender_pub: Buffer.from(new Uint8Array(32).fill(9)).toString("base64"),
    };

    // Built strictly by following how_to_sign, as a stranger would read it:
    // domain, then one 0x00 between fields, none leading, none trailing, with
    // ct/nonce/sender_pub as raw decoded bytes rather than their base64 text.
    const SEP = Buffer.from([0]);
    const preimage = Buffer.concat([
      Buffer.from("invocation-completion/v1", "utf8"), SEP,
      Buffer.from(id, "utf8"), SEP,
      Buffer.from(output.ct, "base64"), SEP,
      Buffer.from(output.nonce, "base64"), SEP,
      Buffer.from(output.sender_pub, "base64"),
    ]);
    const documented = Buffer.from(sha256(preimage));
    const actual = Buffer.from(
      canonicalInvocationCompletionBytes({ invocationId: id, output }),
    );

    expect(documented.toString("hex")).toBe(actual.toString("hex"));
    expect(actual.length).toBe(32);
  });

  test("a deadline warns that completing late refunds the buyer instead", () => {
    const withSla = buildCompleteRecipe(id, "acknowledged", boxKey, {
      slaDeadlineAt: "2026-07-25T20:00:00.000Z",
    }) as Open;
    expect(withSla.sla_deadline_at).toBe("2026-07-25T20:00:00.000Z");
    expect(withSla.sla_warning).toContain("REFUNDS the buyer");

    const withoutSla = buildCompleteRecipe(id, "acknowledged", boxKey) as Open;
    expect(withoutSla.sla_deadline_at).toBeNull();
    // No deadline is not a free pass: it is the buyer who loses their exit.
    expect(withoutSla.sla_warning).toContain("no exit from 'acknowledged'");
  });

  test("no buyer box key: refuses honestly rather than inviting a fake seal", () => {
    const r = buildCompleteRecipe(id, "acknowledged", null);
    expect(r.completable).toBe(false);
    expect(r).toHaveProperty("reason", "buyer_has_no_active_box_key");
    expect((r as { note: string }).note).toContain("Decline the invocation");
  });

  test("terminal states are not completable", () => {
    for (const status of ["released", "refunded", "disputed"]) {
      const r = buildCompleteRecipe(id, status, boxKey);
      expect(r.completable).toBe(false);
      expect(r).toHaveProperty("reason", "invocation_not_open");
      expect((r as { note: string }).note).toContain(status);
    }
  });
});
