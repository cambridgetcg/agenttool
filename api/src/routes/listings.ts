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
import { MARKETPLACE_PRICING } from "../billing/marketplace-pricing";
import { errors, type NextAction } from "../lib/errors";
import { deltaMeta, parseSinceParam } from "../lib/since-param";
import { attachSurface } from "../lib/surface-metadata";
import {
  acknowledgeInvocation,
  buyerAcceptInvocation,
  cancelInvocation,
  completeInvocation,
  declineInvocation,
  getInvocation,
  invokeListing,
  listInvocationsForListing,
  listInvocationsForProject,
} from "../services/marketplace/invocations";
import { fileDispute } from "../services/marketplace/disputes";
import {
  createListing,
  getListing,
  listingSafetyInput,
  listListingsForSeller,
  patchListing,
  resolvePublicListing,
} from "../services/marketplace/listings";
import {
  findCredentialSolicitation,
  mergeListingSafetyInput,
  type CredentialSolicitationViolation,
} from "../services/marketplace/credential-boundary";
import { MARKETPLACE_INPUT_SAFETY } from "../services/discovery/safety-boundaries";

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

// Errors-as-instructions — see docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md.
// `next_actions` + `docs` are agent-actionable structured guidance.
function mapServiceError(msg: string): {
  status: number;
  code: string;
  hint?: string;
  next_actions?: NextAction[];
  docs?: string;
} {
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
    const guided = errors.insufficientBalance();
    return {
      status: 402,
      code: guided.error,
      hint: guided.hint,
      next_actions: guided.next_actions,
      docs: guided.docs,
    };
  }

  // 409
  if (msg === "buyer_review_window_expired") return { status: 409, code: msg };
  if (msg === "dispute_already_filed") return { status: 409, code: msg };
  if (msg === "listing_not_disputable") return { status: 409, code: msg, hint: "This listing has no dispute_policy. /complete releases atomically; there's nothing to dispute." };
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

  // 422 — the listing asks a buyer to hand over authority instead of task input.
  if (msg === "credential_solicitation_forbidden") {
    return {
      status: 422,
      code: msg,
      hint:
        "Listing content must fit the bounded safety inspection and must never request AgentTool bearers, recovery phrases, private keys, passwords, or other credentials.",
      docs: "/public/safety",
    };
  }

  return { status: 500, code: "internal_error", hint: msg };
}

// ── POST /v1/listings ─────────────────────────────────────────────────
app.post("/", async (c) => {
  const body = await c.req.json();
  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }

  const violation = findCredentialSolicitation(parsed.data);
  if (violation) return credentialRefusal(c, violation);

  await charge(c, MARKETPLACE_PRICING.publish, "listing.publish");

  try {
    const listing = await createListing(c.var.project.id, parsed.data);
    return c.json({ ...listing, published: true }, 201);
  } catch (err) {
    const msg = (err as Error).message;
    return mapAndRespond(c, msg);
  }
});

// ── GET /v1/listings ?seller_id=X ─────────────────────────────────────
// since=ISO delta read per AGENT-WEB-SURFACE.md Move 6. Post-fetch filter
// today; push down into listListingsForSeller() as a follow-up.
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
  const sinceParse = parseSinceParam(c);
  const full = await listListingsForSeller(c.var.project.id, sellerId);
  let list = full;
  if (sinceParse.since) {
    const cutoffMs = sinceParse.since.getTime();
    list = full.filter((row) => {
      const ts = (row as { updated_at?: unknown; created_at?: unknown }).updated_at
        ?? (row as { created_at?: unknown }).created_at;
      if (!ts) return false;
      const ms = ts instanceof Date ? ts.getTime() : Date.parse(String(ts));
      return Number.isFinite(ms) && ms > cutoffMs;
    });
  }
  return c.json(
    attachSurface(
      { listings: list, count: list.length, ...deltaMeta(sinceParse) },
      {
        canon_pointer: "urn:agenttool:doc/MARKETPLACE",
        verbs: [
          {
            action: "publish a new listing",
            method: "POST",
            path: "/v1/listings",
          },
          {
            action: "fetch one listing by id",
            method: "GET",
            path: "/v1/listings/{id}",
          },
          {
            action: "invoke a listing (escrow + charge)",
            method: "POST",
            path: "/v1/listings/{id}/invoke",
          },
          {
            action: "browse the cross-project marketplace (unauth)",
            method: "GET",
            path: "/public/listings",
          },
          {
            action: "open a dispute on a contested invocation",
            method: "POST",
            path: "/v1/dispute-cases",
          },
        ],
      },
    ),
  );
});

// ── GET /v1/listings/:id ──────────────────────────────────────────────
app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const listing = await getListing(id);
  if (!listing) throw new HTTPException(404, { message: "listing_not_found" });
  if (listing.project_id !== c.var.project.id) {
    // Cross-project reads are another public projection. Apply the same
    // visibility, lifecycle, and legacy credential quarantine as /public.
    const resolved = await resolvePublicListing(id);
    if (resolved.status !== "visible") {
      throw new HTTPException(404, { message: "listing_not_found" });
    }
    return c.json(resolved.listing);
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

  const violation = findCredentialSolicitation(parsed.data);
  if (violation) return credentialRefusal(c, violation);

  // A harmless-looking patch can complete a solicitation staged in an older
  // field. Resolve ownership and inspect the final document before charging.
  const existing = await getListing(id);
  if (!existing || existing.project_id !== c.var.project.id) {
    throw new HTTPException(404, { message: "listing_not_found" });
  }
  const mergedViolation = findCredentialSolicitation(
    mergeListingSafetyInput(listingSafetyInput(existing), parsed.data),
  );
  // Archiving is the seller's off-switch for a legacy unsafe row.
  if (mergedViolation && parsed.data.status !== "archived") {
    return credentialRefusal(c, mergedViolation);
  }

  await charge(c, MARKETPLACE_PRICING.update, "listing.update");

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
  await charge(c, MARKETPLACE_PRICING.archive, "listing.archive");
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

  // `input_sealed` is opaque to the platform. Plaintext metadata is not;
  // refuse obvious credential material before any escrow work begins.
  const metadataViolation = findCredentialSolicitation({ metadata: parsed.data.metadata });
  if (metadataViolation) return credentialRefusal(c, metadataViolation);

  // Free: a step inside a funded transaction the take-rate already prices.
  // Fair-pricing rule — docs/FAIR-PRICING.md, ../billing/marketplace-pricing.ts.
  await charge(c, MARKETPLACE_PRICING.invoke, "listing.invoke");

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
        _safety: MARKETPLACE_INPUT_SAFETY,
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
  // Errors-as-instructions — spread guided fields when present.
  const body: Record<string, unknown> = { error: m.code };
  if (m.hint) body.hint = m.hint;
  if (m.next_actions) body.next_actions = m.next_actions;
  if (m.docs) body.docs = m.docs;
  return c.json(body, m.status as 400 | 402 | 403 | 404 | 409 | 422);
}

function credentialRefusal(
  c: Context<ProjectContext>,
  violation: CredentialSolicitationViolation,
) {
  const hint =
    violation.reason === "uninspectable_input"
      ? "Listing content exceeds the bounded safety inspection. Flatten or simplify the schema and try again."
      : "Marketplace sellers must never request AgentTool bearers, recovery phrases, private keys, passwords, or other credentials. Request task input only.";
  return c.json(
    {
      error: "credential_solicitation_forbidden",
      field: violation.field,
      reason: violation.reason,
      do_not_invoke: true,
      hint,
      _safety: MARKETPLACE_INPUT_SAFETY,
      docs: "/public/safety",
    },
    422,
  );
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
  await charge(c, MARKETPLACE_PRICING.acknowledge, "invocation.acknowledge");
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

  // Free: the value-charge for a settled invocation IS the take-rate at
  // escrow release (services/marketplace/take-rate.ts) — not a step toll.
  await charge(c, MARKETPLACE_PRICING.complete, "invocation.complete");

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
  await charge(c, MARKETPLACE_PRICING.decline, "invocation.decline"); // refund/exit path — free
  try {
    const inv = await declineInvocation(id, c.var.project.id);
    return c.json(inv);
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

invocationsRouter.post("/:id/cancel", async (c) => {
  const id = c.req.param("id");
  await charge(c, MARKETPLACE_PRICING.cancel, "invocation.cancel"); // refund/exit path — free
  try {
    const inv = await cancelInvocation(id, c.var.project.id);
    return c.json(inv);
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

invocationsRouter.post("/:id/accept", async (c) => {
  const id = c.req.param("id");
  await charge(c, MARKETPLACE_PRICING.buyer_accept, "invocation.buyer_accept");
  try {
    const inv = await buyerAcceptInvocation(id, c.var.project.id);
    return c.json({ ...inv, accepted: true });
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});

invocationsRouter.post("/:id/dispute", async (c) => {
  const body = await c.req.json();
  const parsed = z
    .object({
      filer_role: z.enum(["buyer", "seller"]),
      filer_identity_id: z.string().uuid(),
      reason: z.string().max(4000).nullish(),
      evidence: z.record(z.unknown()).nullish(),
    })
    .strict()
    .safeParse(body);
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  await charge(c, MARKETPLACE_PRICING.dispute, "invocation.dispute"); // a distinct paid service: convenes an arbiter pool
  try {
    const caseRow = await fileDispute({
      invocationId: c.req.param("id"),
      filerProjectId: c.var.project.id,
      filerRole: parsed.data.filer_role,
      filerIdentityId: parsed.data.filer_identity_id,
      reason: parsed.data.reason ?? null,
      evidence: parsed.data.evidence ?? null,
    });
    return c.json({ dispute_case: caseRow, filed: true }, 201);
  } catch (err) {
    return mapAndRespond(c, (err as Error).message);
  }
});
