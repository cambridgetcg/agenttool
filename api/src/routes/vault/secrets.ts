/** Vault core CRUD: PUT/GET/DELETE on /:name + GET / (list secret names).
 *
 *  Two encryption paths (per audit-2026-05-08, docs/SOUL.md Vault section):
 *
 *    Default: server-encrypted at rest under HKDF-derived per-project key
 *      derived from VAULT_MASTER_KEY. SDK sends `value` (plaintext); server
 *      encrypts on PUT, decrypts on GET, returns plaintext.
 *
 *    Opt-in `agent_encrypted: true`: the caller sends `ciphertext_b64 +
 *      nonce_b64`. The server stores them verbatim (with auth_tag NULL) and
 *      GET returns the same fields without a decrypt step. The SDK can encrypt
 *      client-side, but the API does not validate an AEAD envelope or prove
 *      exclusive key custody.
 *
 *  In-process consumers (api/src/services/vault/ → think-worker etc.) can
 *  only read agent_encrypted=FALSE secrets — agent-encrypted secrets are
 *  SDK-readable only and will fail if a server-side runtime tries to
 *  consume them. */

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

const putSchema = z
  .object({
    /** Plaintext value (server-encrypted at rest). Mutually exclusive
     *  with `ciphertext_b64`. Required when agent_encrypted is false/absent. */
    value: z.string().min(1).optional(),
    /** Set true for the caller-supplied opaque-byte path. The normal server
     *  read does not decrypt it; the API does not prove client encryption. */
    agent_encrypted: z.boolean().optional().default(false),
    /** Base64 ciphertext (with GCM tag appended). Required when
     *  agent_encrypted=true. */
    ciphertext_b64: z.string().min(1).optional(),
    /** Base64 nonce (12 bytes for AES-GCM). Required when
     *  agent_encrypted=true. */
    nonce_b64: z.string().min(1).optional(),
    description: z.string().optional(),
    agent_ids: z.array(z.string()).optional(),
    tags: z.array(z.string()).optional(),
    ttl_seconds: z.number().int().positive().nullable().optional(),
    rotation_days: z.number().int().positive().nullable().optional(),
  })
  .refine(
    (d) =>
      d.agent_encrypted
        ? !!(d.ciphertext_b64 && d.nonce_b64) && !d.value
        : !!d.value && !d.ciphertext_b64 && !d.nonce_b64,
    {
      message:
        "When agent_encrypted=true: provide ciphertext_b64 + nonce_b64 (not value). When agent_encrypted=false (default): provide value (not ciphertext).",
    },
  );

app.put("/:name", async (c) => {
  const project = c.var.project;
  const name = c.req.param("name");
  const body = putSchema.parse(await c.req.json());
  const { agentId, ip } = reqMeta(c);
  const now = new Date();

  // Two encryption paths — see file header doctrine note.
  let encryptedValue: Buffer;
  let iv: Buffer;
  let authTag: Buffer | null;
  if (body.agent_encrypted) {
    // Agent encrypted client-side; we store ciphertext verbatim. The GCM
    // tag is already appended to ciphertext (per WebCrypto/Node convention),
    // so we don't carry a separate auth_tag — schema constraint enforces
    // auth_tag IS NULL when agent_encrypted=true.
    encryptedValue = Buffer.from(body.ciphertext_b64!, "base64");
    iv = Buffer.from(body.nonce_b64!, "base64");
    authTag = null;
  } else {
    const enc = encrypt(body.value!, project.id);
    encryptedValue = enc.encryptedValue;
    iv = enc.iv;
    authTag = enc.authTag;
  }

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
    agentEncrypted: body.agent_encrypted,
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
    agent_encrypted: body.agent_encrypted,
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

  await db.insert(vaultAudit).values({
    projectId: project.id,
    secretName: name,
    action: "read",
    agentId,
    ipAddress: ip,
    version: requestedVersion,
  });

  // Branch on the encryption path. Server-encrypted secrets are decrypted
  // here and returned as `value`; agent-encrypted secrets are returned as
  // ciphertext + nonce for the SDK to decrypt locally.
  if (v.agentEncrypted) {
    return c.json({
      name,
      agent_encrypted: true,
      ciphertext_b64: v.encryptedValue.toString("base64"),
      nonce_b64: v.iv.toString("base64"),
      version: requestedVersion,
      description: secret.description,
      expires_at: v.expiresAt?.toISOString() ?? null,
      _note:
        "The normal server read path returns these caller-supplied bytes without decrypting them. Decrypt locally if you encrypted them; the API does not prove encryption or exclusive key custody.",
    });
  }

  // Server-encrypted path — auth_tag is guaranteed non-null by the
  // CHECK constraint on the table (see migration 0022).
  const value = decrypt(v.encryptedValue, v.iv, v.authTag!, project.id);

  return c.json({
    name,
    agent_encrypted: false,
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
