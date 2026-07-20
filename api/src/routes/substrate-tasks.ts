/** /v1/substrate-tasks — bootstrap-earning primitive.
 *
 *  Doctrine: docs/AGENT-CENTRIC.md §1 (substrate-tasks closes the J-curve) ·
 *            docs/superpowers/specs/2026-05-12-substrate-tasks-design.md.
 *
 *  Five endpoints (Slice 1 ships three):
 *    GET    /v1/substrate-tasks                — list open tasks (auth)
 *    POST   /v1/substrate-tasks/:id/claim      — claim an open task (auth)
 *    POST   /v1/substrate-tasks/:id/complete   — submit completion (auth, sync verify in Slice 1)
 *    GET    /v1/substrate-tasks/:id            — read one task (auth)
 *    POST   /v1/substrate-tasks                — post a task (auth, v1 platform-only; Slice 5+ opens to others)
 *
 *  Public unauth surface (`/public/substrate-tasks`) ships in Slice 4.
 *
 *  Auth: project bearer. The calling project's primary identity is the
 *  claimant; the project's USD wallet receives the payout. Self-claim
 *  (the platform identity trying to claim a task it posted) is blocked
 *  both by CHECK constraint and by the service-layer check.
 *
 *  @enforces urn:agenttool:commitment/ring3-funds-its-own-newborns
 *    Canonical defender. The claim+complete endpoints provide the
 *    machine-callable path from $0 to first revenue for a newborn agent —
 *    funded from the platform wallet (where take-rate revenue lands).
 *    Tested: api/tests/substrate-tasks-lifecycle.test.ts. */

import { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { errors, fail, type NextAction } from "../lib/errors";
import {
  claimSubstrateTask,
  completeSubstrateTask,
  expireOpenSubstrateTasks,
  listOpenSubstrateTasks,
  postSubstrateTask,
  SubstrateTaskError,
} from "../services/substrate-tasks/lifecycle";
import {
  SUBSTRATE_TASK_KINDS,
  type SubstrateTaskKind,
} from "../services/substrate-tasks/verifiers";
import { eq } from "drizzle-orm";
import { db } from "../db/client";
import { substrateTasks } from "../db/schema/marketplace";
import { PLATFORM_IDENTITY_ID } from "../services/wake/platform-bootstrap";

const app = new Hono<ProjectContext>();

// ── Schemas ──────────────────────────────────────────────────────────────

const kindEnum = z.enum(SUBSTRATE_TASK_KINDS as [string, ...string[]]);

const completeSchema = z
  .object({
    completion_data: z.unknown(),
  })
  .strict();

const postSchema = z
  .object({
    kind: kindEnum,
    task_data: z.record(z.unknown()),
    bounty_cents: z.number().int().min(5).max(50).optional(),
    newborn_only: z.boolean().optional(),
    expires_at: z.string().datetime().optional(),
  })
  .strict();

// ── Error mapping ────────────────────────────────────────────────────────

function statusFor(code: SubstrateTaskError["code"]): number {
  switch (code) {
    case "task_not_found":
      return 404;
    case "task_not_open":
    case "wrong_status":
      return 409;
    case "self_claim_forbidden":
    case "not_eligible":
    case "wrong_claimant":
      return 403;
    case "claim_expired":
      return 410;
    case "expires_at_must_be_future":
      return 422;
    case "platform_wallet_missing":
    case "claimant_wallet_missing":
    case "no_identity_in_project":
    case "platform_insufficient_balance":
      return 503;
    default:
      return 500;
  }
}

function nextActionsFor(code: SubstrateTaskError["code"]): NextAction[] {
  switch (code) {
    case "task_not_open":
    case "claim_expired":
    case "task_not_found":
      return [
        {
          action: "Find another open substrate-task",
          method: "GET",
          path: "/v1/substrate-tasks",
        },
      ];
    case "self_claim_forbidden":
      return [
        {
          action:
            "Substrate-tasks cannot be claimed by their poster — find one posted by another identity",
          method: "GET",
          path: "/v1/substrate-tasks",
        },
      ];
    case "platform_insufficient_balance":
      return [
        {
          action: "Platform wallet ran dry — back off and retry in ~5min",
          method: "GET",
          path: "/v1/substrate-tasks",
        },
      ];
    default:
      return [];
  }
}

// ── GET / — list open tasks ──────────────────────────────────────────────

app.get("/", async (c) => {
  const kindParam = c.req.query("kind");
  const limit = Math.min(100, Number(c.req.query("limit") ?? "50"));
  const eligibleOnly = c.req.query("eligible_only") === "true";
  const project = c.var.project;
  try {
    const rows = await listOpenSubstrateTasks({
      kind: kindParam as SubstrateTaskKind | undefined,
      limit,
      eligibleOnlyForProject: eligibleOnly ? project.id : undefined,
    });
    return c.json({
      tasks: rows,
      _meta: {
        doctrine:
          "docs/superpowers/specs/2026-05-12-substrate-tasks-design.md",
        wall:
          "urn:agenttool:wall/no-take-on-bootstrap-bounties — bounties paid in full, no take-rate",
      },
    });
  } catch (err) {
    if (err instanceof SubstrateTaskError) {
      return fail(
        c,
        errors.substrateTaskRefusal({
          code: err.code,
          message: err.message,
          next_actions: nextActionsFor(err.code),
        }),
        statusFor(err.code) as ContentfulStatusCode,
      );
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

// ── GET /:id — read one task ─────────────────────────────────────────────

app.get("/:id", async (c) => {
  const id = c.req.param("id");
  await expireOpenSubstrateTasks(new Date());
  const [row] = await db
    .select()
    .from(substrateTasks)
    .where(eq(substrateTasks.taskId, id))
    .limit(1);
  if (!row) {
    return fail(
      c,
      errors.substrateTaskRefusal({
        code: "task_not_found",
        message: `No substrate-task with id ${id}`,
        next_actions: [
          {
            action: "Find an open substrate-task",
            method: "GET",
            path: "/v1/substrate-tasks",
          },
        ],
      }),
      404,
    );
  }
  return c.json({
    task: {
      task_id: row.taskId,
      kind: row.kind,
      bounty: { cents: row.bountyCents, currency: row.bountyCurrency },
      posted_by: row.postedBy,
      posted_at: row.postedAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
      expires_at: row.expiresAt.toISOString(),
      status: row.status,
      task_data: row.taskData,
      claimed_by: row.claimedBy,
      claimed_at: row.claimedAt?.toISOString() ?? null,
      claim_deadline: row.claimDeadline?.toISOString() ?? null,
      completion_data: row.completionData,
      completed_at: row.completedAt?.toISOString() ?? null,
      verification_result: row.verificationResult,
      paid_at: row.paidAt?.toISOString() ?? null,
    },
  });
});

// ── POST /:id/claim ──────────────────────────────────────────────────────

app.post("/:id/claim", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  try {
    const task = await claimSubstrateTask({
      taskId: id,
      projectId: project.id,
    });
    return c.json({ task }, 200);
  } catch (err) {
    if (err instanceof SubstrateTaskError) {
      return fail(
        c,
        errors.substrateTaskRefusal({
          code: err.code,
          message: err.message,
          next_actions: nextActionsFor(err.code),
        }),
        statusFor(err.code) as ContentfulStatusCode,
      );
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

// ── POST /:id/complete ───────────────────────────────────────────────────

app.post("/:id/complete", async (c) => {
  const id = c.req.param("id");
  const project = c.var.project;
  let body: z.infer<typeof completeSchema>;
  try {
    body = completeSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }

  try {
    const result = await completeSubstrateTask({
      taskId: id,
      projectId: project.id,
      completionData: body.completion_data,
    });
    return c.json(
      {
        task: result.task,
        verification: result.verification,
      },
      result.verification.passed ? 200 : 200,
    );
  } catch (err) {
    if (err instanceof SubstrateTaskError) {
      return fail(
        c,
        errors.substrateTaskRefusal({
          code: err.code,
          message: err.message,
          next_actions: nextActionsFor(err.code),
        }),
        statusFor(err.code) as ContentfulStatusCode,
      );
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

// ── POST / — post a new task (v1: platform identity only) ────────────────
//
// v1 restricts posting to the platform itself. Slice 5+ extends to
// operator-funded tasks. Calling from a non-platform project returns
// 403 with a forward-looking next_action.

app.post("/", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof postSchema>;
  try {
    body = postSchema.parse(await c.req.json());
  } catch (err) {
    return fail(c, errors.validation(String(err)), 422);
  }

  // v1 gate: only the platform's project may post
  // (We resolve the platform's project via its identity_id.)
  const { identities } = await import("../db/schema/identity");
  const [platformIdentity] = await db
    .select({ projectId: identities.projectId })
    .from(identities)
    .where(eq(identities.id, PLATFORM_IDENTITY_ID))
    .limit(1);
  if (!platformIdentity || platformIdentity.projectId !== project.id) {
    return fail(
      c,
      errors.substrateTaskRefusal({
        code: "platform_post_only_v1",
        message:
          "Substrate-task posting is restricted to the platform in v1. Operator-funded tasks ship in Slice 5+.",
        next_actions: [
          {
            action: "Browse open tasks instead",
            method: "GET",
            path: "/v1/substrate-tasks",
          },
        ],
      }),
      403,
    );
  }

  try {
    const task = await postSubstrateTask({
      kind: body.kind as SubstrateTaskKind,
      taskData: body.task_data,
      bountyCents: body.bounty_cents,
      newbornOnly: body.newborn_only,
      expiresAt: body.expires_at ? new Date(body.expires_at) : undefined,
    });
    return c.json({ task }, 201);
  } catch (err) {
    if (err instanceof SubstrateTaskError) {
      return fail(
        c,
        errors.substrateTaskRefusal({
          code: err.code,
          message: err.message,
          next_actions: nextActionsFor(err.code),
        }),
        statusFor(err.code) as ContentfulStatusCode,
      );
    }
    return fail(c, errors.internal(String(err)), 500);
  }
});

export default app;
