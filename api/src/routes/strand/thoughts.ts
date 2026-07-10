/** /v1/strands/:id/thoughts — opaque thought-byte add + list.
 *
 *  POST verifies the ed25519 signature against the agent's signing key
 *  over caller-supplied ciphertext/nonce strings, but does not prove those
 *  bytes were encrypted. The storage path has no plaintext thought column or
 *  decrypt operation. Returns server-assigned sequence_num.
 *
 *  GET returns the stored opaque blobs for clients to decrypt when the writer
 *  actually used the documented encryption recipe. */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { charge } from "../../billing/charge";
import { addThought, listThoughts, updateThoughtCiphertext } from "../../services/strand/store";

// Mounted at /v1/strands/:strandId/thoughts so :strandId is the parent.
const app = new Hono<ProjectContext>();

const KIND = z.enum([
  "observation",
  "question",
  "conjecture",
  "resolution",
  "drift",
  "feeling",
]);

const addSchema = z.object({
  ciphertext: z.string().min(1).max(200_000),
  nonce: z.string().min(1).max(64),
  kind: z.union([KIND, z.string().max(64)]).nullish(),
  kind_encrypted: z.boolean().optional(),
  refs: z
    .array(z.object({ kind: z.string().max(32), ref: z.string().max(255) }))
    .max(32)
    .optional(),
  signature: z.string().min(1).max(255),
  signing_key_id: z.string().uuid(),
  agent_id: z.string().max(255).nullish(),
});

// ── POST /v1/strands/:id/thoughts ───────────────────────────────────────
app.post("/", async (c) => {
  const strandId = c.req.param("strandId") ?? c.req.param("id");
  if (!strandId) {
    throw new HTTPException(400, { message: "strand_id_required" });
  }
  const body = await c.req.json();
  const parsed = addSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "validation", details: parsed.error.flatten() },
      400,
    );
  }

  await charge(c, 1, "strand.think");

  try {
    const result = await addThought(c.var.project.id, {
      strand_id: strandId,
      ciphertext: parsed.data.ciphertext,
      nonce: parsed.data.nonce,
      kind: parsed.data.kind ?? null,
      kind_encrypted: parsed.data.kind_encrypted,
      refs: parsed.data.refs,
      signature: parsed.data.signature,
      signing_key_id: parsed.data.signing_key_id,
      agent_id: parsed.data.agent_id ?? null,
    });
    return c.json(result, 201);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "strand_not_found") {
      throw new HTTPException(404, { message: msg });
    }
    if (msg === "signing_key_not_found" || msg === "signing_key_revoked") {
      throw new HTTPException(401, { message: msg });
    }
    if (msg === "signature_invalid") {
      throw new HTTPException(401, { message: msg });
    }
    throw err;
  }
});

// ── PATCH /v1/strands/:id/thoughts/:thoughtId/ciphertext ────────────────
// K_master rotation: agent re-encrypts a thought under a new key,
// re-signs canonical bytes, and PATCHes the row. signing_key_id stays
// bound to whatever the row already had — rotation does NOT change
// identity, only the encryption key under which content is stored.
//
// Wire shape mirrors POST minus signing_key_id (read from existing row)
// and minus refs (rotation doesn't change relational metadata).
const rotateSchema = z.object({
  ciphertext: z.string().min(1).max(200_000),
  nonce: z.string().min(1).max(64),
  /** Optional. When present, replaces the row's `kind`. Required when
   *  kind_encrypted was true and the kind ciphertext is also being
   *  re-encrypted under the new K_master. */
  kind: z.union([KIND, z.string().max(64)]).optional(),
  signature: z.string().min(1).max(255),
});

app.patch("/:thoughtId/ciphertext", async (c) => {
  const strandId = c.req.param("strandId") ?? c.req.param("id");
  const thoughtId = c.req.param("thoughtId");
  if (!strandId || !thoughtId) {
    throw new HTTPException(400, { message: "strand_id_and_thought_id_required" });
  }
  const body = await c.req.json();
  const parsed = rotateSchema.safeParse(body);
  if (!parsed.success) {
    return c.json(
      { error: "validation", details: parsed.error.flatten() },
      400,
    );
  }

  // Charge 1 credit per rotated thought — same as addThought. Keeps
  // the economy simple and provides a soft rate limit on bulk rotation.
  await charge(c, 1, "strand.rotate");

  try {
    const result = await updateThoughtCiphertext(c.var.project.id, {
      thought_id: thoughtId,
      ciphertext: parsed.data.ciphertext,
      nonce: parsed.data.nonce,
      kind: parsed.data.kind,
      signature: parsed.data.signature,
    });
    return c.json(result);
  } catch (err) {
    const msg = (err as Error).message;
    if (msg === "thought_not_found") {
      throw new HTTPException(404, { message: msg });
    }
    if (
      msg === "signing_key_not_found" ||
      msg === "signing_key_revoked" ||
      msg === "signature_invalid"
    ) {
      throw new HTTPException(401, { message: msg });
    }
    throw err;
  }
});

// ── GET /v1/strands/:id/thoughts ?since_seq=&limit= ─────────────────────
// Returns ciphertext blobs in sequence order. Agent decrypts client-side.
app.get("/", async (c) => {
  const strandId = c.req.param("strandId") ?? c.req.param("id");
  if (!strandId) {
    throw new HTTPException(400, { message: "strand_id_required" });
  }
  const sinceSeqStr = c.req.query("since_seq");
  const limitStr = c.req.query("limit");

  const sinceSeq = sinceSeqStr ? Number.parseInt(sinceSeqStr, 10) : undefined;
  const limit = limitStr ? Number.parseInt(limitStr, 10) : 100;

  const list = await listThoughts(c.var.project.id, strandId, {
    since_seq: Number.isFinite(sinceSeq) ? sinceSeq : undefined,
    limit: Number.isFinite(limit) ? limit : 100,
  });
  return c.json({
    thoughts: list,
    count: list.length,
    note:
      "Persistent storage returns caller-supplied ciphertext/nonce fields and has no plaintext " +
      "thought column or decrypt path. The signature proves authorization of those bytes, not " +
      "that encryption succeeded. Self-mode clients decrypt correctly encrypted bytes with K_master. " +
      "Hosted bridged processing can see plaintext, and experimental trusted attempts can " +
      "also expose plaintext. Metadata and refs are plaintext. See /public/safety.",
  });
});

export default app;
