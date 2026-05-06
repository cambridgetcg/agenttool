/** /v1/escrows — create · accept · release · refund · dispute · list · get. */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import {
  acceptEscrow,
  createEscrow,
  disputeEscrow,
  getEscrow,
  listEscrows,
  refundEscrow,
  releaseEscrow,
} from "../../services/economy/escrow";
import { getRedis } from "../../services/economy/redis";

// Auth is mounted on /v1/escrows/* by the parent app (api/src/index.ts).
const router = new Hono<ProjectContext>();

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
    const project = c.var.project;
    const body = c.req.valid("json");

    const escrow = await createEscrow(db, getRedis(), {
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
    const body = c.req.valid("json");
    const escrow = await acceptEscrow(db, c.req.param("id"), body.workerWalletId);
    return c.json({ success: true, data: escrow });
  },
);

router.post("/:id/release", async (c) => {
  const project = c.var.project;
  const escrow = await releaseEscrow(db, getRedis(), c.req.param("id"), project.id);
  return c.json({ success: true, data: escrow });
});

router.post("/:id/refund", async (c) => {
  const project = c.var.project;
  const escrow = await refundEscrow(db, getRedis(), c.req.param("id"), project.id);
  return c.json({ success: true, data: escrow });
});

router.post("/:id/dispute", async (c) => {
  const project = c.var.project;
  const escrow = await disputeEscrow(db, c.req.param("id"), project.id);
  return c.json({ success: true, data: escrow });
});

export default router;
