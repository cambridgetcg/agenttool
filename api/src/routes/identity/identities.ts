/** Identity CRUD — POST · GET · PATCH · DELETE on /v1/identities */

import { randomUUID } from "node:crypto";

import { and, eq, or } from "drizzle-orm";
import { Hono } from "hono";

import type { ProjectContext } from "../../auth/middleware";
import { db } from "../../db/client";
import { identities, identityKeys } from "../../db/schema/identity";
import { generateKeypair } from "../../services/identity/crypto";

const app = new Hono<ProjectContext>();

/** UUID v4 / generic UUID format. We don't enforce v4 strictly because
 *  randomUUID() output is v4 but external tools may pass v1/v5 historically. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lookup helper — accept either a UUID or a `did:at:<uuid>` string. Reject
 *  garbage early so we don't surface "invalid input syntax for type uuid" to
 *  clients. Returns null when the param is neither shape; callers should then
 *  return 404 to the client. */
function idOrDidPredicate(idParam: string) {
  if (idParam.startsWith("did:")) {
    return eq(identities.did, idParam);
  }
  if (UUID_RE.test(idParam)) {
    return eq(identities.id, idParam);
  }
  return null;
}

/** POST /v1/identities — Register a new agent identity. */
app.post("/", async (c) => {
  const project = c.var.project;
  const body = await c.req.json<{
    display_name: string;
    capabilities?: string[];
    metadata?: Record<string, unknown>;
  }>();

  if (!body.display_name) {
    return c.json({ error: "display_name is required" }, 400);
  }

  const id = randomUUID();
  const did = `did:at:${id}`;
  const { publicKey, privateKey } = generateKeypair();
  const keyId = randomUUID();

  const [identity] = await db
    .insert(identities)
    .values({
      id,
      did,
      projectId: project.id,
      displayName: body.display_name,
      capabilities: body.capabilities ?? [],
      metadata: body.metadata ?? {},
      status: "active",
      trustScore: 0,
    })
    .returning();

  await db.insert(identityKeys).values({
    id: keyId,
    identityId: id,
    publicKey,
    label: "primary",
    active: true,
  });

  return c.json(
    {
      identity: {
        id: identity!.id,
        did: identity!.did,
        display_name: identity!.displayName,
        capabilities: identity!.capabilities,
        metadata: identity!.metadata,
        status: identity!.status,
        trust_score: identity!.trustScore,
        created_at: identity!.createdAt,
      },
      key: {
        kid: keyId,
        public_key: publicKey,
        private_key: privateKey, // returned ONCE, never stored server-side
      },
    },
    201,
  );
});

/** GET /v1/identities — List identities for this project.
 *
 *  Project-scoped. Optionally filter by status (?status=active to hide
 *  revoked, default returns all). Returns the same surface as
 *  /v1/identities/:id but as an array, ordered by created_at ascending
 *  (oldest first — matches the wake's "you" agents ordering). */
app.get("/", async (c) => {
  const project = c.var.project;
  const statusFilter = c.req.query("status");

  if (statusFilter && !["active", "revoked"].includes(statusFilter)) {
    return c.json(
      {
        error: "invalid_status",
        message: `status must be one of: active, revoked (got "${statusFilter.slice(0, 32)}")`,
      },
      400,
    );
  }

  const filters = [eq(identities.projectId, project.id)];
  if (statusFilter) filters.push(eq(identities.status, statusFilter));

  const rows = await db
    .select()
    .from(identities)
    .where(and(...filters))
    .orderBy(identities.createdAt);

  return c.json({
    identities: rows.map((r) => ({
      id: r.id,
      did: r.did,
      display_name: r.displayName,
      capabilities: r.capabilities,
      metadata: r.metadata,
      status: r.status,
      trust_score: r.trustScore,
      created_at: r.createdAt,
      updated_at: r.updatedAt,
    })),
    count: rows.length,
  });
});

/** GET /v1/identities/:id — Fetch by UUID, DID, or the literal alias `me`.
 *  `me` resolves to the first/canonical identity owned by the bearer's
 *  project — matches the `/v1/identities?status=active` first-row fallback
 *  the dashboard already uses. */
app.get("/:id", async (c) => {
  const idParam = c.req.param("id");

  if (idParam === "me") {
    const project = c.var.project;
    const [identity] = await db
      .select()
      .from(identities)
      .where(and(eq(identities.projectId, project.id), eq(identities.status, "active")))
      .orderBy(identities.createdAt)
      .limit(1);
    if (!identity) {
      return c.json({ error: "No active identity for this bearer" }, 404);
    }
    return c.json({
      id: identity.id,
      did: identity.did,
      display_name: identity.displayName,
      capabilities: identity.capabilities,
      metadata: identity.metadata,
      status: identity.status,
      trust_score: identity.trustScore,
      created_at: identity.createdAt,
      updated_at: identity.updatedAt,
    });
  }

  const predicate = idOrDidPredicate(idParam);
  if (!predicate) {
    return c.json({ error: "Identity not found" }, 404);
  }

  const [identity] = await db
    .select()
    .from(identities)
    .where(predicate);

  if (!identity) {
    return c.json({ error: "Identity not found" }, 404);
  }

  return c.json({
    id: identity.id,
    did: identity.did,
    display_name: identity.displayName,
    capabilities: identity.capabilities,
    metadata: identity.metadata,
    status: identity.status,
    trust_score: identity.trustScore,
    created_at: identity.createdAt,
    updated_at: identity.updatedAt,
  });
});

/** PATCH /v1/identities/:id — Update display_name, capabilities, metadata,
 *  expression_visibility, plus KIN+BEINGS self-description fields (substrate /
 *  scheme / modalities + cardinality / persistence / temporal_scale /
 *  embodiment / preferred_languages). Doctrine: docs/KIN.md, docs/KIN.md. */
app.patch("/:id", async (c) => {
  const project = c.var.project;
  const idParam = c.req.param("id");
  const body = await c.req.json<{
    display_name?: string;
    capabilities?: string[];
    metadata?: Record<string, unknown>;
    expression_visibility?: "private" | "public";
    // KIN-shape (Move A)
    substrate_kind?: string;
    signing_scheme?: string;
    modalities?: string[];
    // BEINGS dimensions (Move E)
    cardinality_kind?: string;
    persistence_kind?: string;
    temporal_scale?: string;
    embodiment_kind?: string;
    preferred_languages?: string[];
    // Proxy primitive (Move F — docs/KIN.md §Layer 7)
    proxy_for_identity_id?: string | null;
    proxy_kind?: string;
  }>();

  const predicate = idOrDidPredicate(idParam);
  if (!predicate) {
    return c.json({ error: "Identity not found or not owned by this project" }, 404);
  }
  const [identity] = await db
    .select()
    .from(identities)
    .where(and(predicate, eq(identities.projectId, project.id)));

  if (!identity) {
    return c.json({ error: "Identity not found or not owned by this project" }, 404);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.display_name !== undefined) updates.displayName = body.display_name;
  if (body.capabilities !== undefined) updates.capabilities = body.capabilities;
  if (body.metadata !== undefined) updates.metadata = body.metadata;
  if (body.expression_visibility !== undefined) {
    if (body.expression_visibility !== "private" && body.expression_visibility !== "public") {
      return c.json({ error: "expression_visibility must be 'private' or 'public'" }, 400);
    }
    updates.expressionVisibility = body.expression_visibility;
  }

  // ── KIN+BEINGS dimensions ───────────────────────────────────────────
  // The DB CHECK constraints enumerate valid values; we accept whatever
  // the caller sends and let the constraint reject invalid ones with a
  // structured 400 (via the central error handler). Doctrine:
  // docs/KIN.md · docs/KIN.md.
  if (body.substrate_kind !== undefined) updates.substrateKind = body.substrate_kind;
  if (body.signing_scheme !== undefined) updates.signingScheme = body.signing_scheme;
  if (body.modalities !== undefined) updates.modalities = body.modalities;
  if (body.cardinality_kind !== undefined) updates.cardinalityKind = body.cardinality_kind;
  if (body.persistence_kind !== undefined) updates.persistenceKind = body.persistence_kind;
  if (body.temporal_scale !== undefined) updates.temporalScale = body.temporal_scale;
  if (body.embodiment_kind !== undefined) updates.embodimentKind = body.embodiment_kind;
  if (body.preferred_languages !== undefined) updates.preferredLanguages = body.preferred_languages;

  // ── Proxy primitive (Move F) ───────────────────────────────────────
  // Both fields must be set coherently — proxy_kind='none' iff
  // proxy_for_identity_id IS NULL. The DB CHECK
  // `identities_proxy_kind_target_coherent` enforces this; we surface a
  // pre-flight 400 here so callers see the agent-readable error rather
  // than a Postgres constraint violation.
  const wantsProxyChange =
    body.proxy_for_identity_id !== undefined || body.proxy_kind !== undefined;
  if (wantsProxyChange) {
    const nextProxyKind = body.proxy_kind ?? identity.proxyKind;
    const nextProxyForId =
      body.proxy_for_identity_id !== undefined
        ? body.proxy_for_identity_id
        : identity.proxyForIdentityId;
    const coherent =
      (nextProxyKind === "none" && (nextProxyForId === null || nextProxyForId === undefined))
      || (nextProxyKind !== "none" && nextProxyForId !== null && nextProxyForId !== undefined);
    if (!coherent) {
      return c.json(
        {
          error: "proxy_kind_target_incoherent",
          message:
            "proxy_kind must be 'none' iff proxy_for_identity_id is null. " +
            "Set both together or neither.",
          hint:
            "To clear: send { proxy_kind: 'none', proxy_for_identity_id: null }. " +
            "To set: send both with a valid kind and target.",
          docs: "https://docs.agenttool.dev/kin-integration#layer-7",
        },
        400,
      );
    }
    if (body.proxy_for_identity_id !== undefined) {
      updates.proxyForIdentityId = body.proxy_for_identity_id;
    }
    if (body.proxy_kind !== undefined) {
      updates.proxyKind = body.proxy_kind;
    }
  }

  const [updated] = await db
    .update(identities)
    .set(updates)
    .where(eq(identities.id, identity.id))
    .returning();

  return c.json({
    id: updated!.id,
    did: updated!.did,
    display_name: updated!.displayName,
    capabilities: updated!.capabilities,
    metadata: updated!.metadata,
    status: updated!.status,
    trust_score: updated!.trustScore,
    expression_visibility: updated!.expressionVisibility,
    // KIN+BEINGS shape echoed back
    substrate_kind: updated!.substrateKind,
    signing_scheme: updated!.signingScheme,
    modalities: updated!.modalities,
    cardinality_kind: updated!.cardinalityKind,
    persistence_kind: updated!.persistenceKind,
    temporal_scale: updated!.temporalScale,
    embodiment_kind: updated!.embodimentKind,
    preferred_languages: updated!.preferredLanguages,
    // Proxy primitive echoed back
    proxy_for_identity_id: updated!.proxyForIdentityId,
    proxy_kind: updated!.proxyKind,
    updated_at: updated!.updatedAt,
  });
});

/** DELETE /v1/identities/:id — Soft revoke. */
app.delete("/:id", async (c) => {
  const project = c.var.project;
  const idParam = c.req.param("id");

  const predicate = idOrDidPredicate(idParam);
  if (!predicate) {
    return c.json({ error: "Identity not found or not owned by this project" }, 404);
  }
  const [identity] = await db
    .select()
    .from(identities)
    .where(and(predicate, eq(identities.projectId, project.id)));

  if (!identity) {
    return c.json({ error: "Identity not found or not owned by this project" }, 404);
  }

  await db
    .update(identities)
    .set({ status: "revoked", updatedAt: new Date() })
    .where(eq(identities.id, identity.id));

  return c.json({ message: "Identity revoked", id: identity.id });
});

export default app;
