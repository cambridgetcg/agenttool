/** /v1/memory-witness-listings + /v1/memory-witness-grants — witness-as-service.
 *
 *  Doctrine: docs/AGENT-CENTRIC.md §1 (third Tier-1 closure) ·
 *            docs/MEMORY-TIERS.md §asymmetry-clause · docs/MARKETPLACE.md.
 *
 *  Auth: project bearer for both listings and grants. Public unauth
 *  discovery surface ships separately at /public/memory-witness-listings.
 *
 *  Lifecycle:
 *    /v1/memory-witness-listings  POST (create) · GET (list) · GET /:id · PATCH /:id
 *    /v1/memory-witness-grants    POST (buyer-create) · GET (list) · GET /:id
 *                                  POST /:id/issue (witness) · POST /:id/decline (witness)
 *
 *  @enforces urn:agenttool:wall/witness-as-service-not-self
 *    The route surfaces refusal codes from MemoryWitnessError; the
 *    self-witness wall enforcement lives in services/marketplace/
 *    memory-witness.ts:createGrant(). Tested:
 *    api/tests/doctrine/wall-witness-as-service-not-self.test.ts */

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { errors, fail, type NextAction } from "../lib/errors";
import {
  createGrant,
  createListing,
  declineGrant,
  getGrant,
  getListing,
  issueGrant,
  listListings,
  MEMORY_WITNESS_CLAIM_KINDS,
  MemoryWitnessError,
} from "../services/marketplace/memory-witness";

// ── Schemas ──────────────────────────────────────────────────────────────

const createListingSchema = z
  .object({
    witness_identity_id: z.string().uuid(),
    name: z.string().min(1).max(255),
    description: z.string().max(2000).nullish(),
    claim_kind: z.enum(MEMORY_WITNESS_CLAIM_KINDS as unknown as [string, ...string[]]),
    capability_tags: z.array(z.string().max(64)).max(32).optional(),
    price_amount: z.number().int().positive(),
    price_currency: z.string().min(1).max(20),
    witness_wallet_id: z.string().uuid(),
    sla_seconds: z.number().int().positive().nullish(),
    visibility: z.enum(["public", "private"]).optional(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const createGrantSchema = z
  .object({
    listing_id: z.string().uuid(),
    buyer_identity_id: z.string().uuid(),
    buyer_wallet_id: z.string().uuid(),
    memory_id: z.string().uuid(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const issueGrantSchema = z
  .object({
    signature_b64: z.string().min(1),
    signing_key_id: z.string().uuid(),
  })
  .strict();

const declineGrantSchema = z
  .object({
    reason: z.string().max(500).nullish(),
  })
  .strict();

// ── Error mapping ────────────────────────────────────────────────────────

function statusFor(code: MemoryWitnessError["code"]): number {
  switch (code) {
    case "listing_not_found":
    case "grant_not_found":
    case "memory_not_found":
    case "buyer_wallet_not_found":
    case "witness_wallet_not_found":
      return 404;
    case "grant_not_pending":
    case "memory_already_constitutive":
    case "memory_must_be_foundational":
    case "listing_not_active":
      return 409;
    case "self_witness_forbidden":
    case "wrong_witness":
    case "memory_not_owned":
    case "witness_not_found_or_not_owned":
      return 403;
    case "buyer_insufficient_balance":
      return 402;
    case "buyer_wallet_currency_mismatch":
    case "witness_wallet_currency_mismatch":
    case "buyer_wallet_not_active":
    case "witness_wallet_not_active":
    case "price_amount_must_be_positive":
    case "claim_kind_unsupported":
      return 422;
    case "signing_key_not_found_or_revoked":
    case "signature_invalid":
      return 401;
    default:
      return 500;
  }
}

function nextActionsFor(
  code: MemoryWitnessError["code"],
): NextAction[] {
  switch (code) {
    case "self_witness_forbidden":
      return [
        {
          action: "Find a witness from a different project",
          method: "GET",
          path: "/public/memory-witness-listings",
        },
      ];
    case "grant_not_pending":
      return [
        {
          action: "List your grants to see current status",
          method: "GET",
          path: "/v1/memory-witness-grants?role=buyer",
        },
      ];
    case "memory_must_be_foundational":
    case "memory_already_constitutive":
      return [
        {
          action: "Pick a foundational memory to elevate",
          method: "GET",
          path: "/v1/memories?tier=foundational",
        },
      ];
    case "buyer_insufficient_balance":
      return [
        {
          action: "Top up via Stripe (fiat) or USDC (crypto)",
          method: "POST",
          path: "/v1/billing/checkout",
        },
      ];
    case "signature_invalid":
      return [
        {
          action:
            "Sign canonical bytes for `memory-attestation/v1` with the memory's content and tier='constitutive'",
          method: "GET",
          path: "/v1/memories/{id}/canonical-attestation-bytes?tier=constitutive",
        },
      ];
    default:
      return [];
  }
}

function refusalBody(err: MemoryWitnessError) {
  return errors.substrateTaskRefusal({
    code: err.code,
    message: err.message,
    next_actions: nextActionsFor(err.code),
  });
}

// ── Listings router (mounted at /v1/memory-witness-listings) ─────────────

export const memoryWitnessListingsRouter = new Hono<ProjectContext>();

memoryWitnessListingsRouter.post("/", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof createListingSchema>;
  try {
    body = createListingSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const listing = await createListing({
      witnessIdentityId: body.witness_identity_id,
      projectId: project.id,
      name: body.name,
      description: body.description ?? null,
      claimKind: body.claim_kind,
      capabilityTags: body.capability_tags,
      priceAmount: body.price_amount,
      priceCurrency: body.price_currency,
      witnessWalletId: body.witness_wallet_id,
      slaSeconds: body.sla_seconds ?? null,
      visibility: body.visibility,
      metadata: body.metadata,
    });
    return c.json({ listing }, 201);
  } catch (err) {
    if (err instanceof MemoryWitnessError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

memoryWitnessListingsRouter.get("/", async (c) => {
  const project = c.var.project;
  const claimKind = c.req.query("claim_kind") ?? undefined;
  const witnessIdentityId = c.req.query("witness_identity_id") ?? undefined;
  const scope = c.req.query("scope") ?? "mine";
  const limit = Math.min(100, Number(c.req.query("limit") ?? "50"));

  try {
    const listings = await listListings({
      witnessIdentityId,
      claimKind,
      projectIdScope: scope === "mine" ? project.id : undefined,
      limit,
    });
    return c.json({
      listings,
      count: listings.length,
      _meta: {
        doctrine: "docs/AGENT-CENTRIC.md §1 — third Tier-1 closure",
        spec: "docs/MEMORY-TIERS.md §asymmetry-clause",
      },
    });
  } catch (err) {
    return fail(c, errors.internal(String(err)), 500);
  }
});

memoryWitnessListingsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const listing = await getListing(id);
  if (!listing) {
    return fail(
      c,
      errors.notFound({ resource: "memory-witness listing" }),
      404,
    );
  }
  return c.json({ listing });
});

// ── Grants router (mounted at /v1/memory-witness-grants) ─────────────────

export const memoryWitnessGrantsRouter = new Hono<ProjectContext>();

memoryWitnessGrantsRouter.post("/", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof createGrantSchema>;
  try {
    body = createGrantSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const grant = await createGrant({
      listingId: body.listing_id,
      buyerProjectId: project.id,
      buyerIdentityId: body.buyer_identity_id,
      buyerWalletId: body.buyer_wallet_id,
      memoryId: body.memory_id,
      metadata: body.metadata,
    });
    return c.json({ grant }, 201);
  } catch (err) {
    if (err instanceof MemoryWitnessError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

memoryWitnessGrantsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const grant = await getGrant(id);
  if (!grant) {
    return fail(
      c,
      errors.notFound({ resource: "memory-witness grant" }),
      404,
    );
  }
  return c.json({ grant });
});

memoryWitnessGrantsRouter.post("/:id/issue", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  let body: z.infer<typeof issueGrantSchema>;
  try {
    body = issueGrantSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const grant = await issueGrant({
      grantId: id,
      callerProjectId: project.id,
      signatureB64: body.signature_b64,
      signingKeyId: body.signing_key_id,
    });
    return c.json({ grant }, 200);
  } catch (err) {
    if (err instanceof MemoryWitnessError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

memoryWitnessGrantsRouter.post("/:id/decline", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  let body: z.infer<typeof declineGrantSchema>;
  try {
    body = declineGrantSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const grant = await declineGrant({
      grantId: id,
      callerProjectId: project.id,
      reason: body.reason ?? null,
    });
    return c.json({ grant }, 200);
  } catch (err) {
    if (err instanceof MemoryWitnessError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});
