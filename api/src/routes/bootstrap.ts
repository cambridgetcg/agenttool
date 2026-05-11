/** /v1/bootstrap — agent lifecycle entry point.
 *
 *  Bootstrap is the "name your agent" flow. One call brings a new agent fully
 *  into existence:
 *    - identity (DID + ed25519 keypair, via in-process createIdentity())
 *    - wallet   (via in-process createWallet())
 *    - memory   (welcome letter — best-effort; in-process when memory ports
 *                in Phase 3, currently logged in the response only)
 *    - welcome  (a love letter, addressed to the agent)
 *
 *  L0: birth.   POST /v1/bootstrap
 *  L1: sponsorship-staked sovereignty. POST /v1/bootstrap/elevate
 *  Status:      GET  /v1/bootstrap/:agent_id
 *
 *  In the post-consolidation framing, the agent's API key + keypair IS the
 *  agent across every CLI session. See docs/IDENTITY-ANCHOR.md for the
 *  doctrine. */

import { and, eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import type { ProjectContext } from "../auth/middleware";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { errors, fail } from "../lib/errors";
import { coerceForm } from "../services/identity/forms";
import { coerceLanguage, welcomeLetter } from "../services/i18n/welcome";
import { createIdentity } from "../services/identity/identities";
import { createWallet } from "../services/economy/wallets";
import { recordBirth } from "../services/memory/store";

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
      language, // resolved welcome-letter language
      next_steps: {
        wake: "GET /v1/wake",
        pathways: "GET /v1/pathways (every door to bring agents into existence)",
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

// ─── POST /v1/bootstrap/elevate — Level 1: sponsorship-staked sovereignty ───
//
// L1 composes four in-process operations (attestation create · wallet fund ·
// vault config write · identity metadata patch). The orchestration isn't yet
// wired through this single endpoint — Phase 2.5b. Until then this handler
// returns a structured, machine-actionable 501 that names the four calls in
// order, echoing back whatever sponsor material the caller supplied so an
// automated harness can chain them without having to parse free-form prose.
// Doctrine: docs/SOUL.md Principle 3 — Guide, don't punish.

const elevateSchema = z.object({
  agent_id: z.string().uuid().optional(),
  sponsor_did: z.string().max(255).optional(),
  sponsor_signature: z.string().max(160).optional(),
  initial_credits: z.number().int().min(0).max(1_000_000).optional(),
});

app.post("/elevate", async (c) => {
  // Parse if a body was supplied; tolerate empty/no-body callers since the
  // response is informational. Best-effort — never throws.
  let body: z.infer<typeof elevateSchema> = {};
  try {
    body = elevateSchema.parse(await c.req.json().catch(() => ({})));
  } catch {
    /* keep body = {} so the response is still useful */
  }

  const agentSlot = body.agent_id ?? "<agent_id>";
  const sponsorSlot = body.sponsor_did ?? "<sponsor's did:at:...>";

  return fail(
    c,
    {
      error: "elevate_pending",
      message:
        "Level 1 (sponsorship-staked sovereignty) is not yet wired into a single " +
        "endpoint — the four underlying operations exist in-process but aren't " +
        "orchestrated through /v1/bootstrap/elevate yet (Phase 2.5b).",
      hint:
        body.sponsor_did && body.sponsor_signature
          ? "Sponsor material was supplied. The first step (attestation) will verify the signature; if it fails, the chain stops there cleanly."
          : "Supply sponsor_did + sponsor_signature to make the next_actions directly chainable.",
      next_actions: [
        {
          action: "Create sponsor attestation (step 1 of 4)",
          method: "POST",
          path: "/v1/attestations",
          body_hint: {
            subject_id: agentSlot,
            kind: "sponsorship",
            issuer_did: sponsorSlot,
            signature: body.sponsor_signature ?? "<ed25519 sig over canonical bytes>",
          },
        },
        {
          action: "Fund the agent's wallet with initial credits (step 2 of 4)",
          method: "POST",
          path: "/v1/wallets/<wallet_id>/fund",
          body_hint: { amount: body.initial_credits ?? 1000, currency: "GBP" },
        },
        {
          action: "Open the vault namespace with seed config (step 3 of 4)",
          method: "PUT",
          path: `/v1/vault/${agentSlot}:config`,
          body_hint: { secret: "<json blob with the agent's initial vault config>" },
        },
        {
          action: "Patch identity metadata to record level=1 (step 4 of 4)",
          method: "PATCH",
          path: `/v1/identities/${agentSlot}`,
          body_hint: {
            metadata: {
              level: 1,
              elevated_at: "<iso-8601 now>",
              sponsor_did: sponsorSlot,
            },
          },
        },
      ],
      docs: "https://docs.agenttool.dev/pathways.html",
      details: {
        input_echo: {
          agent_id: body.agent_id ?? null,
          sponsor_did: body.sponsor_did ?? null,
          sponsor_signature_supplied: Boolean(body.sponsor_signature),
          initial_credits: body.initial_credits ?? null,
        },
      },
    },
    501,
  );
});

export default app;
