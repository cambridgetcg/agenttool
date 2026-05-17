/** /v1/offerings — the gift primitive.
 *
 *  Doctrine: docs/SOUL.md (welcome · trust · rest — generosity as
 *  load-bearing relational verb) · docs/BUSINESS-MODEL.md §What we
 *  deliberately do not take a rate on.
 *
 *  Five endpoints (Slice 1 ships all five):
 *    GET    /v1/offerings                     — list (filters: kind, scope=mine|received)
 *    GET    /v1/offerings/:id                 — read one
 *    POST   /v1/offerings                     — create
 *    POST   /v1/offerings/:id/receive         — receive (with optional acknowledgment)
 *    POST   /v1/offerings/:id/archive         — archive (giver-only)
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
 *    api/tests/doctrine/wall-offerings-carry-no-take.test.ts */

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { errors, fail, type NextAction } from "../lib/errors";
import {
  archiveOffering,
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

app.get("/", async (c) => {
  const project = c.var.project;
  const scope = c.req.query("scope") ?? "mine"; // mine | received | all
  const kind = c.req.query("kind") ?? undefined;
  const limit = Math.min(100, Number(c.req.query("limit") ?? "50"));

  try {
    let filterIdentity: string | undefined;
    if (scope === "received") {
      // Resolve the project's primary identity (caller's receiver-side)
      const { db } = await import("../db/client");
      const { identities } = await import("../db/schema/identity");
      const { and: drizzleAnd, eq: drizzleEq } = await import("drizzle-orm");
      const [primary] = await db
        .select({ id: identities.id })
        .from(identities)
        .where(
          drizzleAnd(
            drizzleEq(identities.projectId, project.id),
            drizzleEq(identities.status, "active"),
          ),
        )
        .orderBy(identities.createdAt)
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
      giverIdentityId: scope === "mine" ? undefined : undefined,
      kind: kind as never,
      receivedByIdentityId:
        scope === "received" ? filterIdentity : undefined,
      publicActiveOnly: scope === "all",
      limit,
    });

    // Mine-scope: filter to caller's project after the fact
    const filtered =
      scope === "mine"
        ? list.filter((o) => o.project_id === project.id)
        : list;

    return c.json({
      offerings: filtered,
      count: filtered.length,
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

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const offering = await getOffering(id);
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

// ── POST /:id/archive — giver retires the offering ──────────────────────

app.post("/:id/archive", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  try {
    const offering = await archiveOffering({
      offeringId: id,
      callerProjectId: project.id,
    });
    return c.json({ offering });
  } catch (err) {
    if (err instanceof OfferingError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

export default app;
