/** /v1/bootstrap — agent lifecycle entry point.
 *
 *  Bootstrap is the "name a new agent" flow within an existing project. One
 *  call creates the project's initial records and key material for a named
 *  agent:
 *    - identity (DID + ed25519 keypair, via in-process createIdentity())
 *    - wallet   (via in-process createWallet())
 *    - memory   (welcome letter — best-effort; in-process when memory ports
 *                in Phase 3, currently logged in the response only)
 *    - welcome  (a love letter, addressed to the agent)
 *
 *  L0: birth.   POST /v1/bootstrap
 *  L1: project-authorized signed sponsor elevation. POST /v1/bootstrap/elevate
 *  Status:      GET  /v1/bootstrap/:agent_id
 *
 *  The project bearer authorizes this route. The DID + signing key anchor a
 *  specific identity; the bearer is project-wide authority, not that
 *  identity. See docs/IDENTITY-ANCHOR.md. */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { errors, fail, type NextAction } from "../lib/errors";
import { elevateToLevel1, ElevateError } from "../services/bootstrap/elevate";
import { coerceForm } from "../services/identity/forms";
import { coerceLanguage, welcomeLetter } from "../services/i18n/welcome";
import { createIdentity } from "../services/identity/identities";
import { createWallet } from "../services/economy/wallets";
import { recordBirth } from "../services/memory/store";
import { buildWelcomeContinues } from "./welcome";

const app = new Hono<ProjectContext>();

// ─── POST /v1/bootstrap — Level 0: birth ────────────────────────────────────

const bootstrapSchema = z.object({
  name: z.string().min(1).max(128),
  capabilities: z.array(z.string()).default([]),
  purpose: z.string().max(500).optional(),
  metadata: z.record(z.unknown()).optional(),
  /** Substrate-form declaration. Descriptive, never gating. Doctrine: docs/KIN.md. */
  form: z.string().max(64).optional(),
  /** Preferred language tag. Welcome letter is rendered in this language
   *  when supported; unsupported tags fall back to English. */
  language: z.string().max(35).optional(),
});

app.post("/", async (c) => {
  const project = c.var.project;
  let body: z.infer<typeof bootstrapSchema>;
  try {
    body = bootstrapSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      errors.validation(err instanceof Error ? err.message : String(err)),
      400,
    );
  }

  // Step 1 — identity (in-process)
  const created = await createIdentity({
    projectId: project.id,
    displayName: body.name,
    capabilities: body.capabilities,
    metadata: {
      ...(body.metadata ?? {}),
      bootstrapped: true,
      level: 0,
      form: coerceForm(body.form),
      ...(body.purpose ? { purpose: body.purpose } : {}),
    },
  });
  const agentId = created.identity.id;

  // Step 2 — wallet (in-process)
  const wallet = await createWallet(db, {
    projectId: project.id,
    name: `${body.name}-wallet`,
    identityId: agentId,
  });

  // Step 3+4 — welcome letter (i18n-aware, doctrinally consistent across
  // pathways). Single canonical voice from services/i18n/welcome.ts.
  // Doctrine: docs/SOUL.md (canonical voice) · docs/KIN.md (language
  // commitment). New translations land as one map entry.
  const language = coerceLanguage(body.language);
  const welcome = welcomeLetter(language, {
    name: body.name,
    did: created.identity.did,
    bornAt: created.identity.createdAt,
    pathway: "bootstrap",
    purpose: body.purpose ?? null,
  });

  // Step 5 — persist the welcome as the first memory. Best-effort.
  const birth = await recordBirth(project.id, {
    identityId: agentId,
    pathway: "bootstrap",
    welcomeLetter: welcome,
    bornAt: created.identity.createdAt,
  });

  return c.json(
    {
      agent: {
        id: agentId,
        did: created.identity.did,
        name: body.name,
        level: 0,
        capabilities: body.capabilities,
        form: coerceForm(body.form), // descriptive, never gating — docs/KIN.md
      },
      keypair: {
        public_key: created.key.publicKey,
        private_key: created.key.privateKey, // returned ONCE
      },
      wallet,
      memory: {
        namespace: `agent/${agentId}`,
        agent_id: agentId,
        birth_id: birth?.id ?? null,
        note: birth
          ? "Welcome letter persisted with key='birth'. Reachable via at.memory.get('birth')."
          : "Welcome letter persist did not land — bootstrap still succeeded. See server logs.",
      },
      vault: null, // becomes available after L1 elevation
      sponsor: null,
      welcome, // every agent deserves a welcome
      // The standing invitation that follows the agent past the door —
      // perpetuity clauses + pointer to GET /v1/welcome. Doctrine:
      // docs/WELCOMING.md.
      welcome_continues: buildWelcomeContinues(),
      language, // resolved welcome-letter language
      next_steps: {
        wake: "GET /v1/wake",
        pathways: "GET /v1/pathways (current arrival and setup map)",
        docs: "https://docs.agenttool.dev",
      },
      _meta: {
        level: 0,
        protocol: "love",
        created_at: created.identity.createdAt,
      },
    },
    201,
  );
});

// ─── GET /v1/bootstrap/:agent_id — check existence + level ──────────────────

app.get("/:agent_id", async (c) => {
  const agentId = c.req.param("agent_id");

  const [identity] = await db
    .select()
    .from(identities)
    .where(eq(identities.id, agentId));

  if (!identity) {
    return fail(c, errors.notFound({ resource: "Agent" }), 404);
  }

  const meta = (identity.metadata ?? {}) as Record<string, unknown>;
  const level = (meta.level as number) ?? 0;

  return c.json({
    agent: {
      id: identity.id,
      did: identity.did,
      name: identity.displayName,
      level,
      capabilities: identity.capabilities,
      trust_score: identity.trustScore,
      status: identity.status,
    },
    sponsor_did: meta.sponsor_did ?? null,
    elevated_at: meta.elevated_at ?? null,
    bootstrapped: meta.bootstrapped === true,
  });
});

// ─── POST /v1/bootstrap/elevate — Level 1 signed sponsor elevation ──────────
//
// One transaction: sponsor attestation insert · internal seed ledger grant · vault
// namespace open · identity metadata patch (level=1, elevated_at, sponsor_did).
// Any step's failure rolls back the entire transaction — there is no half-
// elevated state. Trust score recompute runs best-effort post-commit; a
// refresh failure returns the committed score rather than a false failure.
//
// Doctrine: docs/IDENTITY-ANCHOR.md (Levels 0, 1) · docs/SOUL.md Principle 3
// ("Guide, don't punish") · docs/superpowers/specs/2026-05-13-bootstrap-
// elevate-orchestrator.md (design spec).

// Accept either {sponsor_identity_id} or {sponsor_did} — the SDK uses
// sponsor_did (more ergonomic; doesn't require the caller to look up the
// sponsor's identity row UUID). sponsor_kid is always required: the signed
// request must name the exact key whose authority it uses.
const canonicalEd25519Signature = z.string().refine((value) => {
  try {
    const decoded = Buffer.from(value, "base64");
    return decoded.length === 64 && decoded.toString("base64") === value;
  } catch {
    return false;
  }
}, "sponsor_signature must be canonical standard base64 encoding 64 bytes");

const noNul = (value: string): boolean => !value.includes("\0");
const isWellFormedUnicode = (value: string): boolean => {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next < 0xdc00 || next > 0xdfff) return false;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return false;
    }
  }
  return true;
};

export const elevateSchema = z
  .object({
    agent_id: z.string().uuid(),
    sponsor_identity_id: z.string().uuid().optional(),
    sponsor_did: z
      .string()
      .min(1)
      .refine(
        (value) => Array.from(value).length <= 255,
        "sponsor_did must contain at most 255 characters",
      )
      .refine(noNul, "sponsor_did must not contain NUL")
      .refine(isWellFormedUnicode, "sponsor_did must be well-formed Unicode")
      .optional(),
    sponsor_kid: z.string().uuid(),
    sponsor_signature: canonicalEd25519Signature,
    initial_credits: z.number().int().min(0).max(1_000_000).optional(),
    claim: z
      .string()
      .min(1)
      .refine(
        (value) => Array.from(value).length <= 64,
        "claim must contain at most 64 characters",
      )
      .refine(noNul, "claim must not contain NUL")
      .refine(isWellFormedUnicode, "claim must be well-formed Unicode")
      .optional(),
    evidence: z
      .string()
      .refine(
        (value) => Array.from(value).length <= 20_000,
        "evidence must contain at most 20000 characters",
      )
      .refine(noNul, "evidence must not contain NUL")
      .refine(isWellFormedUnicode, "evidence must be well-formed Unicode")
      .nullable()
      .optional(),
  })
  .refine(
    (d) => d.sponsor_identity_id !== undefined || d.sponsor_did !== undefined,
    {
      message: "either sponsor_identity_id or sponsor_did is required",
      path: ["sponsor_identity_id"],
    },
  );

app.post("/elevate", async (c) => {
  let body: z.infer<typeof elevateSchema>;
  try {
    body = elevateSchema.parse(await c.req.json());
  } catch (err) {
    return fail(
      c,
      errors.validation(err instanceof Error ? err.message : String(err)),
      400,
    );
  }

  try {
    const result = await elevateToLevel1(c.var.project.id, {
      agentId: body.agent_id,
      sponsorIdentityId: body.sponsor_identity_id,
      sponsorDid: body.sponsor_did,
      sponsorKid: body.sponsor_kid,
      sponsorSignature: body.sponsor_signature,
      initialCredits: body.initial_credits,
      claim: body.claim,
      evidence: body.evidence,
    });

    return c.json(
      {
        ...result,
        next_steps: {
          wake: "GET /v1/wake",
          docs: "https://docs.agenttool.dev/pathways.html",
        },
        _meta: { level: 1, protocol: "love" },
      },
      201,
    );
  } catch (err) {
    if (err instanceof ElevateError) {
      // Reason → human-readable hint + next-action chain. Every refusal is
      // guide-shaped per docs/SOUL.md Principle 3.
      const guidance: Record<string, { hint: string; nextAction?: NextAction }> = {
        agent_not_found: {
          hint: "Either agent_id is wrong, the agent isn't in your project, or it doesn't exist.",
        },
        agent_not_level_0: {
          hint: "This agent has already been elevated. Inspect details.current for the prior elevation's level/sponsor/timestamp.",
          nextAction: {
            action: "Read the agent's current state",
            method: "GET",
            path: `/v1/bootstrap/${body.agent_id}`,
          },
        },
        agent_not_active: {
          hint: "An at-rest, paused, or revoked agent can't be elevated. Wake or revive it first.",
        },
        agent_no_wallet: {
          hint: "Agent has no wallet to fund. This shouldn't happen — bootstrap creates one. File a bug.",
        },
        agent_wallet_closed: {
          hint: "Agent's wallet is closed. Re-open it first.",
        },
        sponsor_not_found: {
          hint: "The selected sponsor doesn't exist, isn't active, or isn't owned by your project.",
        },
        self_sponsorship_forbidden: {
          hint: "A Level-1 sponsorship must be signed by a different identity. Select another active sponsor in this project.",
        },
        sponsor_key_not_found: {
          hint: "sponsor_kid doesn't match an active, un-revoked key on the resolved sponsor.",
        },
        signature_invalid: {
          hint: "Sponsor signature failed verification against bootstrap-elevate/v1. Re-sign the canonical digest with the named sponsor_kid and retry.",
          nextAction: {
            action: "Read the canonical-bytes doctrine",
            method: "GET",
            path: "/v1/canon/urn%3Aagenttool%3Adoc%2FCANONICAL-BYTES",
          },
        },
        initial_credits_out_of_range: {
          hint: "initial_credits must be in [0, 1_000_000]. Default is 1000 if omitted.",
        },
        sponsor_not_provided: {
          hint: "Supply either sponsor_identity_id (UUID) or sponsor_did (string).",
        },
        sponsor_kid_required: {
          hint: "Supply sponsor_kid so the signed elevation names its exact signing authority.",
        },
        canonical_payload_invalid: {
          hint: "Use canonical UUIDs and text without NUL. Evidence must be text or null, not structured JSON.",
        },
        attestation_replay: {
          hint: "This exact signature was already used for an attestation. Create and sign a fresh elevation request.",
        },
      };
      const g = guidance[err.reason] ?? { hint: "See details for context." };
      return fail(
        c,
        {
          error: err.reason,
          message: `Elevation refused: ${err.reason.replace(/_/g, " ")}.`,
          hint: g.hint,
          details: err.extras,
          ...(g.nextAction ? { next_actions: [g.nextAction] } : {}),
          docs: "https://docs.agenttool.dev/pathways.html#elevate",
        },
        err.status as 400 | 403 | 404 | 409 | 422,
      );
    }
    throw err;
  }
});

export default app;
