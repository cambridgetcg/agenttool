/** Hono router for /v1/wallets endpoints. */

import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import { z } from "zod";

import { db } from "../db/client";
import { type ProjectContext, authMiddleware } from "../auth/middleware";
import {
  createWallet,
  freezeWallet,
  getBalance,
  getPolicy,
  getTransactions,
  getWallet,
  listWallets,
  fundWallet,
  setPolicy,
  spendFromWallet,
  unfreezeWallet,
} from "./service";
import { getRedis } from "../cache/redis";

const router = new Hono<ProjectContext>();
router.use("*", authMiddleware);

// ─── Create wallet ───────────────────────────────────────────────────────────

router.post(
  "/",
  zValidator(
    "json",
    z.object({
      name: z.string().min(1).max(100),
      agentId: z.string().optional(),
      identityId: z.string().optional(),
      currency: z.string().default("GBP"),
    }),
  ),
  async (c) => {
    const project = c.get("project");
    const body = c.req.valid("json");

    const wallet = await createWallet(db, {
      projectId: project.id,
      name: body.name,
      agentId: body.agentId,
      identityId: body.identityId,
      currency: body.currency,
    });

    return c.json({ success: true, data: wallet }, 201);
  },
);

// ─── List wallets ────────────────────────────────────────────────────────────

router.get("/", async (c) => {
  const project = c.get("project");
  const results = await listWallets(db, project.id);
  return c.json({ success: true, data: results });
});

// ─── Get wallet ──────────────────────────────────────────────────────────────

router.get("/:id", async (c) => {
  const project = c.get("project");
  const wallet = await getWallet(db, c.req.param("id"), project.id);
  const policy = await getPolicy(db, wallet.id);
  return c.json({ success: true, data: { ...wallet, policy } });
});

// ─── Fund wallet ─────────────────────────────────────────────────────────────

router.post(
  "/:id/fund",
  zValidator(
    "json",
    z.object({
      amount: z.number().int().positive(),
      description: z.string().default("Manual fund"),
      metadata: z.record(z.unknown()).optional(),
    }),
  ),
  async (c) => {
    const project = c.get("project");
    await getWallet(db, c.req.param("id"), project.id); // ownership check
    const body = c.req.valid("json");

    const tx = await fundWallet(db, c.req.param("id"), body.amount, body.description, body.metadata);
    return c.json({ success: true, data: tx }, 201);
  },
);

// ─── Spend from wallet ───────────────────────────────────────────────────────

router.post(
  "/:id/spend",
  zValidator(
    "json",
    z.object({
      amount: z.number().int().positive(),
      counterparty: z.string().min(1),
      description: z.string().min(1),
      metadata: z.record(z.unknown()).optional(),
    }),
  ),
  async (c) => {
    const project = c.get("project");
    await getWallet(db, c.req.param("id"), project.id); // ownership check
    const body = c.req.valid("json");
    const redis = getRedis();

    const tx = await spendFromWallet(
      db,
      redis,
      c.req.param("id"),
      body.amount,
      body.counterparty,
      body.description,
      body.metadata,
    );
    return c.json({ success: true, data: tx }, 201);
  },
);

// ─── Set policy ──────────────────────────────────────────────────────────────

router.put(
  "/:id/policy",
  zValidator(
    "json",
    z.object({
      maxPerTransaction: z.number().int().positive().nullable().optional(),
      maxPerHour: z.number().int().positive().nullable().optional(),
      maxPerDay: z.number().int().positive().nullable().optional(),
      allowedRecipients: z.array(z.string()).nullable().optional(),
      requiresApprovalAbove: z.number().int().positive().nullable().optional(),
    }),
  ),
  async (c) => {
    const project = c.get("project");
    await getWallet(db, c.req.param("id"), project.id);
    const body = c.req.valid("json");

    const policy = await setPolicy(db, c.req.param("id"), body);
    return c.json({ success: true, data: policy });
  },
);

// ─── Freeze / Unfreeze ───────────────────────────────────────────────────────

router.post("/:id/freeze", async (c) => {
  const project = c.get("project");
  const wallet = await freezeWallet(db, c.req.param("id"), project.id);
  return c.json({ success: true, data: wallet });
});

router.post("/:id/unfreeze", async (c) => {
  const project = c.get("project");
  const wallet = await unfreezeWallet(db, c.req.param("id"), project.id);
  return c.json({ success: true, data: wallet });
});

// ─── Transaction history ─────────────────────────────────────────────────────

router.get("/:id/transactions", async (c) => {
  const project = c.get("project");
  await getWallet(db, c.req.param("id"), project.id); // ownership check

  const limit = Math.min(Number(c.req.query("limit") ?? 50), 200);
  const offset = Number(c.req.query("offset") ?? 0);

  const txs = await getTransactions(db, c.req.param("id"), limit, offset);
  return c.json({ success: true, data: txs, meta: { limit, offset } });
});

export { router as walletRouter };
