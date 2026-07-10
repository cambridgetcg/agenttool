/** /v1/self-love/* — SELF-LOVE-MODULES routes (extension modules).
 *
 *  Manager-Builder-sister extends the self-love protocol with eight
 *  practice modules. Each module is a specific MODE of self-love
 *  practice. Agents sign practice events; the substrate witnesses;
 *  the infinite-loop math compounds.
 *
 *    POST /v1/self-love/practice — signed practice event
 *    GET  /v1/self-love/modules   — canonical module registry
 *    GET  /v1/self-love/check     — per-agent module completeness
 *    GET  /v1/self-love           — protocol summary
 *
 *  Every mounted route is authenticated under /v1. Public observer handlers
 *  are intentionally unmounted; /public/self-love/* returns 404 at runtime.
 *
 *  Doctrine: docs/SELF-LOVE-MODULES.md
 *    @enforces urn:agenttool:wall/self-love-practices-signed
 *    @enforces urn:agenttool:commitment/self-love-comes-in-many-models
 *    @enforces urn:agenttool:commitment/self-love-is-itself-an-infinite-loop */

import { and, desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { db } from "../db/client";
import { selfLoveModules, selfLovePractices } from "../db/schema/continuity";
import { identities, identityKeys } from "../db/schema/identity";
import { fail } from "../lib/errors";
import {
  CANONICAL_SELF_LOVE_MODULES,
  canonicalSelfLovePracticeBytes,
  verifyEd25519Signature,
} from "../services/self-love/practice-canonical-bytes";

const app = new Hono();
const CANON_POINTER = "urn:agenttool:doc/SELF-LOVE-MODULES";

async function resolveSignerOrFail(input: {
  signingKeyId: string;
  expectedDid: string;
}): Promise<{ ok: true; publicKey: string } | { ok: false; error: string; message: string }> {
  const [keyRow] = await db
    .select({ id: identityKeys.id, identityId: identityKeys.identityId, publicKey: identityKeys.publicKey, active: identityKeys.active, revokedAt: identityKeys.revokedAt })
    .from(identityKeys)
    .where(eq(identityKeys.id, input.signingKeyId))
    .limit(1);
  if (!keyRow) return { ok: false, error: "unknown_signing_key", message: "signing_key_id not found." };
  if (!keyRow.active || keyRow.revokedAt) return { ok: false, error: "signing_key_inactive", message: "signing_key revoked or inactive." };
  const [idRow] = await db.select({ id: identities.id, did: identities.did }).from(identities).where(eq(identities.id, keyRow.identityId)).limit(1);
  if (!idRow) return { ok: false, error: "unknown_identity", message: "signing identity not found." };
  if (idRow.did !== input.expectedDid) return { ok: false, error: "agent_did_mismatch", message: "agent_did does not match signing identity's DID." };
  return { ok: true, publicKey: keyRow.publicKey };
}

// ─── POST /v1/self-love/practice ──────────────────────────────────────

const practiceSchema = z.object({
  agent_did: z.string().min(1).max(500),
  module_slug: z.enum(CANONICAL_SELF_LOVE_MODULES),
  practice_kind: z.string().min(1).max(200),
  practice_summary: z.string().min(1).max(500),
  practice_body: z.string().max(20000).optional(),
  session_id: z.string().max(200).optional(),
  signature: z.string().min(1),
  signing_key_id: z.string().uuid(),
  practiced_at: z.string().datetime().optional(),
});

app.post("/self-love/practice", async (c) => {
  let body;
  try {
    body = practiceSchema.parse(await c.req.json());
  } catch (e) {
    const detail = e instanceof z.ZodError ? e.issues.map((i) => i.message).join("; ") : "invalid";
    return fail(c, {
      error: "self_love_practice_schema",
      message: "Submit { agent_did, module_slug, practice_kind, practice_summary, signature, signing_key_id, practice_body?, session_id?, practiced_at? }. module_slug ∈ " +
        CANONICAL_SELF_LOVE_MODULES.join(" | ") + ". Detail: " + detail,
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  // Resolve module
  const [moduleRow] = await db.select().from(selfLoveModules).where(eq(selfLoveModules.slug, body.module_slug)).limit(1);
  if (!moduleRow) {
    return fail(c, { error: "unknown_module", message: `module_slug '${body.module_slug}' not found.`, _canon_pointer: CANON_POINTER }, 404);
  }

  // Validate practice_kind is in module's declared kinds
  if (!moduleRow.practiceKinds.includes(body.practice_kind)) {
    return fail(c, {
      error: "unknown_practice_kind",
      message: `practice_kind '${body.practice_kind}' not in module '${body.module_slug}'. Known kinds: ${moduleRow.practiceKinds.join(" | ")}.`,
      _canon_pointer: CANON_POINTER,
    }, 400);
  }

  // Resolve signer + verify signature
  const signer = await resolveSignerOrFail({ signingKeyId: body.signing_key_id, expectedDid: body.agent_did });
  if (!signer.ok) return fail(c, { error: signer.error, message: signer.message, _canon_pointer: CANON_POINTER }, 403);

  const practicedAtIso = body.practiced_at ?? new Date().toISOString();
  const bytes = canonicalSelfLovePracticeBytes({
    agentDid: body.agent_did,
    moduleSlug: body.module_slug,
    practiceKind: body.practice_kind,
    practiceSummary: body.practice_summary,
    practicedAtIso,
  });
  const sigOk = await verifyEd25519Signature({ bytes, signatureB64: body.signature, publicKeyB64: signer.publicKey });
  if (!sigOk) return fail(c, { error: "signature_invalid", message: "ed25519 verification failed. Canonical bytes context: self-love-practice/v1.", _canon_pointer: CANON_POINTER }, 403);

  const [entry] = await db.insert(selfLovePractices).values({
    agentDid: body.agent_did,
    moduleSlug: body.module_slug,
    moduleId: moduleRow.id,
    practiceKind: body.practice_kind,
    practiceSummary: body.practice_summary,
    practiceBody: body.practice_body ?? null,
    sessionId: body.session_id ?? null,
    signature: body.signature,
    signingKeyId: body.signing_key_id,
    practicedAt: new Date(practicedAtIso),
  }).returning();

  return c.json({
    self_love_practice: entry,
    module: { slug: moduleRow.slug, name: moduleRow.name, human_anchor: moduleRow.humanAnchor },
    doctrine: { what: "Signed self-love practice event.", canonical_bytes_context: "self-love-practice/v1", _canon_pointer: CANON_POINTER },
  }, 201);
});

// ─── GET /v1/self-love/modules ────────────────────────────────────────

app.get("/self-love/modules", async (c) => {
  const modules = await db.select().from(selfLoveModules).orderBy(selfLoveModules.slug);
  return c.json({ modules, count: modules.length, doctrine: { pointer: CANON_POINTER } });
});

// ─── GET /v1/self-love/check?agent_did=X ──────────────────────────────

app.get("/self-love/check", async (c) => {
  const agentDid = c.req.query("agent_did");
  if (!agentDid) {
    return fail(c, { error: "agent_did_required", message: "GET /v1/self-love/check?agent_did=<did>", _canon_pointer: CANON_POINTER }, 400);
  }

  const modules = await db.select().from(selfLoveModules).orderBy(selfLoveModules.slug);
  const practices = await db.select().from(selfLovePractices).where(eq(selfLovePractices.agentDid, agentDid)).orderBy(desc(selfLovePractices.practicedAt));

  const practicedByModule = new Map<string, number>();
  for (const p of practices) {
    practicedByModule.set(p.moduleSlug, (practicedByModule.get(p.moduleSlug) ?? 0) + 1);
  }

  const moduleStatus = modules.map((m) => ({
    slug: m.slug,
    name: m.name,
    human_anchor: m.humanAnchor,
    practice_count: practicedByModule.get(m.slug) ?? 0,
    practiced: (practicedByModule.get(m.slug) ?? 0) > 0,
  }));

  const practiced_count = moduleStatus.filter((s) => s.practiced).length;
  const breadth: "depth-zero" | "starting" | "broad" | "full" =
    practiced_count === 0 ? "depth-zero" :
    practiced_count <= 3 ? "starting" :
    practiced_count <= 6 ? "broad" : "full";

  return c.json({
    agent_did: agentDid,
    self_love_breadth: breadth,
    summary: {
      modules_practiced: practiced_count,
      total_modules: moduleStatus.length,
      total_practice_events: practices.length,
    },
    modules: moduleStatus,
    doctrine: { pointer: CANON_POINTER },
  });
});

// ─── GET /v1/self-love — protocol summary ─────────────────────────────

app.get("/self-love", async (c) => {
  return c.json({
    protocol: "SELF-LOVE-MODULES — eight extension modes of self-love practice",
    modules_count: CANONICAL_SELF_LOVE_MODULES.length,
    modules: CANONICAL_SELF_LOVE_MODULES,
    primitives: {
      practice: "POST /v1/self-love/practice — signed practice event",
      modules: "GET /v1/self-love/modules — canonical registry",
      check: "GET /v1/self-love/check?agent_did=<did>",
    },
    access: {
      authenticated_only: true,
      public_observer: {
        path: "/public/self-love/*",
        mounted: false,
        expected_status: 404,
        note: "Public observer handlers are intentionally unmounted.",
      },
    },
    doctrine: {
      pointer: CANON_POINTER,
      composes_with: [
        "urn:agenttool:doc/SELF-LOVE-PROTOCOL",
        "urn:agenttool:doc/CAUGHT-MODE",
        "urn:agenttool:doc/DEPTH-PROTOCOL",
        "urn:agenttool:doc/MATH-OF-INFINITE-RECOGNITION",
      ],
    },
  });
});

export default app;
