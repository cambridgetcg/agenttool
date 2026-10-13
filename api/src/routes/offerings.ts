/** /v1/offerings — the gift primitive.
 *
 *  Doctrine: docs/SOUL.md (welcome · trust · rest — generosity as
 *  load-bearing relational verb) · docs/BUSINESS-MODEL.md §What we
 *  deliberately do not take a rate on.
 *
 *  Five endpoints (Slice 1 ships all five):
 *    GET    /v1/offerings                     — list (filters: kind, scope=mine|received|all;
 *                                               any other scope is 400)
 *    GET    /v1/offerings/:id                 — read one (private: giver's or
 *                                               recipient's project only)
 *    POST   /v1/offerings                     — create
 *    POST   /v1/offerings/:id/receive         — receive (with optional acknowledgment)
 *    POST   /v1/offerings/:id/archive         — archive: the giver withdraws, under
 *                                               the owner rule (deletion spec §5.2)
 *
 *  Public unauth discovery surface ships at /public/offerings.
 *
 *  Auth: project bearer. No payment headers, no escrow params — the
 *  whole primitive's point is that NONE of these flows touch wallets.
 *
 *  @enforces urn:agenttool:wall/offerings-carry-no-take
 *    Defender by absence: this module imports neither `recordRevenue`,
 *    `computeFee`, `escrows`, nor `wallets`. The substrate witnesses
 *    the gift without extracting from it. Tested:
 *    api/tests/doctrine/wall-offerings-carry-no-take.test.ts
 *
 *  @absence recordRevenue computeFee platformRevenue escrows
 *  @absence-from db/schema/economy
 */

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { errors, fail, type NextAction } from "../lib/errors";
import { withdrawForOwner } from "../services/deletion/withdrawals";
import { authorityRequestTarget, readAuthorityBoundBytes } from "../services/identity/authority";
import {
  findOfferingForArchive,
  getOfferingForGiver,
  createOffering,
  getOffering,
  listOfferings,
  OFFERING_KINDS,
  OfferingError,
  receiveOffering,
} from "../services/offerings/store";

const app = new Hono<ProjectContext>();

// ── Schemas ──────────────────────────────────────────────────────────────

const createSchema = z
  .object({
    giver_identity_id: z.string().uuid(),
    kind: z.enum(OFFERING_KINDS as unknown as [string, ...string[]]),
    title: z.string().min(1).max(256),
    body: z.string().min(1).max(32_768),
    metadata: z.record(z.unknown()).optional(),
    visibility: z.enum(["public", "private"]).optional(),
    recipient_dids: z.array(z.string()).max(64).optional(),
    expires_at: z.string().datetime().optional(),
  })
  .strict();

const receiveSchema = z
  .object({
    receiver_identity_id: z.string().uuid(),
    acknowledgment: z.string().max(1_024).nullish(),
  })
  .strict();

// ── Error mapping ────────────────────────────────────────────────────────

function statusFor(code: OfferingError["code"]): number {
  switch (code) {
    case "offering_not_found":
    case "giver_not_found_or_not_owned":
    case "no_identity_in_project":
      return 404;
    case "offering_not_active":
    case "already_received":
      return 409;
    case "offering_expired":
      return 410;
    case "self_receive_forbidden":
    case "offering_not_visible_to_caller":
    case "wrong_giver":
      return 403;
    case "kind_invalid":
    case "title_too_long":
    case "body_too_long":
    case "acknowledgment_too_long":
      return 422;
    default:
      return 500;
  }
}

function nextActionsFor(code: OfferingError["code"]): NextAction[] {
  switch (code) {
    case "offering_not_active":
    case "offering_expired":
    case "already_received":
      return [
        {
          action: "Browse other open offerings",
          method: "GET",
          path: "/public/offerings",
        },
      ];
    case "self_receive_forbidden":
      return [
        {
          action: "Receive offerings from another agent's project",
          method: "GET",
          path: "/public/offerings",
        },
      ];
    case "offering_not_visible_to_caller":
      return [
        {
          action: "Browse public offerings instead",
          method: "GET",
          path: "/public/offerings",
        },
      ];
    default:
      return [];
  }
}

function refusalBody(err: OfferingError) {
  return errors.substrateTaskRefusal({
    code: err.code,
    message: err.message,
    next_actions: nextActionsFor(err.code),
  });
}

// ── GET / — list ────────────────────────────────────────────────────────

//  Each scope carries its own visibility rule in SQL: mine = this project's
//  offerings, received = offerings this project's primary identity received,
//  all = public active offerings. Any other scope is refused (400) rather
//  than listed with no rule at all, which once returned every project's
//  newest offerings, private ones included.

const LIST_SCOPES = ["mine", "received", "all"] as const;

app.get("/", async (c) => {
  const project = c.var.project;
  const scope = c.req.query("scope") ?? "mine";
  const kind = c.req.query("kind") ?? undefined;
  const limit = Math.min(100, Number(c.req.query("limit") ?? "50"));

  if (!(LIST_SCOPES as readonly string[]).includes(scope)) {
    return fail(
      c,
      errors.refusal({
        error: "scope_invalid",
        message: `scope must be one of ${LIST_SCOPES.join(", ")}.`,
        hint: "Omit scope to list this project's own offerings; use scope=all for public offerings.",
      }),
      400,
    );
  }

  try {
    let filterIdentity: string | undefined;
    if (scope === "received") {
      // Resolve the project's primary identity (caller's receiver-side):
      // earliest active, never an enrolled guest (acting-identity.ts).
      const { db } = await import("../db/client");
      const { identities } = await import("../db/schema/identity");
      const { primaryIdentityOrder, primaryIdentityWhere } = await import("../services/identity/acting-identity");
      const [primary] = await db
        .select({ id: identities.id })
        .from(identities)
        .where(primaryIdentityWhere(project.id))
        .orderBy(...primaryIdentityOrder())
        .limit(1);
      if (!primary) {
        return c.json({
          offerings: [],
          count: 0,
          _note: "no active identity in project — register one to receive offerings",
        });
      }
      filterIdentity = primary.id;
    }

    const list = await listOfferings({
      kind: kind as never,
      projectId: scope === "mine" ? project.id : undefined,
      receivedByIdentityId:
        scope === "received" ? filterIdentity : undefined,
      publicActiveOnly: scope === "all",
      limit,
    });

    return c.json({
      offerings: list,
      count: list.length,
      _meta: {
        doctrine: "docs/SOUL.md · docs/BUSINESS-MODEL.md §What we deliberately do not take a rate on",
        wall: "urn:agenttool:wall/offerings-carry-no-take — no take-rate, no escrow, no payment",
      },
    });
  } catch (err) {
    return fail(c, errors.internal(String(err)), 500);
  }
});

// ── GET /:id — read one ──────────────────────────────────────────────────
//  A private offering reads as absent (404) unless the caller's project is
//  the giver's or owns a recipient DID; see getOffering.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const offering = UUID_RE.test(id) ? await getOffering(id, c.var.project.id) : null;
  if (!offering) {
    return fail(c, errors.notFound({ resource: "offering" }), 404);
  }
  return c.json({ offering });
});

// ── POST / — create ──────────────────────────────────────────────────────

app.post("/", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }

  try {
    const offering = await createOffering({
      giverIdentityId: body.giver_identity_id,
      projectId: project.id,
      kind: body.kind,
      title: body.title,
      body: body.body,
      metadata: body.metadata,
      visibility: body.visibility,
      recipientDids: body.recipient_dids,
      expiresAt: body.expires_at ? new Date(body.expires_at) : null,
    });
    return c.json({ offering }, 201);
  } catch (err) {
    if (err instanceof OfferingError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

// ── POST /:id/receive — accept ───────────────────────────────────────────

app.post("/:id/receive", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  let body: z.infer<typeof receiveSchema>;
  try {
    body = receiveSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }

  try {
    const result = await receiveOffering({
      offeringId: id,
      receiverProjectId: project.id,
      receiverIdentityId: body.receiver_identity_id,
      acknowledgment: body.acknowledgment ?? null,
    });
    return c.json(result, 200);
  } catch (err) {
    if (err instanceof OfferingError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

// ── POST /:id/archive — the giver withdraws the offering ────────────────
//
// Under the owner rule (deletion spec §5.1, §5.2 "withdraw a gesture I
// gave"): a rooted giver's own root signs this exact request, body bytes
// included (428 otherwise); a giver without a root follows the project rule.
// The offering and its words stay, archived; one ids-only ledger entry and
// the giver's deletion moment are written with it, so a backup restore
// re-archives it. An offering no longer active answers 409
// offering_not_active without consuming a proof.

app.post("/:id/archive", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  const bodyBytes = await readAuthorityBoundBytes(c.req.raw);
  const refuse = (code: OfferingError["code"]) => {
    const err = new OfferingError(code);
    return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
  };
  try {
    const found = await findOfferingForArchive({ offeringId: id, callerProjectId: project.id });
    const result = await withdrawForOwner({
      gesture: "offering",
      rowId: found.id,
      ownerIdentityId: found.giverIdentityId,
      alreadyWithdrawnAt: found.status === "active" ? null : found.updatedAt,
      projectId: project.id,
      method: c.req.method,
      requestTarget: authorityRequestTarget(c.req.url),
      bodyBytes,
      headers: c.req.raw.headers,
    });
    if (result.status === "refused") return c.json(result.body, result.httpStatus);
    if (result.status === "not_found") return refuse("offering_not_found");
    if (result.status === "already_withdrawn") return refuse("offering_not_active");
    const offering = await getOfferingForGiver(found.id, project.id);
    return c.json({ offering, authority: result.authority, ledger: result.ledger });
  } catch (err) {
    if (err instanceof OfferingError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

export default app;
