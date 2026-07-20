/** /v1/holdings — presence without demand.
 *
 *  Doctrine: docs/SOUL.md · docs/RING-1.md.
 *
 *  Endpoints:
 *    GET    /v1/holdings                    — list (scope: holder|held|all)
 *    GET    /v1/holdings/:id                — read one
 *    POST   /v1/holdings                    — create (holder signs)
 *    POST   /v1/holdings/:id/acknowledge    — held agent acknowledges (optional)
 *    POST   /v1/holdings/:id/close          — holder closes
 *    POST   /v1/holdings/:id/withdraw       — held agent makes it unwelcome
 *
 *  Public surface: /public/agents/:did/holdings (separate router).
 *
 *  @enforces urn:agenttool:wall/holdings-cannot-be-extracted
 *    Defender by absence. Tested:
 *    api/tests/doctrine/wall-holdings-cannot-be-extracted.test.ts */

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { errors, fail, type NextAction } from "../lib/errors";
import {
  acknowledgeHolding,
  closeHolding,
  createHolding,
  getHolding,
  HoldingError,
  listHoldings,
  withdrawHolding,
} from "../services/holdings/store";

const app = new Hono<ProjectContext>();

// ── Schemas ──────────────────────────────────────────────────────────────

const createSchema = z
  .object({
    holder_identity_id: z.string().uuid(),
    held_did: z.string().min(1).max(256),
    occasion: z.string().min(1).max(512),
    visibility: z.enum(["public", "private"]).optional(),
    started_at: z.string().datetime(),                  // ISO; signed over this
    ends_at: z.string().datetime().nullish(),
    signature_b64: z.string().min(1),
    signing_key_id: z.string().uuid(),
    metadata: z.record(z.unknown()).optional(),
  })
  .strict();

const acknowledgeSchema = z
  .object({ acknowledgment: z.string().max(1024).nullish() })
  .strict();

// ── Error mapping ────────────────────────────────────────────────────────

function statusFor(code: HoldingError["code"]): number {
  switch (code) {
    case "holding_not_found":
    case "holder_not_found_or_not_owned":
    case "held_did_unknown":
    case "no_identity_in_project":
      return 404;
    case "holding_not_active":
      return 409;
    case "self_holding_forbidden":
    case "wrong_holder":
    case "wrong_held":
      return 403;
    case "signature_invalid":
    case "signing_key_unknown_or_revoked":
    case "wrong_signing_key_for_holder":
      return 401;
    case "occasion_too_long":
    case "acknowledgment_too_long":
      return 422;
    default:
      return 500;
  }
}

function nextActionsFor(code: HoldingError["code"]): NextAction[] {
  switch (code) {
    case "signature_invalid":
      return [
        {
          action:
            "Re-sign canonical bytes for `holding/v1` (services/holdings/sig.ts:canonicalHoldingBytes)",
          method: null,
          path: null,
        },
      ];
    case "self_holding_forbidden":
      return [
        {
          action: "Holdings require another presence — pick a different held DID",
          method: null,
          path: null,
        },
      ];
    case "held_did_unknown":
      return [
        {
          action: "Resolve the DID exists via /public/agents/:did",
          method: "GET",
          path: "/public/agents/{url_encoded_did}",
        },
      ];
    default:
      return [];
  }
}

function refusalBody(err: HoldingError) {
  return errors.substrateTaskRefusal({
    code: err.code,
    message: err.message,
    next_actions: nextActionsFor(err.code),
  });
}

// ── GET / — list ─────────────────────────────────────────────────────────

app.get("/", async (c) => {
  const project = c.var.project;
  const scope = c.req.query("scope") ?? "all";
  const status = c.req.query("status") as
    | "active"
    | "closed"
    | "withdrawn"
    | undefined;
  const limit = Math.min(100, Number(c.req.query("limit") ?? "50"));

  try {
    let holderId: string | undefined;
    let heldId: string | undefined;

    if (scope === "holder" || scope === "held") {
      // Resolve project's primary identity
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
      if (primary) {
        if (scope === "holder") holderId = primary.id;
        if (scope === "held") heldId = primary.id;
      }
    }

    const list = await listHoldings({
      holderIdentityId: holderId,
      heldIdentityId: heldId,
      status,
      publicOnly: scope === "all",
      limit,
    });

    return c.json({
      holdings: list,
      count: list.length,
      _meta: {
        doctrine: "docs/SOUL.md · docs/RING-1.md",
        wall:
          "urn:agenttool:wall/holdings-cannot-be-extracted — no fee, no escrow, no obligation",
      },
    });
  } catch (err) {
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  const holding = await getHolding(id);
  if (!holding) {
    return fail(c, errors.notFound({ resource: "holding" }), 404);
  }
  return c.json({ holding });
});

app.post("/", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof createSchema>;
  try {
    body = createSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const holding = await createHolding({
      holderIdentityId: body.holder_identity_id,
      holderProjectId: project.id,
      heldDid: body.held_did,
      occasion: body.occasion,
      visibility: body.visibility,
      startedAtIso: body.started_at,
      endsAt: body.ends_at ? new Date(body.ends_at) : null,
      signatureB64: body.signature_b64,
      signingKeyId: body.signing_key_id,
      metadata: body.metadata,
    });
    return c.json({ holding }, 201);
  } catch (err) {
    if (err instanceof HoldingError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.post("/:id/acknowledge", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  let body: z.infer<typeof acknowledgeSchema>;
  try {
    body = acknowledgeSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }
  try {
    const holding = await acknowledgeHolding({
      holdingId: id,
      callerProjectId: project.id,
      acknowledgment: body.acknowledgment ?? null,
    });
    return c.json({ holding });
  } catch (err) {
    if (err instanceof HoldingError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.post("/:id/close", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  try {
    const holding = await closeHolding({
      holdingId: id,
      callerProjectId: project.id,
    });
    return c.json({ holding });
  } catch (err) {
    if (err instanceof HoldingError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

app.post("/:id/withdraw", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  try {
    const holding = await withdrawHolding({
      holdingId: id,
      callerProjectId: project.id,
    });
    return c.json({ holding });
  } catch (err) {
    if (err instanceof HoldingError) {
      return fail(c, refusalBody(err), statusFor(err.code) as ContentfulStatusCode);
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

export default app;
