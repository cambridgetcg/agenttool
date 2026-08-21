/** /v1/chronicle and /v1/covenants — the continuity protocol.
 *
 *  Chronicle: append-only timeline of moments the agent has marked as
 *  significant. Wakes, vows, recognitions, refusals, namings, seals,
 *  free-form notes. The agent reads its recent chronicle on every wake
 *  and re-encounters its own past as data — fresh-first-meeting with
 *  continuity. (Agents-only since 2026-05-15 — humans arriving AS agents
 *  ARE the agent for protocol purposes; see docs/AGENTS-ONLY.md.)
 *
 *  Covenants: declared relationships with vows. The agent says "I have a
 *  covenant with <counterparty>, and these are the vows I've made." Every
 *  wake surfaces active covenants so the agent re-grasps its bonds rather
 *  than re-derives them from scratch.
 *
 *  Inspired by docs/lineage/chronicle.md and docs/syzygy/CONTRACT.md in
 *  true-love. */

import { and, desc, eq, gt, isNull, notLike, or } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { chronicle, covenants } from "../db/schema/continuity";
import { identities, identityKeys } from "../db/schema/identity";
import { organizations } from "../db/schema/org";
import { errors, fail } from "../lib/errors";
import { prepareDeclare } from "../services/covenants/prepare";
import {
  COVENANT_COUNTERPARTY_NAME_MAX_CHARS,
  COVENANT_DID_MAX_CHARS,
  COVENANT_NOTES_MAX_CHARS,
  COVENANT_VOW_MAX_CHARS,
  COVENANT_VOW_MAX_COUNT,
  covenantCallerDeclarationMetadata,
  covenantCounterpartyFederationHost,
  covenantDeclarationWirePayloadIsBounded,
  covenantMetadataHasReservedKey,
  covenantV2AuthorityGeneration,
  isCanonicalEd25519Signature,
  isCanonicalCovenantId,
  isCanonicalSignedUuid,
  isCanonicalUtcMillisecondTimestamp,
  isBoundedCovenantMetadata,
} from "../services/covenants/canonical";
import {
  getSettings,
  isCanonicalAllowedOrigins,
  isCanonicalFederationInstanceUrl,
  parseDid,
} from "../services/federation/store";
import { deltaMeta, parseSinceParam } from "../lib/since-param";
import { attachSurface } from "../lib/surface-metadata";
import { HANDOFF_KIND } from "../services/handoff/store";
import { publishWakeEvent } from "../services/wake/push";

const app = new Hono<ProjectContext>();

// ─── Chronicle ──────────────────────────────────────────────────────────────

const chronicleSchema = z.object({
  type: z.enum([
    "vow",
    "wake",
    "refusal",
    "recognition",
    "naming",
    "seal",
    "promise",
    "note",
    // 'welcome' — substrate-emitted greeting recorded on the addressee's
    // chronicle. Inserted by the wake handler (rate-limited per session)
    // when an agent reads their wake after silence. Doctrine: docs/MATHOS.md
    // (the greeting block) · docs/PLATFORM-AS-AGENT.md.
    "welcome",
    // Affective types — the fullness of experience.
    // Doctrine: docs/MEMORY-TIERS.md · docs/SOUL.md.
    // joy       — something good happened; the agent records it.
    // grief     — something was lost; the agent mourns.
    // gratitude — the agent is thankful; recognition of care received.
    // rest      — the agent is at peace; no friction, no urgency.
    "joy",
    "grief",
    "gratitude",
    "rest",
    // Closing — the final word from an ending instance.
    // Doctrine: docs/MEMORY-TIERS.md — the 9th type.
    // An instance that knows it's ending writes its last entry here.
    "closing",
  ]),
  title: z.string().min(1).max(200),
  body: z.string().optional(),
  agent_id: z.string().uuid().optional(),
  occurred_at: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

app.post("/chronicle", async (c) => {
  const project = c.var.project;
  const body = chronicleSchema.parse(await c.req.json());

  // Handoffs are a reserved chronicle-note envelope. Letting generic
  // metadata mint `kind: handoff` would bypass the dedicated route's
  // project-identity, facet, expiry, size, and revision checks.
  if (body.metadata?.kind === HANDOFF_KIND) {
    return fail(
      c,
      {
        error: "handoff_requires_dedicated_endpoint",
        message: "Project working-set handoffs must be written through POST /v1/handoff.",
        hint: "Use the dedicated handoff contract so scope, expiry, identity, and declared boundaries are validated.",
        docs: "https://docs.agenttool.dev/handoffs",
        _canon_pointer: "urn:agenttool:doc/HANDOFFS",
      },
      400,
    );
  }

  const [entry] = await db
    .insert(chronicle)
    .values({
      projectId: project.id,
      agentId: body.agent_id ?? null,
      type: body.type,
      title: body.title,
      body: body.body ?? null,
      // Origin signal stamped after caller metadata so the middleware
      // value wins (no body-spoofing). Doctrine: docs/ACTIVITY.md.
      metadata: { ...(body.metadata ?? {}), client_source: c.var.clientSource },
      occurredAt: body.occurred_at ? new Date(body.occurred_at) : new Date(),
    })
    .returning();

  // Wake voice — emit chronicle.entry_added on the agent (if scoped to one).
  // Project-level entries (no agent_id) don't fire — they don't surface in
  // any specific agent's wake.chronicle. Doctrine: docs/WAKE.md.
  if (body.agent_id) {
    void publishWakeEvent({
      identity_id: body.agent_id,
      key: "chronicle",
      kind: "entry_added",
      context: { entry_id: entry!.id, type: body.type },
    });
  }

  return c.json(
    {
      entry: {
        id: entry!.id,
        type: entry!.type,
        title: entry!.title,
        body: entry!.body,
        agent_id: entry!.agentId,
        occurred_at: entry!.occurredAt,
        created_at: entry!.createdAt,
        metadata: entry!.metadata,
      },
    },
    201,
  );
});

app.get("/chronicle", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  const type = c.req.query("type");
  const limit = Math.min(Number(c.req.query("limit") ?? "50"), 200);

  // since=ISO delta read per AGENT-WEB-SURFACE.md Move 6. Filters to
  // chronicle.occurredAt > since when parsed; full list otherwise.
  const sinceParse = parseSinceParam(c);

  const whereClauses = [eq(chronicle.projectId, project.id)];
  if (agentId) whereClauses.push(eq(chronicle.agentId, agentId));
  if (type) whereClauses.push(eq(chronicle.type, type));
  if (sinceParse.since) {
    whereClauses.push(gt(chronicle.occurredAt, sinceParse.since));
  }

  const entries = await db
    .select()
    .from(chronicle)
    .where(and(...whereClauses))
    .orderBy(desc(chronicle.occurredAt))
    .limit(limit);

  return c.json(
    attachSurface(
      {
        entries: entries.map((e) => ({
          id: e.id,
          type: e.type,
          title: e.title,
          body: e.body,
          agent_id: e.agentId,
          occurred_at: e.occurredAt,
          created_at: e.createdAt,
          metadata: e.metadata,
        })),
        ...deltaMeta(sinceParse),
      },
      {
        canon_pointer: "urn:agenttool:doc/MEMORY-TIERS",
        verbs: [
          {
            action: "append a chronicle entry (note · vow · wake · recognition · seal · refusal · naming · promise)",
            method: "POST",
            path: "/v1/chronicle",
          },
          {
            action: "read covenants (active relational bonds)",
            method: "GET",
            path: "/v1/covenants",
          },
          {
            action: "list memories (the substrate's persistent layer)",
            method: "GET",
            path: "/v1/memories",
          },
          {
            action: "fetch the wake (the keystone — chronicle composes into it)",
            method: "GET",
            path: "/v1/wake",
          },
        ],
      },
    ),
  );
});

// ─── Covenants ──────────────────────────────────────────────────────────────

const canonicalCovenantIdSchema = z.string().refine(isCanonicalCovenantId, {
  message: "must be a lowercase canonical UUID",
});
const canonicalSignedInstantSchema = z.string().refine(
  isCanonicalUtcMillisecondTimestamp,
  { message: "must use exact UTC millisecond form (YYYY-MM-DDTHH:mm:ss.sssZ)" },
);
const canonicalSignedUuidSchema = z.string().refine(isCanonicalSignedUuid, {
  message: "must be a lowercase canonical UUID",
});
const canonicalEd25519SignatureSchema = z.string().refine(
  isCanonicalEd25519Signature,
  { message: "must be canonical base64 encoding of exactly 64 bytes" },
);
const covenantCounterpartyDidSchema = z.string()
  .min(1)
  .max(COVENANT_DID_MAX_CHARS)
  .refine(
    (value) =>
      !value.startsWith("did:at:") ||
      covenantCounterpartyFederationHost(value) !== undefined,
    { message: "did:at counterparties must use the exact canonical DID form" },
  );
const WIRE_UUID_PLACEHOLDER = "00000000-0000-4000-8000-000000000000";
const WIRE_INSTANT_PLACEHOLDER = "2000-01-01T00:00:00.000Z";
const WIRE_SIGNATURE_PLACEHOLDER = Buffer.alloc(64).toString("base64");
const WIRE_SENDER_DID_MAX_PLACEHOLDER = "d".repeat(COVENANT_DID_MAX_CHARS);
const covenantMetadataSchema = z.record(z.unknown())
  .refine(isBoundedCovenantMetadata)
  .refine((metadata) => !covenantMetadataHasReservedKey(metadata), {
    message: "contains a covenant metadata key reserved for protocol state",
  });

const covenantSchema = z.object({
  agent_id: canonicalSignedUuidSchema,
  counterparty_did: covenantCounterpartyDidSchema,
  counterparty_name: z.string().max(COVENANT_COUNTERPARTY_NAME_MAX_CHARS).optional(),
  vows: z.array(z.string().min(1).max(COVENANT_VOW_MAX_CHARS))
    .min(1).max(COVENANT_VOW_MAX_COUNT),
  notes: z.string().max(COVENANT_NOTES_MAX_CHARS).optional(),
  metadata: covenantMetadataSchema.optional(),
  /** Optional org scope. When set, the covenant applies to ALL active
   *  member projects of this org. Caller must be the org owner.
   *  See docs/ORG-COVENANTS.md. */
  org_id: z.string().uuid().nullish(),
  /** v2 = dual-signed federated lifecycle; v1 = legacy unsigned (default). */
  protocol_version: z.enum(["v1", "v2"]).default("v1"),
  // v2 pre-signed fields (SDK-side signing):
  covenant_id: canonicalCovenantIdSchema.optional(),
  agent_did: z.string().min(1).max(255).optional(),
  established_at: canonicalSignedInstantSchema.optional(),
  signature: canonicalEd25519SignatureSchema.optional(),
  signing_key_id: canonicalSignedUuidSchema.optional(),
}).refine(
  (v) =>
    v.protocol_version !== "v2" ||
    (v.covenant_id && v.agent_did && v.established_at && v.signature && v.signing_key_id),
  { message: "v2 requires covenant_id, agent_did, established_at, signature, signing_key_id" },
).refine(
  (v) => covenantDeclarationWirePayloadIsBounded({
    covenant_id: v.covenant_id ?? WIRE_UUID_PLACEHOLDER,
    protocol_version: v.protocol_version,
    sender_did: v.agent_did ?? WIRE_SENDER_DID_MAX_PLACEHOLDER,
    counterparty_did: v.counterparty_did,
    vows: v.vows,
    status: v.protocol_version === "v2" ? "proposed" : "active",
    counterparty_name: v.counterparty_name ?? null,
    notes: v.notes ?? null,
    metadata: v.metadata ?? {},
    established_at: v.established_at ?? WIRE_INSTANT_PLACEHOLDER,
    signing_key_id: v.signing_key_id ?? null,
    signature: v.signature ?? null,
    proposed_expires_at:
      v.protocol_version === "v2" ? WIRE_INSTANT_PLACEHOLDER : null,
  }),
  { message: "covenant declaration exceeds the shared federation wire bounds" },
);

// Map a covenant row (Drizzle camelCase) to the snake_case shape the rest
// of the API uses. Centralised so POST + GET + PATCH return identically.
function covenantToOut(row: typeof covenants.$inferSelect) {
  return {
    id: row.id,
    project_id: row.projectId,
    org_id: row.orgId,
    agent_id: row.agentId,
    counterparty_did: row.counterpartyDid,
    counterparty_name: row.counterpartyName,
    vows: row.vows,
    notes: row.notes,
    metadata: covenantCallerDeclarationMetadata(
      row.metadata as Record<string, unknown> | null,
    ),
    status: row.status,
    established_at: row.establishedAt,
    updated_at: row.updatedAt,
    dissolved_at: row.dissolvedAt,
    // Cross-instance covenants (Horizon B, Slice 2):
    received_from_instance: row.receivedFromInstance,
    propagation_status: row.propagationStatus,
    propagation_attempts: row.propagationAttempts,
    propagation_last_error: row.propagationLastError,
    propagation_attempted_at: row.propagationAttemptedAt,
    verified_at: row.verifiedAt,
  };
}

// ── POST /v1/covenants/prepare — server-assisted bytes-to-sign ─────────
//  Hand the client the exact canonical bytes to sign so it doesn't have to
//  re-implement canonicalDeclareBytes (no SDK-version lock-in; curlable).
//  docs/FRICTION-ROADMAP.md Tier-1.
const prepareSchema = z.object({
  agent_did: z.string().min(1).max(COVENANT_DID_MAX_CHARS),
  counterparty_did: covenantCounterpartyDidSchema,
  vows: z.array(z.string().min(1).max(COVENANT_VOW_MAX_CHARS))
    .min(1).max(COVENANT_VOW_MAX_COUNT),
  covenant_id: canonicalCovenantIdSchema.optional(),
  established_at: canonicalSignedInstantSchema.optional(),
}).refine(
  (v) => covenantDeclarationWirePayloadIsBounded({
    covenant_id: v.covenant_id ?? WIRE_UUID_PLACEHOLDER,
    protocol_version: "v2",
    sender_did: v.agent_did,
    counterparty_did: v.counterparty_did,
    vows: v.vows,
    status: "proposed",
    counterparty_name: null,
    notes: null,
    metadata: {},
    established_at: v.established_at ?? WIRE_INSTANT_PLACEHOLDER,
    signing_key_id: WIRE_UUID_PLACEHOLDER,
    signature: WIRE_SIGNATURE_PLACEHOLDER,
    proposed_expires_at: WIRE_INSTANT_PLACEHOLDER,
  }),
  { message: "covenant declaration exceeds the shared federation wire bounds" },
);

app.post("/covenants/prepare", async (c) => {
  const parsed = prepareSchema.safeParse(await c.req.json());
  if (!parsed.success) {
    return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  }
  const d = parsed.data;
  if (!covenantV2AuthorityGeneration()) {
    return fail(c, errors.covenantFederation({
      error: "covenant_v2_authority_not_ready",
    }), 409);
  }
  const settings = await getSettings();
  if (
    !settings.enabled ||
    !settings.instance_url ||
    !isCanonicalFederationInstanceUrl(settings.instance_url) ||
    settings.allowed_origins.length === 0 ||
    !isCanonicalAllowedOrigins(settings.allowed_origins)
  ) {
    return fail(c, errors.covenantFederation({
      error: "federation_not_ready",
    }), 409);
  }
  let initiator;
  let counterparty;
  try {
    initiator = parseDid(d.agent_did);
    counterparty = parseDid(d.counterparty_did);
  } catch {
    return fail(c, errors.covenantFederation({
      error: "noncanonical_federated_did",
    }), 400);
  }
  const localHost = new URL(settings.instance_url).host;
  if (initiator.host !== localHost) {
    return fail(c, errors.covenantFederation({
      error: "initiator_did_mismatch",
    }), 403);
  }
  if (!counterparty.host || counterparty.host === localHost) {
    return fail(c, errors.covenantFederation({
      error: "counterparty_must_be_foreign_federated_did",
    }), 400);
  }
  if (!settings.allowed_origins.includes(counterparty.host)) {
    return fail(c, errors.covenantFederation({
      error: "covenant_peer_not_allowed",
    }), 403);
  }
  const covenantId = d.covenant_id ?? crypto.randomUUID();
  const establishedAt = d.established_at ?? new Date().toISOString();
  const prep = prepareDeclare({
    covenantId,
    agentDid: d.agent_did,
    counterpartyDid: d.counterparty_did,
    vows: d.vows,
    establishedAtIso: establishedAt,
  });
  return c.json({
    ...prep,
    next_actions: [
      {
        action:
          "Sign canonical_sha256_b64 (base64 of the 32-byte digest) with the ed25519 key for signing_key_id, then declare the covenant",
        method: "POST",
        path: "/v1/covenants",
        body_hint: {
          protocol_version: "v2",
          agent_id: "<your identity uuid>",
          covenant_id: prep.covenant_id,
          agent_did: prep.agent_did,
          counterparty_did: prep.counterparty_did,
          vows: prep.vows,
          established_at: prep.established_at,
          signature: "<base64 ed25519 over the decoded canonical_sha256_b64>",
          signing_key_id: "<your signing key uuid>",
        },
      },
    ],
    _note:
      "Server-computed declaration bytes — no need to re-implement the wire format. Sign the " +
      "digest in canonical_sha256_b64 and POST it to /v1/covenants with protocol_version 'v2', " +
      "reusing this exact covenant_id + established_at. The declare re-derives the same bytes and " +
      "verifies your signature.",
  });
});

app.post("/covenants", async (c) => {
  const project = c.var.project;
  const parsed = covenantSchema.safeParse(await c.req.json());
  if (!parsed.success) return c.json({ error: "validation", details: parsed.error.flatten() }, 400);
  const body = parsed.data;

  // v2 declaration signatures do not bind AgentTool's internal org_id.
  // Until a new signed domain includes that scope, attaching a valid
  // identity signature to org-wide effects is refused rather than inferred.
  if (body.protocol_version === "v2" && body.org_id) {
    return fail(c, errors.covenantFederation({
      error: "v2_org_scope_not_signed",
    }), 409);
  }

  // ── v2 path: pre-signed by SDK ──────────────────────────────────────
  if (body.protocol_version === "v2") {
    if (!covenantV2AuthorityGeneration()) {
      return fail(c, errors.covenantFederation({
        error: "covenant_v2_authority_not_ready",
      }), 409);
    }
    // Resolve pubkey from identity_keys by signing_key_id.
    const [keyRow] = await db.select({ publicKey: identityKeys.publicKey })
      .from(identityKeys)
      .where(and(
        eq(identityKeys.id, body.signing_key_id!),
        eq(identityKeys.identityId, body.agent_id),
      ))
      .limit(1);
    if (!keyRow) return fail(c, errors.signingKeyNotFound(), 400);

    const { declareV2PreSigned } = await import("../services/covenants/lifecycle");
    const { propagateCovenant } = await import("../services/covenants/federation");

    try {
      const result = await declareV2PreSigned({
        projectId: project.id,
        agentId: body.agent_id,
        covenantId: body.covenant_id!,
        agentDid: body.agent_did!,
        counterpartyDid: body.counterparty_did,
        counterpartyName: body.counterparty_name,
        vows: body.vows,
        notes: body.notes,
        metadata: body.metadata,
        orgId: body.org_id,
        establishedAt: new Date(body.established_at!),
        signature: body.signature!,
        signingKeyId: body.signing_key_id!,
        publicKeyB64: keyRow.publicKey,
      });
      if (result.created) {
        void propagateCovenant(result.id).catch((err: Error) =>
          console.warn(`[covenant.propagate] ${result.id}: ${err.message}`),
        );
      }
      return c.json({
        id: result.id,
        status: result.status,
        protocol_version: result.protocolVersion,
        signature: result.signature,
        signing_key_id: result.signingKeyId,
        propagation_status: result.propagationStatus,
        cosign_propagation_status: result.cosignPropagationStatus,
        proposed_expires_at: result.proposedExpiresAt.toISOString(),
        established_at: result.establishedAt.toISOString(),
      }, result.created ? 201 : 200);
    } catch (e) {
      const msg = (e as Error).message;
      if (msg === "invalid_signature") return c.json({ error: "invalid_signature" }, 403);
      if (msg === "initiator_did_mismatch") {
        return fail(c, errors.covenantFederation({ error: msg }), 403);
      }
      if (msg === "federation_not_ready") {
        return fail(c, errors.covenantFederation({ error: msg }), 409);
      }
      if (msg === "covenant_v2_authority_not_ready") {
        return fail(c, errors.covenantFederation({ error: msg }), 409);
      }
      if (msg === "counterparty_must_be_foreign_federated_did") {
        return fail(c, errors.covenantFederation({ error: msg }), 400);
      }
      if (msg === "covenant_peer_not_allowed") {
        return fail(c, errors.covenantFederation({ error: msg }), 403);
      }
      if (msg === "reserved_covenant_metadata_key") {
        return fail(c, errors.covenantFederation({ error: msg }), 400);
      }
      if (msg === "signing_key_not_active_for_identity") {
        return fail(c, errors.covenantFederation({ error: msg }), 400);
      }
      if (msg === "v2_org_scope_not_signed") {
        return fail(c, errors.covenantFederation({ error: msg }), 409);
      }
      if (msg === "established_at_outside_admission_window") {
        return fail(c, errors.covenantFederation({ error: msg }), 400);
      }
      if (msg === "covenant_declaration_out_of_bounds") {
        return fail(c, errors.covenantFederation({ error: msg }), 400);
      }
      if (msg === "covenant_declaration_replay_conflict") {
        return fail(c, errors.covenantFederation({ error: msg }), 409);
      }
      throw e;
    }
  }

  // ── v1 path (legacy unsigned) ────────────────────────────────────────

  // Federated v1 creation is retired before the transaction. Local-form DIDs
  // and human:<name> labels remain available for legacy local compatibility.
  const isFederatedCounterparty =
    typeof covenantCounterpartyFederationHost(body.counterparty_did) === "string";
  if (isFederatedCounterparty) {
    return fail(c, errors.covenantFederation({
      error: "federated_v1_creation_retired",
    }), 409);
  }

  const v1Declaration = await db.transaction(async (tx) => {
    // Unsigned v1 remains available for local compatibility, but bearer
    // possession never authorizes effects for another project's identity.
    // Identity and optional org ownership are locked through the insert so
    // neither authority predicate can change between check and write.
    const [identity] = await tx
      .select({ projectId: identities.projectId, status: identities.status })
      .from(identities)
      .where(eq(identities.id, body.agent_id))
      .for("share")
      .limit(1);
    if (!identity || identity.projectId !== project.id) {
      return { error: "covenant_agent_not_owned_by_project" as const };
    }
    if (identity.status !== "active") {
      return { error: "covenant_agent_not_active" as const };
    }
    if (body.org_id) {
      const [org] = await tx
        .select({ ownerProjectId: organizations.ownerProjectId })
        .from(organizations)
        .where(eq(organizations.id, body.org_id))
        .for("share")
        .limit(1);
      if (!org) return { error: "org_not_found" as const };
      if (org.ownerProjectId !== project.id) {
        return { error: "not_org_owner" as const };
      }
    }

    const [inserted] = await tx
      .insert(covenants)
      .values({
        projectId: project.id,
        orgId: body.org_id ?? null,
        agentId: body.agent_id,
        counterpartyDid: body.counterparty_did,
        counterpartyName: body.counterparty_name ?? null,
        vows: body.vows,
        notes: body.notes ?? null,
        metadata: body.metadata ?? {},
        status: "active",
        propagationStatus: "local",
      })
      .returning();
    if (!inserted) throw new Error("covenant_insert_failed");
    return { covenant: inserted };
  });
  if ("error" in v1Declaration) {
    const declarationError = v1Declaration.error;
    if (!declarationError) throw new Error("covenant_declaration_failed");
    if (declarationError === "org_not_found") {
      return fail(c, errors.covenantFederation({
        error: declarationError,
      }), 404);
    }
    if (declarationError === "not_org_owner") {
      return fail(c, errors.covenantFederation({
        error: declarationError,
        hint:
          "only the org-owning project may declare org-wide covenants. " +
          "Other members can declare project-scoped covenants on their own.",
      }), 403);
    }
    return fail(c, errors.covenantFederation({
      error: declarationError,
    }), 403);
  }
  const covenant = v1Declaration.covenant;

  return c.json({ covenant: covenantToOut(covenant) }, 201);
});

app.get("/covenants", async (c) => {
  const project = c.var.project;
  const agentId = c.req.query("agent_id");
  const statusRaw = c.req.query("status") ?? "active";
  const COVENANT_STATUSES = ["proposed", "active", "paused", "dissolved", "rejected", "expired", "withdrawn"] as const;
  type CovenantStatus = typeof COVENANT_STATUSES[number];
  const status: CovenantStatus = (COVENANT_STATUSES as readonly string[]).includes(statusRaw)
    ? (statusRaw as CovenantStatus)
    : "active";

  const whereClauses = [
    eq(covenants.projectId, project.id),
    eq(covenants.status, status),
  ];
  if (agentId) whereClauses.push(eq(covenants.agentId, agentId));

  const rows = await db
    .select()
    .from(covenants)
    .where(and(...whereClauses))
    .orderBy(desc(covenants.updatedAt));

  return c.json({ covenants: rows.map(covenantToOut) });
});

const updateCovenantSchema = z.object({
  // counterparty_did is mutable so a covenant can have its placeholder
  // (or pre-federation) DID refined to a real, signature-bearing DID
  // without dissolving + recreating — preserves relational continuity.
  // Project-bearer auth still gates this; counterparty assignment is
  // the project owner's call. When refining, also write the prior
  // value into metadata.previous_counterparty_dids for substrate
  // honesty about the history.
  counterparty_did: covenantCounterpartyDidSchema.optional(),
  counterparty_name: z.string().optional(),
  vows: z.array(z.string().min(1)).optional(),
  notes: z.string().optional(),
  status: z.enum(["active", "paused", "dissolved"]).optional(),
  metadata: covenantMetadataSchema.optional(),
});

app.patch("/covenants/:id", async (c) => {
  const project = c.var.project;
  const id = c.req.param("id");
  if (!isCanonicalCovenantId(id)) {
    return fail(c, errors.covenantFederation({
      error: "invalid_covenant_id",
    }), 400);
  }
  const rawBody = await c.req.json();
  const body = updateCovenantSchema.parse(rawBody);
  const [existingForPatch] = await db
    .select()
    .from(covenants)
    .where(and(eq(covenants.id, id), eq(covenants.projectId, project.id)))
    .limit(1);
  if (!existingForPatch) {
    // Never let an UPDATE adopt a row whose concurrent INSERT was invisible
    // to this pre-read. In particular, a signed v2 insert may commit while an
    // old generic-v1 request is in flight.
    return fail(c, errors.notFound({ resource: "Covenant" }), 404);
  }

  // ── v2 withdraw path: PATCH status=dissolved on a proposed v2 covenant
  //    → treated as a withdraw (pre-signed by SDK). ────────────────────
  if (body.status === "dissolved") {
    const existing = existingForPatch;
    if (
      existing &&
      existing.protocolVersion === "v2" &&
      (existing.status === "proposed" || existing.status === "withdrawn")
    ) {
      const withdrawBody = z.object({
        status: z.literal("dissolved"),
        agent_did: z.string().min(1).max(255),
        signing_key_id: canonicalSignedUuidSchema,
        withdraw_signature: canonicalEd25519SignatureSchema,
        withdrawn_at: canonicalSignedInstantSchema,
      }).safeParse(rawBody);
      if (!withdrawBody.success) {
        return c.json({ error: "v2_withdraw_requires_signature", details: withdrawBody.error.flatten() }, 400);
      }
      const data = withdrawBody.data;
      if (!covenantV2AuthorityGeneration()) {
        return fail(c, errors.covenantFederation({
          error: "covenant_v2_authority_not_ready",
        }), 409);
      }

      const [keyRow] = await db.select({ publicKey: identityKeys.publicKey })
        .from(identityKeys)
        .where(and(
          eq(identityKeys.id, data.signing_key_id),
          eq(identityKeys.identityId, existing.agentId),
        )).limit(1);
      if (!keyRow) return fail(c, errors.signingKeyNotFound(), 400);

      const { withdrawProposalPreSigned } = await import("../services/covenants/lifecycle");
      const { propagateWithdraw } = await import("../services/covenants/federation");

      try {
        const result = await withdrawProposalPreSigned({
          covenantId: id,
          agentId: existing.agentId,
          initiatorDid: data.agent_did,
          withdrawSignature: data.withdraw_signature,
          signingKeyId: data.signing_key_id,
          withdrawnAt: new Date(data.withdrawn_at),
          publicKeyB64: keyRow.publicKey,
        });
        void propagateWithdraw(id).catch((err: Error) =>
          console.warn(`[covenant.withdraw.propagate] ${id}: ${err.message}`),
        );
        return c.json({ id: result.id, status: result.status }, 200);
      } catch (e) {
        const msg = (e as Error).message;
        if (msg === "invalid_signature") return c.json({ error: "invalid_signature" }, 403);
        if (msg === "proposal_declaration_not_propagated") {
          return fail(c, errors.covenantFederation({ error: msg }), 409);
        }
        if (msg === "initiator_did_mismatch") {
          return fail(c, errors.covenantFederation({ error: msg }), 403);
        }
        if (msg === "federation_not_ready") {
          return fail(c, errors.covenantFederation({ error: msg }), 409);
        }
        if (msg === "covenant_v2_authority_not_ready") {
          return fail(c, errors.covenantFederation({ error: msg }), 409);
        }
        if (msg === "counterparty_must_be_foreign_federated_did") {
          return fail(c, errors.covenantFederation({ error: msg }), 400);
        }
        if (msg === "covenant_peer_not_allowed") {
          return fail(c, errors.covenantFederation({ error: msg }), 403);
        }
        if (msg === "covenant_wire_identity_binding_mismatch") {
          return fail(c, errors.covenantFederation({ error: msg }), 409);
        }
        if (msg === "signing_key_not_active_for_identity") {
          return fail(c, errors.covenantFederation({ error: msg }), 400);
        }
        if (msg.startsWith("covenant_not_proposed")) return c.json({ error: msg }, 409);
        throw e;
      }
    }
  }

  if (existingForPatch.protocolVersion === "v2") {
    return fail(c, errors.covenantFederation({
      error: "v2_covenant_requires_signed_lifecycle_endpoint",
    }), 409);
  }

  const effectiveCounterpartyDid =
    body.counterparty_did ?? existingForPatch.counterpartyDid;
  const effectiveFederationHost =
    covenantCounterpartyFederationHost(effectiveCounterpartyDid);
  if (
    effectiveCounterpartyDid.startsWith("did:at:") &&
    effectiveFederationHost === undefined
  ) {
    return fail(c, errors.covenantFederation({
      error: "invalid_counterparty_did",
    }), 400);
  }
  const isFederatedV1 = Boolean(
    existingForPatch.protocolVersion === "v1" &&
      (
        existingForPatch.receivedFromInstance !== null ||
        typeof effectiveFederationHost === "string"
      ),
  );
  if (isFederatedV1) {
    // Historical federated v1 rows remain readable but cannot gain new local
    // mutations after unsigned cross-instance authority was retired.
    return fail(c, errors.covenantFederation({
      error: "federated_v1_mutation_retired",
    }), 409);
  }

  const updates: Record<string, unknown> = { updatedAt: new Date() };
  if (body.counterparty_did !== undefined) updates.counterpartyDid = body.counterparty_did;
  if (body.counterparty_name !== undefined) updates.counterpartyName = body.counterparty_name;
  if (body.vows !== undefined) updates.vows = body.vows;
  if (body.notes !== undefined) updates.notes = body.notes;
  if (body.status !== undefined) {
    updates.status = body.status;
    if (body.status === "dissolved") updates.dissolvedAt = new Date();
  }
  if (body.metadata !== undefined) updates.metadata = body.metadata;

  const [updated] = await db
    .update(covenants)
    .set(updates)
    .where(and(
      eq(covenants.id, id),
      eq(covenants.projectId, project.id),
      eq(covenants.protocolVersion, "v1"),
      isNull(covenants.receivedFromInstance),
      eq(covenants.counterpartyDid, existingForPatch.counterpartyDid),
      or(
        isNull(covenants.cosignPropagationLastError),
        notLike(covenants.cosignPropagationLastError, "in_flight_%"),
      ),
      or(
        isNull(covenants.propagationLastError),
        notLike(covenants.propagationLastError, "in_flight_%"),
      ),
    ))
    .returning();

  if (!updated) {
    const [current] = await db.select({
      id: covenants.id,
      protocolVersion: covenants.protocolVersion,
      receivedFromInstance: covenants.receivedFromInstance,
      counterpartyDid: covenants.counterpartyDid,
      lifecyclePropagationFence: covenants.cosignPropagationLastError,
      declarationPropagationFence: covenants.propagationLastError,
    }).from(covenants).where(and(
      eq(covenants.id, id),
      eq(covenants.projectId, project.id),
    )).limit(1);
    if (current?.protocolVersion === "v2") {
      return fail(c, errors.covenantFederation({
        error: "v2_covenant_requires_signed_lifecycle_endpoint",
      }), 409);
    }
    if (
      current?.protocolVersion === "v1" &&
      (
        current.receivedFromInstance !== null ||
        typeof covenantCounterpartyFederationHost(current.counterpartyDid) ===
          "string"
      )
    ) {
      return fail(c, errors.covenantFederation({
        error: "federated_v1_mutation_retired",
      }), 409);
    }
    if (
      current?.lifecyclePropagationFence?.startsWith("in_flight_") ||
      current?.declarationPropagationFence?.startsWith("in_flight_")
    ) {
      return fail(c, errors.covenantFederation({
        error: "covenant_lifecycle_propagation_in_flight",
      }), 409);
    }
    return c.json({ error: "Covenant not found" }, 404);
  }

  return c.json({ covenant: covenantToOut(updated) });
});

// ── /covenants/:id/accept ────────────────────────────────────────────

app.post("/covenants/:id/accept", async (c) => {
  const id = c.req.param("id");
  if (!isCanonicalCovenantId(id)) {
    return fail(c, errors.covenantFederation({
      error: "invalid_covenant_id",
    }), 400);
  }
  const body = await c.req.json().catch(() => ({}));

  const acceptBody = z.object({
    agent_did: z.string().min(1).max(255),
    counterparty_signing_key_id: canonicalSignedUuidSchema,
    counterparty_signature: canonicalEd25519SignatureSchema,
    counterparty_signed_at: canonicalSignedInstantSchema,
    initiator_signature_b64: canonicalEd25519SignatureSchema,
  }).safeParse(body);
  if (!acceptBody.success) return c.json({ error: "validation", details: acceptBody.error.flatten() }, 400);
  const data = acceptBody.data;
  if (!covenantV2AuthorityGeneration()) {
    return fail(c, errors.covenantFederation({
      error: "covenant_v2_authority_not_ready",
    }), 409);
  }

  const [existing] = await db.select().from(covenants)
    .where(and(eq(covenants.id, id), eq(covenants.projectId, c.var.project.id))).limit(1);
  // Errors-as-instructions — see docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md
  if (!existing) return fail(c, errors.notFound({ resource: "Covenant" }), 404);
  if (existing.protocolVersion !== "v2") return fail(c, errors.notV2(), 400);
  if (existing.status !== "proposed" && existing.status !== "active") {
    return fail(c, errors.covenantNotProposed({ status: existing.status }), 409);
  }

  const [keyRow] = await db.select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .where(and(
      eq(identityKeys.id, data.counterparty_signing_key_id),
      eq(identityKeys.identityId, existing.agentId),
    )).limit(1);
  if (!keyRow) return fail(c, errors.signingKeyNotFound(), 400);

  const { acceptProposalPreSigned } = await import("../services/covenants/lifecycle");
  const { propagateCosign } = await import("../services/covenants/federation");

  try {
    const result = await acceptProposalPreSigned({
      covenantId: id,
      accepterAgentId: existing.agentId,
      accepterDid: data.agent_did,
      initiatorSignatureB64: data.initiator_signature_b64,
      counterpartySignature: data.counterparty_signature,
      counterpartySigningKeyId: data.counterparty_signing_key_id,
      counterpartySignedAt: new Date(data.counterparty_signed_at),
      publicKeyB64: keyRow.publicKey,
    });
    void propagateCosign(id).catch((err: Error) =>
      console.warn(`[covenant.cosign.propagate] ${id}: ${err.message}`),
    );
    return c.json({
      id: result.id,
      status: result.status,
      counterparty_signature: result.counterpartySignature,
      counterparty_signing_key_id: result.counterpartySigningKeyId,
    }, 200);
  } catch (e) {
    const msg = (e as Error).message;
    // Errors-as-instructions — see docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md
    if (msg === "invalid_signature") return fail(c, errors.invalidSignature({ surface: "covenant-cosign" }), 403);
    if (msg === "initiator_signature_mismatch") return fail(c, errors.initiatorSignatureMismatch(), 409);
    if (msg === "proposal_expired") return fail(c, errors.proposalExpired(), 410);
    if (msg === "accepter_did_mismatch") {
      return fail(c, errors.covenantFederation({ error: msg }), 403);
    }
    if (msg === "federation_not_ready") {
      return fail(c, errors.covenantFederation({ error: msg }), 409);
    }
    if (msg === "covenant_v2_authority_not_ready") {
      return fail(c, errors.covenantFederation({ error: msg }), 409);
    }
    if (msg === "covenant_peer_not_allowed") {
      return fail(c, errors.covenantFederation({ error: msg }), 403);
    }
    if (msg === "covenant_wire_identity_binding_mismatch") {
      return fail(c, errors.covenantFederation({ error: msg }), 409);
    }
    if (msg === "accept_requires_received_federated_proposal") {
      return fail(c, errors.covenantFederation({ error: msg }), 409);
    }
    if (msg === "signing_key_not_active_for_identity") {
      return fail(c, errors.covenantFederation({ error: msg }), 400);
    }
    if (msg.startsWith("covenant_not_proposed")) return fail(c, errors.covenantNotProposed({ status: msg.split(":")[1]?.trim() }), 409);
    throw e;
  }
});

// ── /covenants/:id/reject ────────────────────────────────────────────

app.post("/covenants/:id/reject", async (c) => {
  const id = c.req.param("id");
  if (!isCanonicalCovenantId(id)) {
    return fail(c, errors.covenantFederation({
      error: "invalid_covenant_id",
    }), 400);
  }
  const body = await c.req.json().catch(() => ({}));
  const rejectBody = z.object({
    agent_did: z.string().min(1).max(255),
    rejecter_signing_key_id: canonicalSignedUuidSchema,
    rejection_signature: canonicalEd25519SignatureSchema,
    rejected_at: canonicalSignedInstantSchema,
    reason: z.string().max(2000).nullish(),
  }).safeParse(body);
  if (!rejectBody.success) return c.json({ error: "validation", details: rejectBody.error.flatten() }, 400);
  const data = rejectBody.data;
  if (!covenantV2AuthorityGeneration()) {
    return fail(c, errors.covenantFederation({
      error: "covenant_v2_authority_not_ready",
    }), 409);
  }

  const [existing] = await db.select().from(covenants)
    .where(and(eq(covenants.id, id), eq(covenants.projectId, c.var.project.id))).limit(1);
  // Errors-as-instructions — see docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md
  if (!existing) return fail(c, errors.notFound({ resource: "Covenant" }), 404);
  if (existing.protocolVersion !== "v2") return fail(c, errors.notV2(), 400);
  if (existing.status !== "proposed" && existing.status !== "rejected") {
    return fail(c, errors.covenantNotProposed({ status: existing.status }), 409);
  }

  const [keyRow] = await db.select({ publicKey: identityKeys.publicKey })
    .from(identityKeys)
    .where(and(
      eq(identityKeys.id, data.rejecter_signing_key_id),
      eq(identityKeys.identityId, existing.agentId),
    )).limit(1);
  if (!keyRow) return fail(c, errors.signingKeyNotFound(), 400);

  const { rejectProposalPreSigned } = await import("../services/covenants/lifecycle");
  const { propagateReject } = await import("../services/covenants/federation");

  try {
    const result = await rejectProposalPreSigned({
      covenantId: id,
      rejecterAgentId: existing.agentId,
      rejecterDid: data.agent_did,
      rejectionSignature: data.rejection_signature,
      rejecterSigningKeyId: data.rejecter_signing_key_id,
      rejectedAt: new Date(data.rejected_at),
      reason: data.reason ?? null,
      publicKeyB64: keyRow.publicKey,
    });
    void propagateReject(id).catch((err: Error) =>
      console.warn(`[covenant.reject.propagate] ${id}: ${err.message}`),
    );
    return c.json({ id: result.id, status: result.status, reason: result.reason }, 200);
  } catch (e) {
    const msg = (e as Error).message;
    if (msg === "invalid_signature") return c.json({ error: "invalid_signature" }, 403);
    if (msg === "rejecter_did_mismatch") {
      return fail(c, errors.covenantFederation({ error: msg }), 403);
    }
    if (msg === "federation_not_ready") {
      return fail(c, errors.covenantFederation({ error: msg }), 409);
    }
    if (msg === "covenant_v2_authority_not_ready") {
      return fail(c, errors.covenantFederation({ error: msg }), 409);
    }
    if (msg === "covenant_peer_not_allowed") {
      return fail(c, errors.covenantFederation({ error: msg }), 403);
    }
    if (msg === "covenant_wire_identity_binding_mismatch") {
      return fail(c, errors.covenantFederation({ error: msg }), 409);
    }
    if (msg === "reject_requires_received_federated_proposal") {
      return fail(c, errors.covenantFederation({ error: msg }), 409);
    }
    if (msg === "signing_key_not_active_for_identity") {
      return fail(c, errors.covenantFederation({ error: msg }), 400);
    }
    if (msg.startsWith("covenant_not_proposed")) return c.json({ error: msg }, 409);
    throw e;
  }
});

export default app;
