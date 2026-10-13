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
import { HTTPException } from "hono/http-exception";
import { z } from "zod";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { vaultAudit, vaultSecrets, vaultVersions } from "../../db/schema/vault";
import { decrypt, encrypt } from "../../services/vault/crypto";
import { authorizeVaultHttpRead, validateVaultAudience, vaultAudienceSchema } from "../../services/vault/audience";
import { abort } from "../../lib/errors";
import { pushLedgerMirrorAfterCommit } from "../../services/deletion/mirror";
import { ledgerResponse } from "../../services/deletion/record";
import { DELETE_RESPONSE_RETENTION } from "../../services/discovery/retention";
import { eraseVaultSecret } from "../../services/vault/erase";

const app = new Hono<ProjectContext>();

function reqMeta(c: Context<ProjectContext>) {
  return {
    // A project-admin write does not prove the identity named in a caller header.
    agentId: null,
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
    agent_ids: vaultAudienceSchema.optional(),
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
  const audience = body.agent_ids === undefined
    ? undefined
    : await validateVaultAudience(project.id, body.agent_ids);
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
        ...(audience === undefined ? {} : { agentIds: audience }),
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
        agentIds: audience ?? null,
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
    agent_ids: audience === undefined ? (existing?.agentIds ?? null) : audience,
  });
});

// Restricted values require root proof; metadata routes retain project-admin scope.

app.get("/:name", async (c) => {
  const project = c.var.project;
  const name = c.req.param("name");
  const versionParam = c.req.query("version");
  const { ip } = reqMeta(c);
  let agentId: string | null = null;
  c.header("Cache-Control", "private, no-store");

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

  try {
    agentId = await authorizeVaultHttpRead({
      projectId: project.id,
      audience: secret.agentIds,
      selectedIdentity: c.req.header("X-Agent-Id") ?? null,
      request: c.req.raw,
    });
  } catch (error) {
    if (error instanceof HTTPException) {
      await db.insert(vaultAudit).values({
        projectId: project.id,
        secretName: name,
        action: "access_denied",
        agentId,
        ipAddress: ip,
      });
    }
    throw error;
  }

  const requestedVersion = versionParam
    ? Number(versionParam)
    : secret.currentVersion;
  if (!Number.isSafeInteger(requestedVersion) || requestedVersion < 1) {
    abort({ error: "invalid_vault_version", message: "version must be a positive integer.", docs: "https://docs.agenttool.dev/IDENTITY-PARTITIONS.md" }, 400);
  }

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

// ─── DELETE /:name — purge (audit row preserved) ────────────────────────────
//  Zeroes every stored version and marks the secret deleted, with one
//  ids-only ledger entry and a deletion moment in the same transaction
//  (services/vault/erase.ts). 503 deletion_ledger_unavailable deletes
//  nothing. The upstream credential is not revoked by this.

app.delete("/:name", async (c) => {
  const project = c.var.project;
  const name = c.req.param("name");
  const { agentId, ip } = reqMeta(c);

  const erased = await eraseVaultSecret(project.id, name, { agentId, ip });
  if (!erased) {
    return c.json({ error: "Secret not found" }, 404);
  }
  const { mirrored } = await pushLedgerMirrorAfterCommit(db, erased.entry.seq);

  return c.json({
    name,
    deleted: true,
    content_retained: false,
    versions_zeroed: erased.versionsZeroed,
    purged_at: erased.deletedAt,
    ledger: ledgerResponse(erased.entry, mirrored),
    _retention: DELETE_RESPONSE_RETENTION.vault,
  });
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
