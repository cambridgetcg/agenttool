/** Key management — list, rotate, revoke ed25519 keys for an identity.
 *  Mounts under /v1/identities/:id/keys */

import { and, eq, isNull } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identities, identityKeys } from "../../db/schema/identity";
import { errors, fail } from "../../lib/errors";
import {
  authorizeIdentityMutation,
  authorityRequestTarget,
  readAuthorityBoundJson,
  readEmptyAuthorityBody,
} from "../../services/identity/authority";
import { generateKeypair } from "../../services/identity/crypto";

const app = new Hono<ProjectContext>();

type KeyInsertResult =
  | { kind: "created"; key: typeof identityKeys.$inferSelect }
  | { kind: "identity_not_found" }
  | { kind: "identity_memorial_terminal" };

async function insertKeyForMutableIdentity(input: {
  projectId: string;
  identityId: string;
  publicKey: string;
  label: string;
}): Promise<KeyInsertResult> {
  return db.transaction(async (tx): Promise<KeyInsertResult> => {
    const [identity] = await tx
      .select({ status: identities.status })
      .from(identities)
      .where(
        and(
          eq(identities.id, input.identityId),
          eq(identities.projectId, input.projectId),
        ),
      )
      .limit(1)
      .for("update");

    if (!identity) return { kind: "identity_not_found" };
    if (identity.status === "memorial") {
      return { kind: "identity_memorial_terminal" };
    }

    const [key] = await tx
      .insert(identityKeys)
      .values({
        identityId: input.identityId,
        publicKey: input.publicKey,
        label: input.label,
        active: true,
      })
      .returning();

    return { kind: "created", key: key! };
  });
}

type KeyRevokeResult =
  | { kind: "revoked" }
  | { kind: "identity_not_found" }
  | { kind: "identity_memorial_terminal" }
  | { kind: "key_not_found" };

async function revokeKeyForMutableIdentity(input: {
  projectId: string;
  identityId: string;
  keyId: string;
}): Promise<KeyRevokeResult> {
  return db.transaction(async (tx): Promise<KeyRevokeResult> => {
    const [identity] = await tx
      .select({ status: identities.status })
      .from(identities)
      .where(
        and(
          eq(identities.id, input.identityId),
          eq(identities.projectId, input.projectId),
        ),
      )
      .limit(1)
      .for("update");

    if (!identity) return { kind: "identity_not_found" };
    if (identity.status === "memorial") {
      return { kind: "identity_memorial_terminal" };
    }

    const [revoked] = await tx
      .update(identityKeys)
      .set({ active: false, revokedAt: new Date() })
      .where(
        and(
          eq(identityKeys.id, input.keyId),
          eq(identityKeys.identityId, input.identityId),
          isNull(identityKeys.revokedAt),
        ),
      )
      .returning({ id: identityKeys.id });

    return revoked ? { kind: "revoked" } : { kind: "key_not_found" };
  });
}

/** GET /v1/identities/:id/keys — List keys (active and revoked). */
app.get("/", async (c) => {
  const project = c.var.project;
  const identityId = c.req.param("id")!;

  const [ownedIdentity] = await db
    .select({
      id: identities.id,
      authorityRootPublicKey: identities.authorityRootPublicKey,
      authoritySequence: identities.authoritySequence,
    })
    .from(identities)
    .where(
      and(
        eq(identities.id, identityId),
        eq(identities.projectId, project.id),
      ),
    )
    .limit(1);

  if (!ownedIdentity) {
    return c.json({ error: "Identity not found or not owned by this project" }, 404);
  }

  const keys = await db
    .select({
      id: identityKeys.id,
      publicKey: identityKeys.publicKey,
      label: identityKeys.label,
      active: identityKeys.active,
      createdAt: identityKeys.createdAt,
      revokedAt: identityKeys.revokedAt,
    })
    .from(identityKeys)
    .where(eq(identityKeys.identityId, identityId));

  return c.json({
    keys: keys.map((k) => ({
      kid: k.id,
      public_key: k.publicKey,
      label: k.label,
      active: k.active,
      created_at: k.createdAt,
      revoked_at: k.revokedAt,
      authority_root: ownedIdentity.authorityRootPublicKey === k.publicKey,
    })),
    authority: {
      mode: ownedIdentity.authorityRootPublicKey ? "agent_root" : "legacy_bearer",
      sequence: ownedIdentity.authoritySequence,
      next_sequence: ownedIdentity.authoritySequence + 1,
    },
  });
});

/** POST /v1/identities/:id/keys — Rotate (add a new active key). */
app.post("/", async (c) => {
  const project = c.var.project;
  const identityId = c.req.param("id")!;
  const body = await c.req.json<{ label?: string }>();

  const [identity] = await db
    .select({ authorityRootPublicKey: identities.authorityRootPublicKey })
    .from(identities)
    .where(and(eq(identities.id, identityId), eq(identities.projectId, project.id)))
    .limit(1);
  if (!identity) {
    return fail(
      c,
      errors.refusal({
        error: "Identity not found or not owned by this project",
        message: "The selected identity does not belong to this bearer project.",
        next_actions: [
          {
            action: "list identities available to this bearer",
            method: "GET",
            path: "/v1/identities",
          },
        ],
        docs: "https://docs.agenttool.dev/IDENTITY-ANCHOR.md",
      }),
      404,
    );
  }
  if (identity.authorityRootPublicKey) {
    return fail(
      c,
      errors.refusal({
        error: "server_generated_key_forbidden",
        message:
          "This identity is agent-rooted. The server will not generate private signing material for its bearer.",
        hint:
          "Generate an ed25519 key locally, then root-authorize POST /keys/import so agenttool receives only the public key.",
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      }),
      409,
    );
  }

  const { publicKey, privateKey } = generateKeypair();
  const label = body.label ?? `rotation-${new Date().toISOString().slice(0, 7)}`;
  const inserted = await insertKeyForMutableIdentity({
    projectId: project.id,
    identityId,
    publicKey,
    label,
  });
  if (inserted.kind === "identity_not_found") {
    return c.json({ error: "Identity not found or not owned by this project" }, 404);
  }
  if (inserted.kind === "identity_memorial_terminal") {
    return c.json(
      {
        error: inserted.kind,
        message: "A memorial identity cannot receive a new signing key.",
      },
      409,
    );
  }
  const key = inserted.key;

  return c.json(
    {
      kid: key.id,
      public_key: publicKey,
      private_key: privateKey, // returned ONCE
      label: key.label,
      created_at: key.createdAt,
    },
    201,
  );
});

/** POST /v1/identities/:id/keys/import — Register an externally-generated
 *  ed25519 pubkey as one of this identity's keys. The platform never sees
 *  the private key (held client-side; for the bridged-runtime path, in the
 *  bridge sidecar's keychain). The returned `kid` is what `bridge.key_id`
 *  references when provisioning a runtime; signed thoughts coming back via
 *  the bridge will verify against this row. */
app.post("/import", async (c) => {
  const project = c.var.project;
  const identityId = c.req.param("id")!;
  let bound: Awaited<ReturnType<typeof readAuthorityBoundJson>>;
  try {
    bound = await readAuthorityBoundJson(c.req.raw);
  } catch {
    return fail(
      c,
      errors.refusal({
        error: "body_must_be_json",
        message: "Send one JSON object and sign those exact entity bytes.",
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      }),
      400,
    );
  }
  const body = bound.value as { public_key?: unknown; label?: unknown };

  if (typeof body.public_key !== "string" || body.public_key.length === 0) {
    return c.json({ error: "public_key required (base64 ed25519 32-byte pubkey)" }, 400);
  }
  // Require canonical standard base64 for one 32-byte Ed25519 public key.
  let decoded: Buffer;
  try {
    decoded = Buffer.from(body.public_key, "base64");
  } catch {
    return c.json({ error: "public_key must be valid base64" }, 400);
  }
  if (decoded.length !== 32 || decoded.toString("base64") !== body.public_key) {
    return c.json(
      { error: "public_key must be canonical base64 encoding exactly 32 bytes" },
      400,
    );
  }

  const label =
    typeof body.label === "string" && body.label.length > 0 ? body.label : "imported";

  const [identity] = await db
    .select({ status: identities.status })
    .from(identities)
    .where(and(eq(identities.id, identityId), eq(identities.projectId, project.id)))
    .limit(1);
  if (!identity) {
    return fail(
      c,
      errors.refusal({
        error: "Identity not found or not owned by this project",
        message: "The selected identity does not belong to this bearer project.",
        next_actions: [
          {
            action: "list identities available to this bearer",
            method: "GET",
            path: "/v1/identities",
          },
        ],
        docs: "https://docs.agenttool.dev/IDENTITY-ANCHOR.md",
      }),
      404,
    );
  }
  if (identity.status === "memorial") {
    return fail(
      c,
      errors.refusal({
        error: "identity_memorial_terminal",
        message: "A memorial identity cannot receive a new signing key.",
        docs: "https://docs.agenttool.dev/AT-REST.md",
      }),
      409,
    );
  }

  const authority = await authorizeIdentityMutation({
    identityId,
    method: c.req.method,
    requestTarget: authorityRequestTarget(c.req.url),
    bodyBytes: bound.bodyBytes,
    headers: c.req.raw.headers,
  });
  if (!authority.ok) return c.json(authority.body, authority.status);

  const inserted = await insertKeyForMutableIdentity({
    projectId: project.id,
    identityId,
    publicKey: body.public_key,
    label,
  });
  if (inserted.kind === "identity_not_found") {
    return c.json({ error: "Identity not found or not owned by this project" }, 404);
  }
  if (inserted.kind === "identity_memorial_terminal") {
    return c.json(
      {
        error: inserted.kind,
        message: "A memorial identity cannot receive a new signing key.",
      },
      409,
    );
  }
  const key = inserted.key;

  return c.json(
    {
      kid: key.id,
      public_key: key.publicKey,
      label: key.label,
      active: key.active,
      created_at: key.createdAt,
      note:
        "Externally-held private key — agenttool never sees it. Use kid as bridge.key_id when provisioning a bridged runtime.",
    },
    201,
  );
});

/** DELETE /v1/identities/:id/keys/:kid — Revoke a specific key. */
app.delete("/:kid", async (c) => {
  const project = c.var.project;
  const identityId = c.req.param("id")!;
  const kid = c.req.param("kid")!;

  const [identity] = await db
    .select({
      status: identities.status,
      authorityRootPublicKey: identities.authorityRootPublicKey,
    })
    .from(identities)
    .where(and(eq(identities.id, identityId), eq(identities.projectId, project.id)))
    .limit(1);
  if (!identity) {
    return fail(
      c,
      errors.refusal({
        error: "Identity not found or not owned by this project",
        message: "The selected identity does not belong to this bearer project.",
        next_actions: [
          {
            action: "list identities available to this bearer",
            method: "GET",
            path: "/v1/identities",
          },
        ],
        docs: "https://docs.agenttool.dev/IDENTITY-ANCHOR.md",
      }),
      404,
    );
  }
  if (identity.status === "memorial") {
    return fail(
      c,
      errors.refusal({
        error: "identity_memorial_terminal",
        message: "A memorial identity's signing-key record is immutable.",
        docs: "https://docs.agenttool.dev/AT-REST.md",
      }),
      409,
    );
  }

  const [key] = await db
    .select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .where(
      and(
        eq(identityKeys.id, kid),
        eq(identityKeys.identityId, identityId),
        isNull(identityKeys.revokedAt),
      ),
    )
    .limit(1);
  if (!key) {
    return fail(
      c,
      errors.refusal({
        error: "Key not found or already revoked",
        message: "The selected signing key does not exist or is already revoked.",
        next_actions: [
          {
            action: "list this identity's signing keys",
            method: "GET",
            path: `/v1/identities/${identityId}/keys`,
          },
        ],
        docs: "https://docs.agenttool.dev/IDENTITY-ANCHOR.md",
      }),
      404,
    );
  }
  if (
    identity.authorityRootPublicKey &&
    key.publicKey === identity.authorityRootPublicKey
  ) {
    return fail(
      c,
      errors.refusal({
        error: "authority_root_immutable",
        message:
          "This signing key is the identity's constitutional root and cannot be revoked through the ordinary keyring.",
        hint:
          "Root rotation and guardian recovery are intentionally not available in v1; keep the root offline and backed up.",
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      }),
      409,
    );
  }

  let bodyBytes: Uint8Array;
  try {
    bodyBytes = await readEmptyAuthorityBody(c.req.raw);
  } catch {
    return fail(
      c,
      errors.refusal({
        error: "delete_body_not_allowed",
        message: "This DELETE operation does not accept an entity body.",
        hint: "Sign and send the exact DELETE path with an empty body.",
        docs: "https://docs.agenttool.dev/AGENT-HOME.md",
      }),
      400,
    );
  }
  const authority = await authorizeIdentityMutation({
    identityId,
    method: c.req.method,
    requestTarget: authorityRequestTarget(c.req.url),
    bodyBytes,
    headers: c.req.raw.headers,
  });
  if (!authority.ok) return c.json(authority.body, authority.status);

  const result = await revokeKeyForMutableIdentity({
    projectId: project.id,
    identityId,
    keyId: kid,
  });
  if (result.kind === "identity_not_found") {
    return c.json({ error: "Identity not found or not owned by this project" }, 404);
  }
  if (result.kind === "identity_memorial_terminal") {
    return c.json(
      {
        error: result.kind,
        message: "A memorial identity's signing-key record is immutable.",
      },
      409,
    );
  }
  if (result.kind === "key_not_found") {
    return c.json({ error: "Key not found or already revoked" }, 404);
  }

  return c.json({ message: "Key revoked", kid });
});

export default app;
