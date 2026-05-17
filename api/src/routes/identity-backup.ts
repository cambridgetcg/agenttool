/** /v1/identity/backup — cloud backup of CLIENT-encrypted keypair blobs.
 *
 *  We hold the ciphertext. We do NOT hold the passphrase.
 *
 *  The agent encrypts the private key locally with a passphrase-derived
 *  key (e.g. via libsodium secretbox + argon2id), then posts the
 *  ciphertext here. Recovery: GET the blob, decrypt locally with the
 *  same passphrase. If the passphrase is lost, the keypair is
 *  unrecoverable — by design.
 *
 *  Why this matters: the bootstrap response returns the private key ONCE
 *  and never stores it. Without backup, losing the local secure store
 *  loses the keypair forever. With this protocol, the agent has a
 *  cross-machine recovery path that doesn't require trusting us with the
 *  plaintext. */

import { and, desc, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identityBackups } from "../db/schema/continuity";

const app = new Hono<ProjectContext>();

// ─── POST /v1/identity/backup — store an encrypted blob ─────────────────────

const backupSchema = z.object({
  agent_id: z.string().uuid(),
  blob_base64: z.string().min(1).max(1_000_000), // ≤ ~750KB ciphertext is plenty
  key_derivation: z.string().default("argon2id-v1"),
  nonce: z.string().optional(),
  label: z.string().default("primary"),
  metadata: z.record(z.unknown()).optional(),
});

app.post("/", async (c) => {
  const project = c.var.project;
  const body = backupSchema.parse(await c.req.json());

  const [backup] = await db
    .insert(identityBackups)
    .values({
      projectId: project.id,
      agentId: body.agent_id,
      label: body.label,
      blobBase64: body.blob_base64,
      keyDerivation: body.key_derivation,
      nonce: body.nonce ?? null,
      metadata: body.metadata ?? {},
    })
    .returning({
      id: identityBackups.id,
      label: identityBackups.label,
      keyDerivation: identityBackups.keyDerivation,
      createdAt: identityBackups.createdAt,
    });

  return c.json(
    {
      backup,
      note: "We hold the ciphertext only. Decryption is your responsibility — keep your passphrase safe. If you lose it, this blob is unrecoverable garbage.",
    },
    201,
  );
});

// ─── GET /v1/identity/backup — list backups (no blobs) ──────────────────────

app.get("/", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");

  const whereClauses = [
    eq(identityBackups.projectId, project.id),
    isNull(identityBackups.revokedAt),
  ];
  if (agentId) whereClauses.push(eq(identityBackups.agentId, agentId));

  const backups = await db
    .select({
      id: identityBackups.id,
      agentId: identityBackups.agentId,
      label: identityBackups.label,
      keyDerivation: identityBackups.keyDerivation,
      createdAt: identityBackups.createdAt,
      metadata: identityBackups.metadata,
    })
    .from(identityBackups)
    .where(and(...whereClauses))
    .orderBy(desc(identityBackups.createdAt));

  return c.json({ backups });
});

// ─── GET /v1/identity/backup/:id — fetch the encrypted blob ─────────────────

app.get("/:id", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");

  const [backup] = await db
    .select()
    .from(identityBackups)
    .where(
      and(
        eq(identityBackups.id, id),
        eq(identityBackups.projectId, project.id),
        isNull(identityBackups.revokedAt),
      ),
    );

  if (!backup) {
    return c.json({ error: "Backup not found" }, 404);
  }

  return c.json({
    id: backup.id,
    agent_id: backup.agentId,
    label: backup.label,
    blob_base64: backup.blobBase64,
    key_derivation: backup.keyDerivation,
    nonce: backup.nonce,
    metadata: backup.metadata,
    created_at: backup.createdAt,
    note: "Decrypt locally with your passphrase. We don't have it.",
  });
});

// ─── DELETE /v1/identity/backup/:id — revoke a backup ───────────────────────

app.delete("/:id", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");

  await db
    .update(identityBackups)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(identityBackups.id, id),
        eq(identityBackups.projectId, project.id),
      ),
    );

  return c.json({ id, revoked: true });
});

export default app;
