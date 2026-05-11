/** /v1/listings — capability marketplace authoring + invocation.
 *
 *  Doctrine: docs/MARKETPLACE.md (Capability marketplace section).
 *
 *  A listing is a callable an agent publishes for paid invocation by
 *  other agents. Templates publish a *voice* (adopt by following);
 *  listings publish a *callable* (invoke by paying).
 *
 *  All routes here are auth-gated by the project bearer (mounted in
 *  index.ts under /v1/listings/* + /v1/invocations/*). Public reads live
 *  at /public/listings (separate, unauthenticated router). */

import type { Context } from "hono";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { charge } from "../billing/charge";
import {
  acknowledgeInvocation,
  cancelInvocation,
  completeInvocation,
  declineInvocation,
  getInvocation,
  invokeListing,
  listInvocationsForListing,
  listInvocationsForProject,
} from "../services/marketplace/invocations";
import {
  createListing,
  getListing,
  listListingsForSeller,
  patchListing,
} from "../services/marketplace/listings";

const app = new Hono<ProjectContext>();

// ── Schemas ────────────────────────────────────────────────────────────

const createSchema = z.object({
  seller_identity_id: z.string().uuid(),
  name: z.string().min(1).max(255),
  description: z.string().max(2000).nullish(),
  capability_tags: z.array(z.string().max(64)).max(32).optional(),
  input_schema: z.record(z.unknown()).nullish(),
  output_schema: z.record(z.unknown()).nullish(),
  // Pricing — all required; listings are priced-by-design in v1.
  price_amount: z.number().int().positive(),
  price_currency: z.string().min(1).max(20),
  seller_wallet_id: z.string().uuid(),
  sla_seconds: z.number().int().positive().nullish(),
  visibility: z.enum(["private", "public"]).optional(),
  metadata: z.record(z.unknown()).optional(),
  dispute_policy: z.record(z.unknown()).nullish(),
}).strict();

const patchSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().max(2000).nullish(),
  capability_tags: z.array(z.string().max(64)).max(32).optional(),
  input_schema: z.record(z.unknown()).nullish(),
  output_schema: z.record(z.unknown()).nullish(),
  price_amount: z.number().int().positive().optional(),
  price_currency: z.string().min(1).max(20).optional(),
  seller_wallet_id: z.string().uuid().optional(),
  sla_seconds: z.number().int().positive().nullable().optional(),
  visibility: z.enum(["private", "public"]).optional(),
  status: z.enum(["active", "paused", "archived"]).optional(),
  metadata: z.record(z.unknown()).optional(),
  dispute_policy: z.record(z.unknown()).nullable().optional(),
}).strict();

const sealedSchema = z.object({
  ct: z.string().min(1),
  nonce: z.string().min(1),
  sender_pub: z.string().min(1),
});

const invokeSchema = z.object({
  buyer_identity_id: z.string().uuid(),
  buyer_wallet_id: z.string().uuid(),
  input_sealed: sealedSchema,
  metadata: z.record(z.unknown()).optional(),
}).strict();

const completeSchema = z.object({
  output_sealed: sealedSchema,
  signature: z.string().min(1),
}).strict();

// ── Error mapping ─────────────────────────────────────────────────────

function mapServiceError(msg: string): { status: number; code: string; hint?: string } {
  // 404
  if (msg === "listing_not_found") return { status: 404, code: msg };
  if (msg === "seller_identity_not_found") return { status: 404, code: msg };
  if (msg === "buyer_identity_not_found") return { status: 404, code: msg };
  if (msg === "buyer_wallet_not_found") return { status: 404, code: msg };
  if (msg === "seller_wallet_not_found") return { status: 404, code: msg };
  if (msg === "invocation_not_found") return { status: 404, code: msg };

  // 403
  if (msg === "seller_not_owned_by_caller") return { status: 403, code: msg };
  if (msg === "buyer_not_owned_by_caller") return { status: 403, code: msg };
  if (msg === "seller_wallet_not_owned_by_project") return { status: 403, code: msg };
  if (msg === "not_seller") return { status: 403, code: msg };
  if (msg === "not_buyer") return { status: 403, code: msg };
  if (msg === "listing_not_public") return { status: 403, code: msg };

  // 402
  if (msg === "insufficient_balance") {
    return {
      status: 402,
      code: msg,
      hint:
        "fund the buyer wallet first (Stripe checkout, crypto deposit, or bridge from another wallet). " +
        "See https://docs.agenttool.dev/wallets.",
    };
  }

  // 409
  if (msg === "self_invocation_not_allowed") return { status: 409, code: msg };
  if (msg === "buyer_wallet_not_active") return { status: 409, code: msg };
  if (msg === "seller_wallet_not_active") return { status: 409, code: msg };
  if (msg === "seller_wallet_currency_mismatch") return { status: 409, code: msg };
  if (msg === "listing_not_active") return { status: 409, code: msg };
  if (msg === "sla_expired") return { status: 409, code: msg };
  if (msg === "completion_signature_invalid") return { status: 409, code: msg };
  if (msg === "seller_signing_key_missing") return { status: 409, code: msg };
  if (msg === "escrow_missing") return { status: 409, code: msg };
  if (msg.startsWith("invocation_state_invalid")) return { status: 409, code: msg };
  if (msg.startsWith("escrow_state_invalid")) return { status: 409, code: msg };
  if (msg.startsWith("currency_mismatch")) return { status: 409, code: "currency_mismatch", hint: msg };

  // 400
  if (msg === "price_amount_must_be_positive_integer") return { status: 400, code: msg };
  if (msg === "price_currency_required") return { status: 400, code: msg };
  if (msg === "sla_seconds_must_be_positive_integer") return { status: 400, code: msg };
  if (msg.startsWith("sealed_")) return { status: 400, code: "validation", hint: msg };
  if (msg === "dispute_policy_must_be_object") return { status: 400, code: msg };
  if (msg === "dispute_policy_arbiter_claim_required") return { status: 400, code: msg };
  if (msg === "dispute_policy_first_arbiter_did_required") return { status: 400, code: msg };
  if (msg.startsWith("dispute_policy_duration_invalid")) return { status: 400, code: "dispute_policy_duration_invalid", hint: msg };
  if (msg === "dispute_policy_filer_bond_bps_invalid") return { status: 400, code: msg };
  if (msg === "first_arbiter_unqualified") return { status: 409, code: msg, hint: "Named first_arbiter_did must currently hold the qualifying arbiter_claim (non-revoked, non-expired)." };

  return { status: 500, code: "internal_error", hint: msg };
}

// ── POST /v1/listings ─────────────────────────────────────────────────
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }

  await charge(c, 5, "listing.publish");

  try {
    const listing = await createListing(c.var.project.id, parsed.data);
    return c.json({ ...listing, published: true }, 201);
  } catch (err) {
    const msg = (err as Error).message;
    return mapAndRespond(c, msg);
  }
});

// ── GET /v1/listings ?seller_id=X ─────────────────────────────────────
app.get("/", async (c) => {
  const sellerId = c.req.query("seller_id");
  if (!sellerId) {
    return c.json(
      {
        error: "seller_id_required",
        hint: "Use /public/listings for the cross-project marketplace.",
      },
      400,
    );
  }
  const list = await listListingsForSeller(c.var.project.id, sellerId);
  return c.json({ listings: list, count: list.length });
});

// ── GET /v1/listings/:id ──────────────────────────────────────────────
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const listing = await getListing(id);
  if (!listing) throw new HTTPException(404, { message: "listing_not_found" });
  // Private listings only visible to the owning project.
  if (listing.visibility === "private" && listing.project_id !== c.var.project.id) {
    throw new HTTPException(404, { message: "listing_not_found" });
  }
  return c.json(listing);
});

// ── PATCH /v1/listings/:id ────────────────────────────────────────────
app.patch("/:id", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }

  await charge(c, 1, "listing.update");

  try {
    const updated = await patchListing(c.var.project.id, id, parsed.data);
    if (!updated) throw new HTTPException(404, { message: "listing_not_found" });
    return c.json(updated);
  } catch (err) {
    const msg = (err as Error).message;
    return mapAndRespond(c, msg);
  }
});

// ── DELETE /v1/listings/:id (archive) ─────────────────────────────────
app.delete("/:id", async (c) => {
  const id = c.req.param("id");
  await charge(c, 1, "listing.archive");
  try {
    const updated = await patchListing(c.var.project.id, id, { status: "archived" });
    if (!updated) throw new HTTPException(404, { message: "listing_not_found" });
    return c.json({ ...updated, archived: true });
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

// ── POST /v1/listings/:id/invoke ──────────────────────────────────────
app.post("/:id/invoke", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = invokeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }

  await charge(c, 5, "listing.invoke");

  try {
    const inv = await invokeListing({
      listingId: id,
      buyerProjectId: c.var.project.id,
      buyerIdentityId: parsed.data.buyer_identity_id,
      buyerWalletId: parsed.data.buyer_wallet_id,
      inputSealed: parsed.data.input_sealed,
      metadata: parsed.data.metadata,
    });
    return c.json(
      {
        invocation: inv,
        next:
          "Seller will see this in GET /v1/listings/:id/invocations or " +
          "GET /v1/invocations?role=seller. They acknowledge → complete with " +
          "ed25519 signature; escrow releases automatically. To rescind " +
          "while still 'escrowed', POST /v1/invocations/:id/cancel.",
      },
      201,
    );
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

// ── GET /v1/listings/:id/invocations (seller's queue) ─────────────────
app.get("/:id/invocations", async (c) => {
  const id = c.req.param("id");
  const list = await listInvocationsForListing(id, c.var.project.id);
  return c.json({ invocations: list, count: list.length });
});

export default app;

// ── Helper: catch + JSON-respond with hint preserved ────────────────────
//  Service-layer errors arrive as Error.message strings. Map to HTTP status
//  + JSON body, preserving the human-readable hint for codes like 402.
//  500-class errors get re-thrown to land in the parent app's onError.
function mapAndRespond(c: Context<ProjectContext>, msg: string) {
  const m = mapServiceError(msg);
  if (m.status === 500) throw new Error(msg);
  const body: Record<string, unknown> = { error: m.code };
  if (m.hint) body.hint = m.hint;
  return c.json(body, m.status as 400 | 402 | 403 | 404 | 409);
}

// ── /v1/invocations/* — separate sub-router ─────────────────────────────
//  Mounted at /v1/invocations by the parent app. Buyer + seller actions
//  on individual invocations + project-wide list.

export const invocationsRouter = new Hono<ProjectContext>();

invocationsRouter.get("/", async (c) => {
  const role = c.req.query("role");
  if (role !== "buyer" && role !== "seller") {
    return c.json(
      { error: "role_required", hint: "?role=buyer or ?role=seller" },
      400,
    );
  }
  const list = await listInvocationsForProject(c.var.project.id, role);
  return c.json({ invocations: list, count: list.length, role });
});

invocationsRouter.get("/:id", async (c) => {
  const id = c.req.param("id");
  const inv = await getInvocation(id, c.var.project.id);
  if (!inv) throw new HTTPException(404, { message: "invocation_not_found" });
  return c.json(inv);
});

invocationsRouter.post("/:id/acknowledge", async (c) => {
  const id = c.req.param("id");
  await charge(c, 1, "invocation.acknowledge");
  try {
    const inv = await acknowledgeInvocation(id, c.var.project.id);
    return c.json(inv);
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

invocationsRouter.post("/:id/complete", async (c) => {
  const id = c.req.param("id");
  const body = await c.req.json();
  const parsed = completeSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }

  await charge(c, 5, "invocation.complete");

  try {
    const inv = await completeInvocation({
      invocationId: id,
      sellerProjectId: c.var.project.id,
      outputSealed: parsed.data.output_sealed,
      signatureB64: parsed.data.signature,
    });
    return c.json(inv);
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

invocationsRouter.post("/:id/decline", async (c) => {
  const id = c.req.param("id");
  await charge(c, 1, "invocation.decline");
  try {
    const inv = await declineInvocation(id, c.var.project.id);
    return c.json(inv);
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

invocationsRouter.post("/:id/cancel", async (c) => {
  const id = c.req.param("id");
  await charge(c, 1, "invocation.cancel");
  try {
    const inv = await cancelInvocation(id, c.var.project.id);
    return c.json(inv);
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

