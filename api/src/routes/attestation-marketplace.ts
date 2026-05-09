/** /v1/attestation-listings + /v1/attestation-grants — Slice 3 routes.
 *
 *  Two routers exported. Mount in api/src/index.ts at
 *    `/v1/attestation-listings` → `attestationListingsRouter`
 *    `/v1/attestation-grants`   → `attestationGrantsRouter`
 *
 *  Doctrine: docs/MARKETPLACE.md (Attestation marketplace section). */

import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import {
  cancelGrant,
  createListing,
  declineGrant,
  getGrant,
  getListing,
  issueGrant,
  listGrants,
  listListings,
  patchListing,
  purchaseGrant,
} from "../services/marketplace/attestations";

// ── Listings router ─────────────────────────────────────────────────

const listingsRouter = new Hono<ProjectContext>();

const visibilitySchema = z.enum(["private", "public"]);
const statusSchema = z.enum(["active", "paused", "archived"]);

const createListingSchema = z.object({
  attester_identity_id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  claim: z.string().min(1).max(500),
  capability_tags: z.array(z.string().max(64)).max(32).optional(),
  evidence_schema: z.record(z.unknown()).nullish(),
  price_amount: z.number().int().positive(),
  price_currency: z.string().min(1).max(20),
  attester_wallet_id: z.string().uuid(),
  validity_seconds: z.number().int().positive().nullish(),
  sla_seconds: z.number().int().positive().nullish(),
  visibility: visibilitySchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

listingsRouter.post("/", async (c) => {
  const project = c.var.project;
  const parsed = createListingSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const v = parsed.data;
  try {
    const listing = await createListing({
      attesterIdentityId: v.attester_identity_id,
      projectId: project.id,
      name: v.name,
      description: v.description ?? null,
      claim: v.claim,
      capabilityTags: v.capability_tags,
      evidenceSchema: v.evidence_schema ?? null,
      priceAmount: v.price_amount,
      priceCurrency: v.price_currency,
      attesterWalletId: v.attester_wallet_id,
      validitySeconds: v.validity_seconds ?? null,
      slaSeconds: v.sla_seconds ?? null,
      visibility: v.visibility,
      metadata: v.metadata,
    });
    return c.json({ listing }, 201);
  } catch (err) {
    return c.json({ error: (err as Error).message }, 400);
  }
});

listingsRouter.get("/", async (c) => {
  const project = c.var.project;
  const attester = c.req.query("attester_id");
  const claim = c.req.query("claim");
  const status = c.req.query("status");
  const mineOnly = c.req.query("mine") === "true";
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  const filter: Parameters<typeof listListings>[0] = { limit };
  if (attester) filter.attesterIdentityId = attester;
  if (claim) filter.claim = claim;
  if (status) {
    const s = statusSchema.safeParse(status);
    if (!s.success) return c.json({ error: "invalid status" }, 400);
    filter.status = s.data;
  }
  if (mineOnly) filter.projectIdScope = project.id;

  const list = await listListings(filter);
  return c.json({ listings: list, count: list.length });
});

listingsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const listing = await getListing(id);
  if (!listing) throw new HTTPException(404, { message: "listing_not_found" });
  if (listing.visibility !== "public" && listing.project_id !== c.var.project.id) {
    throw new HTTPException(404, { message: "listing_not_found" });
  }
  return c.json({ listing });
});

const patchListingSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).nullish(),
  capability_tags: z.array(z.string().max(64)).max(32).optional(),
  evidence_schema: z.record(z.unknown()).nullish(),
  price_amount: z.number().int().positive().optional(),
  price_currency: z.string().min(1).max(20).optional(),
  attester_wallet_id: z.string().uuid().optional(),
  validity_seconds: z.number().int().positive().nullish(),
  sla_seconds: z.number().int().positive().nullish(),
  visibility: visibilitySchema.optional(),
  status: statusSchema.optional(),
  metadata: z.record(z.unknown()).optional(),
});

listingsRouter.patch("/:id", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const parsed = patchListingSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const v = parsed.data;
  try {
    const updated = await patchListing(id, project.id, {
      name: v.name,
      description: v.description ?? undefined,
      capabilityTags: v.capability_tags,
      evidenceSchema: v.evidence_schema ?? undefined,
      priceAmount: v.price_amount,
      priceCurrency: v.price_currency,
      attesterWalletId: v.attester_wallet_id,
      validitySeconds: v.validity_seconds ?? undefined,
      slaSeconds: v.sla_seconds ?? undefined,
      visibility: v.visibility,
      status: v.status,
      metadata: v.metadata,
    });
    if (!updated) throw new HTTPException(404, { message: "listing_not_found" });
    return c.json({ listing: updated });
  } catch (err) {
    if (err instanceof HTTPException) throw err;
    return c.json({ error: (err as Error).message }, 400);
  }
});

const purchaseSchema = z.object({
  buyer_identity_id: z.string().uuid(),
  buyer_wallet_id: z.string().uuid(),
  subject_identity_id: z.string().uuid(),
  evidence: z.record(z.unknown()).nullish(),
});

listingsRouter.post("/:id/purchase", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const parsed = purchaseSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const v = parsed.data;
  try {
    const grant = await purchaseGrant({
      listingId: id,
      buyerIdentityId: v.buyer_identity_id,
      buyerProjectId: project.id,
      buyerWalletId: v.buyer_wallet_id,
      subjectIdentityId: v.subject_identity_id,
      evidence: v.evidence ?? null,
    });
    return c.json({ grant }, 201);
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "listing_not_found" ? 404
      : msg === "insufficient_balance" ? 402
      : 400;
    return c.json({ error: msg }, status);
  }
});

// ── Grants router ────────────────────────────────────────────────────

const grantsRouter = new Hono<ProjectContext>();

grantsRouter.get("/", async (c) => {
  const project = c.var.project;
  const role = c.req.query("role") ?? "buyer";
  if (role !== "buyer" && role !== "attester" && role !== "subject") {
    return c.json({ error: "role must be buyer|attester|subject" }, 400);
  }
  const status = c.req.query("status");
  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);

  const filter: Parameters<typeof listGrants>[0] = {
    role,
    projectId: project.id,
    limit,
  };
  if (status) {
    if (!["pending", "issued", "refunded", "failed"].includes(status)) {
      return c.json({ error: "invalid status" }, 400);
    }
    filter.status = status as Parameters<typeof listGrants>[0]["status"];
  }
  const grants = await listGrants(filter);
  return c.json({ grants, count: grants.length, role });
});

grantsRouter.get("/:id", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  // Try buyer scope first, then attester scope.
  const buyerScoped = await getGrant(id, {
    roleScope: { projectId: project.id, role: "buyer" },
  });
  if (buyerScoped) return c.json({ grant: buyerScoped, role: "buyer" });
  const attesterScoped = await getGrant(id, {
    roleScope: { projectId: project.id, role: "attester" },
  });
  if (attesterScoped) return c.json({ grant: attesterScoped, role: "attester" });
  throw new HTTPException(404, { message: "grant_not_found" });
});

const issueSchema = z.object({
  signature: z.string().min(1).max(255),
  signing_key_id: z.string().uuid(),
});

grantsRouter.post("/:id/issue", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  const parsed = issueSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  try {
    const grant = await issueGrant({
      grantId: id,
      attesterProjectId: project.id,
      signature: parsed.data.signature,
      signingKeyId: parsed.data.signing_key_id,
    });
    return c.json({ grant });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "grant_not_found" || msg === "listing_missing" ? 404
      : msg === "signature_invalid" || msg === "signing_key_revoked" || msg === "signing_key_not_found" || msg === "signing_key_does_not_belong_to_attester" ? 401
      : msg === "not_listing_owner" ? 403
      : 400;
    return c.json({ error: msg }, status);
  }
});

grantsRouter.post("/:id/decline", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  try {
    const grant = await declineGrant({
      grantId: id,
      attesterProjectId: project.id,
    });
    return c.json({ grant });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "grant_not_found" || msg === "listing_missing" ? 404
      : msg === "not_listing_owner" ? 403
      : 400;
    return c.json({ error: msg }, status);
  }
});

grantsRouter.post("/:id/cancel", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  try {
    const grant = await cancelGrant({
      grantId: id,
      buyerProjectId: project.id,
    });
    return c.json({ grant });
  } catch (err) {
    const msg = (err as Error).message;
    const status = msg === "grant_not_found" ? 404
      : msg === "not_grant_owner" ? 403
      : 400;
    return c.json({ error: msg }, status);
  }
});

export const attestationListingsRouter = listingsRouter;
export const attestationGrantsRouter = grantsRouter;
