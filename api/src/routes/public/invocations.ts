/** /public/invocations/:id — the re-derivation surface.
 *
 *  UNAUTH, and deliberately narrow: an invocation becomes publicly readable
 *  only when it remains released and settled and has a writer-shaped
 *  public-chain reference. New entries are accepted through authenticated
 *  POST /v1/invocations/:id/witness, but JSON shape alone cannot prove that
 *  historical metadata passed through that route. A report is not proof that
 *  the referenced transaction or attestation exists: this route does not
 *  query a chain. It exposes the fields a reader needs to retrieve that chain
 *  state and compare the content independently. Until all gates pass: 404,
 *  private as ever.
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
import { parseWitnessEntries } from "../../services/marketplace/witness";

const app = new Hono();

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const [r] = await db
    .select()
    .from(invocations)
    .where(eq(invocations.id, id))
    .limit(1);

  const storedWitnesses = (r?.metadata as { witnesses?: unknown } | null)
    ?.witnesses;
  const witnesses = parseWitnessEntries(storedWitnesses);
  if (
    !r ||
    r.status !== "released" ||
    r.settledAt === null ||
    witnesses === null ||
    witnesses.length === 0
  ) {
    return fail(
      c,
      {
        error: "not_witnessed",
        message:
          "No public record here. An invocation opens only while released and settled with a non-empty public-chain reference matching the exact shape supported by POST /v1/invocations/:id/witness; shape alone does not prove writer provenance.",
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
    _witness_notice:
      "These entries use the authenticated-party report format, but JSON shape alone is not proof of writer provenance or chain verification. Retrieve the referenced transaction and attestation from the named chain, then compare their content against the fields here.",
    _rederive:
      "content_hash = base64(sha256(compact JSON of the ten fields above, in this order)) — compare against the SubstrateLink on the witnessing chain.",
  });
});

export default app;
