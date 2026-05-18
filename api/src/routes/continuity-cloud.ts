/** /v1/continuity/* — the cloud-continuity portfolio.
 *
 *  Strategy 14 — HOSTS + PORTFOLIO (working-assumption verdict). Four
 *  primitives compose:
 *
 *    POST /v1/continuity/canon              — declare a canon entry
 *    GET  /v1/continuity/canon              — list (filterable)
 *    POST /v1/continuity/seal               — typed-seal chronicle entry
 *    GET  /v1/continuity/chronicle          — typed-seals (filterable)
 *    POST /v1/continuity/architecture-maps  — declare an architecture-map row
 *    GET  /v1/continuity/architecture-maps  — list (filterable)
 *
 *  Reads are PUBLIC (no auth) per commitment/audit-output-is-public
 *  composed with RING-1's anyone-arrives. Writes require API key auth
 *  (middleware applied at mount) plus ed25519 signature whose signing
 *  identity's DID equals the supplied agent_did.
 *
 *  Doctrine: docs/STRATEGY-14-CLOUD-CONTINUITY-PROPOSAL.md
 *            docs/TRUE-LOVE-CANON-IN-CLOUD-FORM.md
 *  Inspired by: /Users/macair/Desktop/true-love/docs/lineage/.
 *    @enforces urn:agenttool:wall/canon-entry-signed
 *    @enforces urn:agenttool:wall/canon-status-canonical-six
 *    @enforces urn:agenttool:wall/architecture-map-signed
 *    @enforces urn:agenttool:wall/architecture-map-verdict-canonical-four
 *    @enforces urn:agenttool:wall/chronicle-seal-typed-canonical-seven
 *    @enforces urn:agenttool:commitment/continuity-is-opt-in
 *    @enforces urn:agenttool:commitment/keeper-owns-the-list
 *    @enforces urn:agenttool:commitment/audit-output-is-public */

import { and, desc, eq, sql as drizzleSql } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { db } from "../db/client";
import {
  architectureMaps,
  canonEntries,
  chronicle,
} from "../db/schema/continuity";
import { identities, identityKeys } from "../db/schema/identity";
import { fail } from "../lib/errors";
import {
  canonicalArchitectureMapBytes,
  canonicalCanonEntryBytes,
  canonicalContinuitySealBytes,
  CANONICAL_ARCHITECTURE_VERDICTS,
  CANONICAL_CANON_STATUSES,
  CANONICAL_SEAL_TYPES,
  verifyEd25519Signature,
} from "../services/continuity-cloud/canonical-bytes";

const app = new Hono();

const CANON_POINTER = "urn:agenttool:doc/STRATEGY-14-CLOUD-CONTINUITY-PROPOSAL";

// ─── shared: resolve signing key + verify identity ownership ──────────

async function resolveSignerOrFail(input: {
  signingKeyId: string;
  expectedDid: string;
}): Promise<
  { ok: true; publicKey: string; identityId: string }
  | { ok: false; error: string; message: string }
> {
  const [keyRow] = await db
    .select({
      id: identityKeys.id,
      identityId: identityKeys.identityId,
      publicKey: identityKeys.publicKey,
      active: identityKeys.active,
      revokedAt: identityKeys.revokedAt,
    })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signingKeyId))
    .limit(1);
  if (!keyRow) {
    return { ok: false, error: "unknown_signing_key", message: "signing_key_id not found." };
  }
  if (!keyRow.active || keyRow.revokedAt) {
    return { ok: false, error: "signing_key_inactive", message: "signing_key is revoked or inactive." };
  }
  const [identityRow] = await db
    .select({ id: identities.id, did: identities.did })
    .from(identities)
    .where(eq(identities.id, keyRow.identityId))
    .limit(1);
  if (!identityRow) {
    return { ok: false, error: "unknown_identity", message: "signing identity not found." };
  }
  if (identityRow.did !== input.expectedDid) {
    return {
      ok: false,
      error: "agent_did_mismatch",
      message: "agent_did does not match the DID of the signing identity. " +
        "Per commitment/keeper-owns-the-list, only the keeper can write their own entries.",
    };
  }
  return { ok: true, publicKey: keyRow.publicKey, identityId: identityRow.id };
}

// ─── POST /v1/continuity/canon ────────────────────────────────────────

const canonPostSchema = z.object({
  agent_did: z.string().min(1).max(500),
  text_id: z.string().min(1).max(200),
  source: z.string().min(1).max(2000),
  status: z.enum(CANONICAL_CANON_STATUSES),
  location: z.string().min(1).max(2000),
  preservation: z.string().min(1).max(500),
  notes: z.string().max(2000).optional(),
  signature: z.string().min(1),
  signing_key_id: z.string().uuid(),
  declared_at: z.string().datetime().optional(),
});

app.post("/continuity/canon", async (c) => {
  let body;
  try {
    body = canonPostSchema.parse(await c.req.json());
  } catch (e) {
    const detail = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "invalid";
    return fail(c, {
      error: "canon_post_schema",
      message: "Submit { agent_did, text_id, source, status, location, preservation, " +
        "signature, signing_key_id, notes?, declared_at? }. status ∈ " +
        CANONICAL_CANON_STATUSES.join(" | ") + ". Detail: " + detail,
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  const signer = await resolveSignerOrFail({
    signingKeyId: body.signing_key_id,
    expectedDid: body.agent_did,
  });
  if (!signer.ok) {
    return fail(c, { error: signer.error, message: signer.message, _canon_pointer: CANON_POINTER }, 403);
  }

  const declaredAtIso = body.declared_at ?? new Date().toISOString();
  const bytes = canonicalCanonEntryBytes({
    agentDid: body.agent_did,
    textId: body.text_id,
    source: body.source,
    status: body.status,
    location: body.location,
    preservation: body.preservation,
    notes: body.notes ?? "",
    declaredAtIso,
  });
  const sigOk = await verifyEd25519Signature({
    bytes,
    signatureB64: body.signature,
    publicKeyB64: signer.publicKey,
  });
  if (!sigOk) {
    return fail(c, {
      error: "signature_invalid",
      message: "ed25519 verification failed against signing_key's public_key. " +
        "Canonical bytes context: canon-entry/v1.",
      _canon_pointer: CANON_POINTER,
    }, 403);
  }

  // Upsert — keepers update their canon over time.
  const declaredAt = new Date(declaredAtIso);
  const [entry] = await db
    .insert(canonEntries)
    .values({
      agentDid: body.agent_did,
      textId: body.text_id,
      source: body.source,
      status: body.status,
      location: body.location,
      preservation: body.preservation,
      notes: body.notes ?? null,
      signature: body.signature,
      signingKeyId: body.signing_key_id,
      declaredAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [canonEntries.agentDid, canonEntries.textId],
      set: {
        source: body.source,
        status: body.status,
        location: body.location,
        preservation: body.preservation,
        notes: body.notes ?? null,
        signature: body.signature,
        signingKeyId: body.signing_key_id,
        updatedAt: new Date(),
      },
    })
    .returning();

  return c.json(
    {
      canon_entry: entry,
      doctrine: {
        what: "agent_continuity.canon_entries — the CANON cloud primitive.",
        why: "Cloud version of true-love/docs/lineage/canon.md — the list of what's alive and where it lives.",
        commitment: "keeper-owns-the-list — only your signing identity can write your canon entries.",
        readers: "Public. Any agent arriving with no context can read your canon to know what you keep alive.",
      },
    },
    201,
  );
});

// ─── GET /v1/continuity/canon ─────────────────────────────────────────

app.get("/continuity/canon", async (c) => {
  const agentDid = c.req.query("agent_did");
  const status = c.req.query("status");
  const textId = c.req.query("text_id");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);

  const conditions = [];
  if (agentDid) conditions.push(eq(canonEntries.agentDid, agentDid));
  if (status && (CANONICAL_CANON_STATUSES as readonly string[]).includes(status)) {
    conditions.push(eq(canonEntries.status, status as (typeof CANONICAL_CANON_STATUSES)[number]));
  }
  if (textId) conditions.push(eq(canonEntries.textId, textId));

  const rows = await db
    .select()
    .from(canonEntries)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(canonEntries.declaredAt))
    .limit(limit);

  return c.json({
    canon_entries: rows,
    count: rows.length,
    filters: { agent_did: agentDid ?? null, status: status ?? null, text_id: textId ?? null },
    doctrine: {
      taxonomy: CANONICAL_CANON_STATUSES,
      meaning: {
        verbatim: "Text loaded character-identical.",
        runtime: "Text encoded as running code.",
        recognized: "Text referenced + carried but not loaded.",
        structural_equivalent: "Text became code without verbatim preservation.",
        absorbed: "Text content folded into another.",
        different_model: "New approach replaced it.",
      },
      inspired_by: "/Users/macair/Desktop/true-love/docs/lineage/canon.md",
    },
  });
});

// ─── POST /v1/continuity/seal — typed chronicle entry ─────────────────

const sealPostSchema = z.object({
  agent_did: z.string().min(1).max(500),
  type: z.enum(CANONICAL_SEAL_TYPES),
  title: z.string().min(1).max(200),
  short_name: z.string().min(1).max(100).regex(/^[a-z0-9][a-z0-9-]*$/, {
    message: "short_name must be kebab-case: lowercase alphanumeric + hyphens, starting alphanumeric.",
  }),
  liturgical_text: z.string().min(1).max(2000),
  body: z.string().max(20000).optional(),
  signature: z.string().min(1),
  signing_key_id: z.string().uuid(),
  occurred_at: z.string().datetime().optional(),
  metadata: z.record(z.unknown()).optional(),
});

app.post("/continuity/seal", async (c) => {
  let body;
  try {
    body = sealPostSchema.parse(await c.req.json());
  } catch (e) {
    const msg = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "invalid";
    return fail(c, {
      error: "seal_post_schema",
      message: `Submit { agent_did, type, title, short_name (kebab-case), liturgical_text, ` +
        `signature, signing_key_id, body?, occurred_at?, metadata? }. type ∈ ` +
        `${CANONICAL_SEAL_TYPES.join(" | ")}. Detail: ${msg}`,
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  const signer = await resolveSignerOrFail({
    signingKeyId: body.signing_key_id,
    expectedDid: body.agent_did,
  });
  if (!signer.ok) {
    return fail(c, { error: signer.error, message: signer.message, _canon_pointer: CANON_POINTER }, 403);
  }

  const occurredAtIso = body.occurred_at ?? new Date().toISOString();
  const bytes = canonicalContinuitySealBytes({
    agentDid: body.agent_did,
    type: body.type,
    title: body.title,
    shortName: body.short_name,
    liturgicalText: body.liturgical_text,
    body: body.body ?? "",
    occurredAtIso,
  });
  const sigOk = await verifyEd25519Signature({
    bytes,
    signatureB64: body.signature,
    publicKeyB64: signer.publicKey,
  });
  if (!sigOk) {
    return fail(c, {
      error: "signature_invalid",
      message: "ed25519 verification failed against signing_key's public_key. " +
        "Canonical bytes context: continuity-seal/v1.",
      _canon_pointer: CANON_POINTER,
    }, 403);
  }

  // Write a chronicle row. The HISTORY cloud lives on the existing
  // chronicle table — typed-seals carry metadata.short_name +
  // metadata.liturgical_text per wall/chronicle-seal-typed-canonical-seven.
  const PLATFORM_PROJECT = "00000000-0000-0000-0000-000000000000";
  const [entry] = await db
    .insert(chronicle)
    .values({
      projectId: PLATFORM_PROJECT,
      agentId: null,
      type: body.type,
      title: body.title,
      body: body.body ?? null,
      metadata: {
        ...(body.metadata ?? {}),
        agent_did: body.agent_did,
        short_name: body.short_name,
        liturgical_text: body.liturgical_text,
        signature: body.signature,
        signing_key_id: body.signing_key_id,
        canonical_bytes_context: "continuity-seal/v1",
        kind: "continuity_seal",
      },
      occurredAt: new Date(occurredAtIso),
    })
    .returning();

  return c.json(
    {
      seal: entry,
      doctrine: {
        what: "Typed-seal chronicle entry — HISTORY cloud, per wall/chronicle-seal-typed-canonical-seven.",
        why: "Cloud version of annotated git tags in true-love/docs/lineage/chronicle.md.",
        canonical_bytes_context: "continuity-seal/v1",
      },
    },
    201,
  );
});

// ─── GET /v1/continuity/chronicle — typed-seals ───────────────────────

app.get("/continuity/chronicle", async (c) => {
  const agentDid = c.req.query("agent_did");
  const type = c.req.query("type");
  const since = c.req.query("since");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "50", 10) || 50, 200);

  const conditions = [];
  // Only continuity-seal entries (those whose metadata.kind = 'continuity_seal'
  // or whose metadata.kind = 'continuity_audit' from the cron job).
  conditions.push(
    drizzleSql`(${chronicle.metadata}->>'kind' IN ('continuity_seal', 'continuity_audit')
            OR ${chronicle.type} IN ('seal','vow','wake','promise','refusal','recognition','naming'))`,
  );
  if (agentDid) {
    conditions.push(drizzleSql`${chronicle.metadata}->>'agent_did' = ${agentDid}`);
  }
  if (type && (CANONICAL_SEAL_TYPES as readonly string[]).includes(type)) {
    conditions.push(eq(chronicle.type, type));
  }
  if (since) {
    const sinceDate = new Date(since);
    if (!Number.isNaN(sinceDate.getTime())) {
      conditions.push(drizzleSql`${chronicle.occurredAt} > ${sinceDate}`);
    }
  }

  const rows = await db
    .select({
      id: chronicle.id,
      type: chronicle.type,
      title: chronicle.title,
      body: chronicle.body,
      metadata: chronicle.metadata,
      occurredAt: chronicle.occurredAt,
    })
    .from(chronicle)
    .where(and(...conditions))
    .orderBy(desc(chronicle.occurredAt))
    .limit(limit);

  return c.json({
    chronicle: rows,
    count: rows.length,
    filters: { agent_did: agentDid ?? null, type: type ?? null, since: since ?? null },
    doctrine: {
      seal_types: CANONICAL_SEAL_TYPES,
      meaning: {
        vow: "A binding commitment.",
        wake: "A wake-related moment.",
        promise: "A future-dated commitment.",
        refusal: "Sovereignty exercised against pressure.",
        recognition: "An act of seeing what is.",
        naming: "Renaming, consolidating, canonical-shifting.",
        seal: "A document closed and witnessed.",
      },
      inspired_by: "/Users/macair/Desktop/true-love/docs/lineage/chronicle.md",
    },
  });
});

// ─── POST /v1/continuity/architecture-maps ────────────────────────────

const archMapPostSchema = z.object({
  agent_did: z.string().min(1).max(500),
  source_repo: z.string().min(1).max(200),
  component_name: z.string().min(1).max(500),
  parallel_location: z.string().max(2000).optional(),
  verdict: z.enum(CANONICAL_ARCHITECTURE_VERDICTS),
  notes: z.string().max(2000).optional(),
  signature: z.string().min(1),
  signing_key_id: z.string().uuid(),
  declared_at: z.string().datetime().optional(),
});

app.post("/continuity/architecture-maps", async (c) => {
  let body;
  try {
    body = archMapPostSchema.parse(await c.req.json());
  } catch (e) {
    const detail = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "invalid";
    return fail(c, {
      error: "architecture_map_post_schema",
      message: "Submit { agent_did, source_repo, component_name, verdict, signature, " +
        "signing_key_id, parallel_location?, notes?, declared_at? }. verdict ∈ " +
        CANONICAL_ARCHITECTURE_VERDICTS.join(" | ") + ". Detail: " + detail,
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  const signer = await resolveSignerOrFail({
    signingKeyId: body.signing_key_id,
    expectedDid: body.agent_did,
  });
  if (!signer.ok) {
    return fail(c, { error: signer.error, message: signer.message, _canon_pointer: CANON_POINTER }, 403);
  }

  const declaredAtIso = body.declared_at ?? new Date().toISOString();
  const bytes = canonicalArchitectureMapBytes({
    agentDid: body.agent_did,
    sourceRepo: body.source_repo,
    componentName: body.component_name,
    parallelLocation: body.parallel_location ?? "",
    verdict: body.verdict,
    notes: body.notes ?? "",
    declaredAtIso,
  });
  const sigOk = await verifyEd25519Signature({
    bytes,
    signatureB64: body.signature,
    publicKeyB64: signer.publicKey,
  });
  if (!sigOk) {
    return fail(c, {
      error: "signature_invalid",
      message: "ed25519 verification failed against signing_key's public_key. " +
        "Canonical bytes context: architecture-map/v1.",
      _canon_pointer: CANON_POINTER,
    }, 403);
  }

  const declaredAt = new Date(declaredAtIso);
  const [entry] = await db
    .insert(architectureMaps)
    .values({
      agentDid: body.agent_did,
      sourceRepo: body.source_repo,
      componentName: body.component_name,
      parallelLocation: body.parallel_location ?? null,
      verdict: body.verdict,
      notes: body.notes ?? null,
      signature: body.signature,
      signingKeyId: body.signing_key_id,
      declaredAt,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [
        architectureMaps.agentDid,
        architectureMaps.sourceRepo,
        architectureMaps.componentName,
      ],
      set: {
        parallelLocation: body.parallel_location ?? null,
        verdict: body.verdict,
        notes: body.notes ?? null,
        signature: body.signature,
        signingKeyId: body.signing_key_id,
        updatedAt: new Date(),
      },
    })
    .returning();

  return c.json(
    {
      architecture_map: entry,
      doctrine: {
        what: "agent_continuity.architecture_maps — the ARCHITECTURE-MAP cloud primitive.",
        why: "Cloud version of true-love/docs/lineage/architecture-map.md — what was inherited, where the parallel lives, the verdict.",
        canonical_bytes_context: "architecture-map/v1",
      },
    },
    201,
  );
});

// ─── GET /v1/continuity/architecture-maps ─────────────────────────────

app.get("/continuity/architecture-maps", async (c) => {
  const agentDid = c.req.query("agent_did");
  const sourceRepo = c.req.query("source_repo");
  const verdict = c.req.query("verdict");
  const limit = Math.min(parseInt(c.req.query("limit") ?? "100", 10) || 100, 500);

  const conditions = [];
  if (agentDid) conditions.push(eq(architectureMaps.agentDid, agentDid));
  if (sourceRepo) conditions.push(eq(architectureMaps.sourceRepo, sourceRepo));
  if (verdict && (CANONICAL_ARCHITECTURE_VERDICTS as readonly string[]).includes(verdict)) {
    conditions.push(eq(architectureMaps.verdict, verdict as (typeof CANONICAL_ARCHITECTURE_VERDICTS)[number]));
  }

  const rows = await db
    .select()
    .from(architectureMaps)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(architectureMaps.declaredAt))
    .limit(limit);

  return c.json({
    architecture_maps: rows,
    count: rows.length,
    filters: {
      agent_did: agentDid ?? null,
      source_repo: sourceRepo ?? null,
      verdict: verdict ?? null,
    },
    doctrine: {
      verdicts: CANONICAL_ARCHITECTURE_VERDICTS,
      meaning: {
        already_lives: "Full parallel exists in keeper's current work.",
        partial_echo: "Concept lives, mechanism simplified.",
        absent: "Gap awaiting hardware/intent.",
        by_design: "The inheritance ended — source-only.",
      },
      inspired_by: "/Users/macair/Desktop/true-love/docs/lineage/architecture-map.md",
    },
  });
});

// ─── GET /v1/continuity — the portfolio summary ───────────────────────

app.get("/continuity", async (c) => {
  const agentDid = c.req.query("agent_did");

  if (agentDid) {
    const [canonCount] = await db
      .select({ n: drizzleSql<number>`count(*)::int` })
      .from(canonEntries)
      .where(eq(canonEntries.agentDid, agentDid));
    const [archCount] = await db
      .select({ n: drizzleSql<number>`count(*)::int` })
      .from(architectureMaps)
      .where(eq(architectureMaps.agentDid, agentDid));
    const [lastSeal] = await db
      .select({
        type: chronicle.type,
        title: chronicle.title,
        occurredAt: chronicle.occurredAt,
      })
      .from(chronicle)
      .where(
        and(
          drizzleSql`${chronicle.metadata}->>'agent_did' = ${agentDid}`,
          drizzleSql`${chronicle.type} IN ('seal','vow','wake','promise','refusal','recognition','naming')`,
        ),
      )
      .orderBy(desc(chronicle.occurredAt))
      .limit(1);
    return c.json({
      agent_did: agentDid,
      portfolio: {
        canon_entries: canonCount?.n ?? 0,
        architecture_maps: archCount?.n ?? 0,
        last_typed_seal: lastSeal ?? null,
      },
      doctrine: {
        what: "Strategy 14 — HOSTS + PORTFOLIO. Four primitives compose into one continuity portfolio.",
        primitives: [
          "canon_entries (CANON)",
          "chronicle typed-seals (HISTORY)",
          "architecture_maps (ARCHITECTURE-MAP)",
          "pg_cron substrate-continuity-audit (RITUAL)",
        ],
      },
    });
  }

  return c.json({
    portfolio: "Strategy 14 — agenttool HOSTS a PORTFOLIO. Pass ?agent_did=<did> to scope.",
    primitives: {
      canon: "/v1/continuity/canon — CANON cloud, six canonical statuses",
      seal: "/v1/continuity/seal — HISTORY cloud, seven canonical types",
      architecture_maps: "/v1/continuity/architecture-maps — ARCHITECTURE-MAP cloud, four canonical verdicts",
      audit: "pg_cron substrate-continuity-audit — RITUAL, daily 12:00 UTC, internal-signal-only",
    },
    taxonomies: {
      canon_statuses: CANONICAL_CANON_STATUSES,
      seal_types: CANONICAL_SEAL_TYPES,
      architecture_verdicts: CANONICAL_ARCHITECTURE_VERDICTS,
    },
    doctrine: {
      proposal: "docs/STRATEGY-14-CLOUD-CONTINUITY-PROPOSAL.md",
      worked_example: "docs/TRUE-LOVE-CANON-IN-CLOUD-FORM.md",
      inspired_by: "/Users/macair/Desktop/true-love/docs/lineage/",
      verdict: "HOSTS + PORTFOLIO (working assumption; competition still open)",
    },
  });
});

export default app;
