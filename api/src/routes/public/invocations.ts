/** /public/invocations/:id — the re-derivation surface.
 *
 *  UNAUTH, and deliberately narrow: an invocation becomes publicly readable
 *  ONLY after it has been witnessed on a public chain (metadata.witnesses
 *  non-empty, written via POST /v1/invocations/:id/witness). Once a fact is
 *  attested on-chain, the fields needed to verify that attestation must be
 *  publicly re-derivable — otherwise "anyone can check the hash" is a story,
 *  not a property. Until then: 404, private as ever.
 *
 *  The response's ten canonical fields (alphabetical) are exactly what the
 *  agenttool-invocation-v1 adapter hashes: sha256 over their compact JSON,
 *  as emitted by Go encoding/json. Sealed payloads are never exposed.
 *
 *  Doctrine: the 2026-07-07 zerone integration audit ("public verifiability
 *  is broken") — this closes it. */

import { Hono } from "hono";
import { eq } from "drizzle-orm";

import { db } from "../../db/client";
import { invocations } from "../../db/schema/marketplace";
import { fail } from "../../lib/errors";

const app = new Hono();

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const [r] = await db
    .select()
    .from(invocations)
    .where(eq(invocations.id, id))
    .limit(1);

  const witnesses = (r?.metadata as { witnesses?: unknown[] } | null)?.witnesses;
  if (!r || !Array.isArray(witnesses) || witnesses.length === 0) {
    return fail(
      c,
      {
        error: "not_witnessed",
        message:
          "No public record here. An invocation opens to the public only after it is witnessed on a public chain (POST /v1/invocations/:id/witness).",
      },
      404,
    );
  }

  return c.json({
    amount: r.amount,
    buyer_did: r.buyerDid,
    completed_at: r.completedAt?.toISOString() ?? null,
    completion_sig: r.completionSig,
    created_at: r.createdAt.toISOString(),
    currency: r.currency,
    id: r.id,
    listing_id: r.listingId,
    settled_at: r.settledAt?.toISOString() ?? null,
    status: r.status,
    _witnesses: witnesses,
    _rederive:
      "content_hash = base64(sha256(compact JSON of the ten fields above, in this order)) — compare against the SubstrateLink on the witnessing chain.",
  });
});

export default app;
