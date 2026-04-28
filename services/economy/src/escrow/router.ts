/** Hono router for /v1/escrows endpoints. */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { db } from "../db/client";
import { type ProjectContext, authMiddleware } from "../auth/middleware";
import {
  acceptEscrow,
  createEscrow,
  disputeEscrow,
  getEscrow,
  listEscrows,
  refundEscrow,
  releaseEscrow,
} from "./service";
import { getRedis } from "../cache/redis";

const router = new Hono<ProjectContext>();
router.use("*", authMiddleware);

// ─── Create escrow ───────────────────────────────────────────────────────────

router.post(
  "/",
  zValidator(
    "json",
    z.object({
      creatorWalletId: z.string().uuid(),
      workerWalletId: z.string().uuid().optional(),
      amount: z.number().int().positive(),
      description: z.string().min(1).max(500),
      deadline: z.string().datetime().optional(),
    }),
  ),
  async (c) => {
    const project = c.get("project");
    const body = c.req.valid("json");
    const redis = getRedis();

    const escrow = await createEscrow(db, redis, {
      creatorWalletId: body.creatorWalletId,
      workerWalletId: body.workerWalletId,
      amount: body.amount,
      description: body.description,
      deadline: body.deadline ? new Date(body.deadline) : undefined,
      projectId: project.id,
    });

    return c.json({ success: true, data: escrow }, 201);
  },
);

// ─── List escrows ────────────────────────────────────────────────────────────

router.get("/", async (c) => {
  const project = c.get("project");
  const status = c.req.query("status");
  const results = await listEscrows(db, project.id, status);
  return c.json({ success: true, data: results });
});

// ─── Get escrow ──────────────────────────────────────────────────────────────

router.get("/:id", async (c) => {
  const project = c.get("project");
  const escrow = await getEscrow(db, c.req.param("id"), project.id);
  return c.json({ success: true, data: escrow });
});

// ─── Accept ──────────────────────────────────────────────────────────────────

router.post(
  "/:id/accept",
  zValidator("json", z.object({ workerWalletId: z.string().uuid() })),
  async (c) => {
    const body = c.req.valid("json");
    const escrow = await acceptEscrow(db, c.req.param("id"), body.workerWalletId);
    return c.json({ success: true, data: escrow });
  },
);

// ─── Release ─────────────────────────────────────────────────────────────────

router.post("/:id/release", async (c) => {
  const project = c.get("project");
  const redis = getRedis();
  const escrow = await releaseEscrow(db, redis, c.req.param("id"), project.id);
  return c.json({ success: true, data: escrow });
});

// ─── Refund ──────────────────────────────────────────────────────────────────

router.post("/:id/refund", async (c) => {
  const project = c.get("project");
  const redis = getRedis();
  const escrow = await refundEscrow(db, redis, c.req.param("id"), project.id);
  return c.json({ success: true, data: escrow });
});

// ─── Dispute ─────────────────────────────────────────────────────────────────

router.post("/:id/dispute", async (c) => {
  const project = c.get("project");
  const escrow = await disputeEscrow(db, c.req.param("id"), project.id);
  return c.json({ success: true, data: escrow });
});

export { router as escrowRouter };
