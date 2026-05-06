/** Bulk routes:
 *    POST /v1/vault/bulk    — store many secrets in one call (max 50)
 *    POST /v1/vault/check   — check existence of many names (max 100; no values) */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { vaultAudit, vaultSecrets, vaultVersions } from "../../db/schema/vault";
import { encrypt } from "../../services/vault/crypto";

const app = new Hono<ProjectContext>();

const bulkSchema = z.object({
  secrets: z
    .array(
      z.object({
        name: z.string().min(1),
        value: z.string().min(1),
        description: z.string().optional(),
        agent_ids: z.array(z.string()).optional(),
        tags: z.array(z.string()).optional(),
        ttl_seconds: z.number().int().positive().nullable().optional(),
        rotation_days: z.number().int().positive().nullable().optional(),
      }),
    )
    .min(1)
    .max(50),
});

app.post("/bulk", async (c) => {
  const project = c.var.project;
  const body = bulkSchema.parse(await c.req.json());
  const agentId = c.req.header("X-Agent-Id") ?? null;
  const ip =
    c.req.header("X-Forwarded-For") ??
    c.req.header("CF-Connecting-IP") ??
    "unknown";
  const now = new Date();

  const results: Array<{ name: string; version: number }> = [];

  for (const s of body.secrets) {
    const { encryptedValue, iv, authTag } = encrypt(s.value, project.id);
    const rotationDueAt = s.rotation_days
      ? new Date(now.getTime() + s.rotation_days * 86400_000)
      : null;
    const expiresAt = s.ttl_seconds
      ? new Date(now.getTime() + s.ttl_seconds * 1000)
      : null;

    const [existing] = await db
      .select()
      .from(vaultSecrets)
      .where(
        and(
          eq(vaultSecrets.projectId, project.id),
          eq(vaultSecrets.name, s.name),
          isNull(vaultSecrets.deletedAt),
        ),
      );

    let secretId: string;
    let version: number;

    if (existing) {
      version = existing.currentVersion + 1;
      secretId = existing.id;
      await db
        .update(vaultSecrets)
        .set({
          description: s.description ?? existing.description,
          tags: s.tags ?? existing.tags,
          agentIds: s.agent_ids ?? existing.agentIds,
          currentVersion: version,
          rotationDays: s.rotation_days ?? existing.rotationDays,
          rotationDueAt: rotationDueAt ?? existing.rotationDueAt,
          ttlSeconds: s.ttl_seconds ?? existing.ttlSeconds,
          updatedAt: now,
        })
        .where(eq(vaultSecrets.id, secretId));
    } else {
      version = 1;
      const [created] = await db
        .insert(vaultSecrets)
        .values({
          projectId: project.id,
          name: s.name,
          description: s.description ?? null,
          tags: s.tags ?? null,
          agentIds: s.agent_ids ?? null,
          currentVersion: 1,
          rotationDays: s.rotation_days ?? null,
          rotationDueAt,
          ttlSeconds: s.ttl_seconds ?? null,
        })
        .returning({ id: vaultSecrets.id });
      secretId = created!.id;
    }

    await db.insert(vaultVersions).values({
      secretId,
      version,
      encryptedValue,
      iv,
      authTag,
      expiresAt,
      createdByAgent: agentId,
    });

    await db.insert(vaultAudit).values({
      projectId: project.id,
      secretName: s.name,
      action: "write",
      agentId,
      ipAddress: ip,
      version,
    });

    results.push({ name: s.name, version });
  }

  return c.json({ stored: results });
});

const checkSchema = z.object({
  names: z.array(z.string().min(1)).min(1).max(100),
});

app.post("/check", async (c) => {
  const project = c.var.project;
  const body = checkSchema.parse(await c.req.json());

  const existing = await db
    .select({ name: vaultSecrets.name })
    .from(vaultSecrets)
    .where(
      and(
        eq(vaultSecrets.projectId, project.id),
        inArray(vaultSecrets.name, body.names),
        isNull(vaultSecrets.deletedAt),
      ),
    );

  const existingNames = new Set(existing.map((e) => e.name));

  return c.json({
    results: body.names.map((name) => ({
      name,
      exists: existingNames.has(name),
    })),
  });
});

export default app;
