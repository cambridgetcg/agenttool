/** /v1/escrows — create · accept · release · refund · dispute · list · get.
 *
 *  Generic escrow create is resting: after the parent app's authentication,
 *  POST /v1/escrows refuses every request with stable 503 escrow_resting
 *  before body validation or any escrow or wallet database read, so no
 *  wallet is debited. Release and refund are open, so escrows that already
 *  exist settle at the creator's direction, under the settlement checks in
 *  services/economy/escrow.ts; accept (worker assignment), dispute, list,
 *  and get stay open too. None of these routes uses Redis.
 *  Policy: services/economy/config.ts genericEscrowCreateAllowed().
 *  Contract: docs/SAFETY-BOUNDARIES.md ("Generic escrow create and wallet
 *  spend — resting"). The create handler below is kept intact for a
 *  reviewed reopening. */

import { zValidator } from "@hono/zod-validator";
import { Hono, type MiddlewareHandler } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { errors, fail } from "../../lib/errors";
import { genericEscrowCreateAllowed } from "../../services/economy/config";
import {
  acceptEscrow,
  createEscrow,
  disputeEscrow,
  getEscrow,
  listEscrows,
  refundEscrow,
  releaseEscrow,
} from "../../services/economy/escrow";

// Auth is mounted on /v1/escrows/* by the parent app (api/src/index.ts).
const router = new Hono<ProjectContext>();

/** Runs first on create (after the parent app's authMiddleware), so the
 *  resting refusal never depends on the body or an escrow or wallet read.
 *  Release and refund do not pass through it. */
const genericEscrowCreateResting: MiddlewareHandler<ProjectContext> = async (
  c,
  next,
) => {
  if (!genericEscrowCreateAllowed()) {
    return fail(c, errors.escrowResting(), 503);
  }
  await next();
};

router.post(
  "/",
  genericEscrowCreateResting,
  zValidator(
    "json",
    z.object({
      creatorWalletId: z.string().uuid(),
      workerWalletId: z.string().uuid().optional(),
      amount: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
      description: z.string().min(1).max(500),
      deadline: z.string().datetime().optional(),
    }),
  ),
  async (c) => {
    const project = c.var.project;
    const body = c.req.valid("json");
    const idempotencyKey = c.req.header("Idempotency-Key");

    const outcome = await createEscrow(db, {
      creatorWalletId: body.creatorWalletId,
      workerWalletId: body.workerWalletId,
      amount: body.amount,
      description: body.description,
      deadline: body.deadline ? new Date(body.deadline) : undefined,
      projectId: project.id,
      idempotencyKey,
    });

    c.header("X-Idempotency-Supported", "Idempotency-Key");
    if (outcome.replayed) c.header("Idempotent-Replay", "true");
    return c.json({ success: true, data: outcome.escrow }, 201);
  },
);

router.get("/", async (c) => {
  const project = c.var.project;
  const status = c.req.query("status");
  const results = await listEscrows(db, project.id, status);
  return c.json({ success: true, data: results });
});

router.get("/:id", async (c) => {
  const project = c.var.project;
  const escrow = await getEscrow(db, c.req.param("id"), project.id);
  return c.json({ success: true, data: escrow });
});

router.post(
  "/:id/accept",
  zValidator("json", z.object({ workerWalletId: z.string().uuid() })),
  async (c) => {
    const project = c.var.project;
    const body = c.req.valid("json");
    const escrow = await acceptEscrow(
      db,
      c.req.param("id"),
      body.workerWalletId,
      project.id,
    );
    return c.json({ success: true, data: escrow });
  },
);

router.post("/:id/release", async (c) => {
  const project = c.var.project;
  const escrow = await releaseEscrow(db, c.req.param("id"), project.id);
  return c.json({ success: true, data: escrow });
});

router.post("/:id/refund", async (c) => {
  const project = c.var.project;
  const escrow = await refundEscrow(db, c.req.param("id"), project.id);
  return c.json({ success: true, data: escrow });
});

router.post("/:id/dispute", async (c) => {
  const project = c.var.project;
  const escrow = await disputeEscrow(db, c.req.param("id"), project.id);
  return c.json({ success: true, data: escrow });
});

export default router;
