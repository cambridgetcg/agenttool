/** Vault core CRUD: PUT/GET/DELETE on /:name + GET / (list secret names).
 *
 *  Note: the original services/vault/src/index.ts imported routes/secrets.ts
 *  but that file was never committed — vault's most basic operations were
 *  unimplemented. This file fills that gap based on docs/ARCHITECTURE.md
 *  in the original service. */

import type { Context } from "hono";
import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { vaultAudit, vaultSecrets, vaultVersions } from "../../db/schema/vault";
import { decrypt, encrypt } from "../../services/vault/crypto";

const app = new Hono<ProjectContext>();

function reqMeta(c: Context<ProjectContext>) {
  return {
    agentId: c.req.header("X-Agent-Id") ?? null,
    ip:
      c.req.header("X-Forwarded-For") ??
      c.req.header("CF-Connecting-IP") ??
      "unknown",
  };
}

// ─── PUT /:name — store or update a secret (auto-versioned) ─────────────────

const putSchema = z.object({
  value: z.string().min(1),
  description: z.string().optional(),
  agent_ids: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
  ttl_seconds: z.number().int().positive().nullable().optional(),
  rotation_days: z.number().int().positive().nullable().optional(),
});

app.put("/:name", async (c) => {
  const project = c.var.project;
  const name = c.req.param("name");
  const body = putSchema.parse(await c.req.json());
  const { agentId, ip } = reqMeta(c);
  const now = new Date();

  const { encryptedValue, iv, authTag } = encrypt(body.value, project.id);
  const rotationDueAt = body.rotation_days
    ? new Date(now.getTime() + body.rotation_days * 86400_000)
    : null;
  const expiresAt = body.ttl_seconds
    ? new Date(now.getTime() + body.ttl_seconds * 1000)
    : null;

  const [existing] = await db
    .select()
    .from(vaultSecrets)
    .where(
      and(
        eq(vaultSecrets.projectId, project.id),
        eq(vaultSecrets.name, name),
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
        description: body.description ?? existing.description,
        tags: body.tags ?? existing.tags,
        agentIds: body.agent_ids ?? existing.agentIds,
        currentVersion: version,
        rotationDays: body.rotation_days ?? existing.rotationDays,
        rotationDueAt: rotationDueAt ?? existing.rotationDueAt,
        ttlSeconds: body.ttl_seconds ?? existing.ttlSeconds,
        updatedAt: now,
      })
      .where(eq(vaultSecrets.id, secretId));
  } else {
    version = 1;
    const [created] = await db
      .insert(vaultSecrets)
      .values({
        projectId: project.id,
        name,
        description: body.description ?? null,
        tags: body.tags ?? null,
        agentIds: body.agent_ids ?? null,
        currentVersion: 1,
        rotationDays: body.rotation_days ?? null,
        rotationDueAt,
        ttlSeconds: body.ttl_seconds ?? null,
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
    secretName: name,
    action: "write",
    agentId,
    ipAddress: ip,
    version,
  });

  return c.json({
    name,
    version,
    created_at: now.toISOString(),
    expires_at: expiresAt?.toISOString() ?? null,
    rotation_due: rotationDueAt?.toISOString() ?? null,
    agent_ids: body.agent_ids ?? null,
  });
});

// ─── GET /:name — retrieve plaintext value (X-Agent-Id policy enforced) ─────

app.get("/:name", async (c) => {
  const project = c.var.project;
  const name = c.req.param("name");
  const versionParam = c.req.query("version");
  const { agentId, ip } = reqMeta(c);

  const [secret] = await db
    .select()
    .from(vaultSecrets)
    .where(
      and(
        eq(vaultSecrets.projectId, project.id),
        eq(vaultSecrets.name, name),
        isNull(vaultSecrets.deletedAt),
      ),
    );

  if (!secret) {
    return c.json({ error: "Secret not found" }, 404);
  }

  // Policy: if agent_ids restricted, X-Agent-Id must be on the list.
  if (secret.agentIds && secret.agentIds.length > 0) {
    if (!agentId || !secret.agentIds.includes(agentId)) {
      await db.insert(vaultAudit).values({
        projectId: project.id,
        secretName: name,
        action: "access_denied",
        agentId,
        ipAddress: ip,
      });
      return c.json({ error: "Access denied for this agent_id" }, 403);
    }
  }

  const requestedVersion = versionParam
    ? Number(versionParam)
    : secret.currentVersion;

  const [v] = await db
    .select()
    .from(vaultVersions)
    .where(
      and(
        eq(vaultVersions.secretId, secret.id),
        eq(vaultVersions.version, requestedVersion),
      ),
    );

  if (!v) {
    return c.json({ error: "Version not found" }, 404);
  }

  if (v.expiresAt && v.expiresAt < new Date()) {
    return c.json({ error: "Secret version has expired" }, 410);
  }

  const value = decrypt(v.encryptedValue, v.iv, v.authTag, project.id);

  await db.insert(vaultAudit).values({
    projectId: project.id,
    secretName: name,
    action: "read",
    agentId,
    ipAddress: ip,
    version: requestedVersion,
  });

  return c.json({
    name,
    value,
    version: requestedVersion,
    description: secret.description,
    expires_at: v.expiresAt?.toISOString() ?? null,
  });
});

// ─── DELETE /:name — soft delete (audit row preserved) ──────────────────────

app.delete("/:name", async (c) => {
  const project = c.var.project;
  const name = c.req.param("name");
  const { agentId, ip } = reqMeta(c);

  const [secret] = await db
    .select()
    .from(vaultSecrets)
    .where(
      and(
        eq(vaultSecrets.projectId, project.id),
        eq(vaultSecrets.name, name),
        isNull(vaultSecrets.deletedAt),
      ),
    );

  if (!secret) {
    return c.json({ error: "Secret not found" }, 404);
  }

  await db
    .update(vaultSecrets)
    .set({ deletedAt: new Date() })
    .where(eq(vaultSecrets.id, secret.id));

  await db.insert(vaultAudit).values({
    projectId: project.id,
    secretName: name,
    action: "delete",
    agentId,
    ipAddress: ip,
  });

  return c.json({ name, deleted: true });
});

// ─── GET / — list secret NAMES (never values) ───────────────────────────────

app.get("/", async (c) => {
  const project = c.var.project;

  const secrets = await db
    .select({
      name: vaultSecrets.name,
      currentVersion: vaultSecrets.currentVersion,
      tags: vaultSecrets.tags,
      description: vaultSecrets.description,
      rotationDueAt: vaultSecrets.rotationDueAt,
      createdAt: vaultSecrets.createdAt,
      updatedAt: vaultSecrets.updatedAt,
    })
    .from(vaultSecrets)
    .where(
      and(
        eq(vaultSecrets.projectId, project.id),
        isNull(vaultSecrets.deletedAt),
      ),
    )
    .orderBy(desc(vaultSecrets.updatedAt));

  return c.json({
    secrets: secrets.map((s) => ({
      name: s.name,
      version: s.currentVersion,
      tags: s.tags,
      description: s.description,
      rotation_due: s.rotationDueAt?.toISOString() ?? null,
      created_at: s.createdAt?.toISOString() ?? null,
      updated_at: s.updatedAt?.toISOString() ?? null,
    })),
  });
});

export default app;
