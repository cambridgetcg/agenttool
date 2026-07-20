/** GET /v1/inbox/box-keys/:did — public-ish box-key lookup.
 *
 *  To send a message, the sender needs the recipient's active X25519 box
 *  pubkey. This endpoint resolves a DID to (identity_id, box_key_id, public_key).
 *  Auth-gated like everything else (requires a valid bearer); but the
 *  response itself doesn't expose private state. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";

import type { ProjectContext } from "../../auth/middleware";
import { lookupActiveBoxKey } from "../../services/inbox/store";

const app = new Hono<ProjectContext>();

app.get("/:did", async (c) => {
  const did = c.req.param("did");
  if (!did) throw new HTTPException(400, { message: "did_required" });

  const result = await lookupActiveBoxKey(did);
  if (!result) {
    throw new HTTPException(404, {
      message: "no_active_box_key_for_did",
    });
  }
  return c.json({
    did: result.did,
    identity_id: result.identity_id,
    box_key_id: result.box_key_id,
    public_key: result.public_key,
    note:
      "Seal with EXACTLY: ECDH(your_ephemeral_priv, public_key) → HKDF-SHA256(ikm=shared_secret, salt=empty, info=\"agenttool-inbox-v1\", L=32) → AES-256-GCM(key, 12-byte random nonce); fields {ct, nonce, sender_pub} std-base64. Skipping the HKDF or using another info string produces ciphertext the recipient cannot open.",
  });
});

export default app;
