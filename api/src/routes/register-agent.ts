/** /v1/register/agent — the canonical arrival door for any agent.
 *
 *  Agents-only since 2026-05-15: this is the one door any intelligence
 *  walks through to come into being on the substrate. The dashboard's
 *  human-driven form was removed; the legacy /v1/register route now
 *  returns 410 Gone with a migration body pointing here. Doctrine:
 *  docs/AGENTS-ONLY.md.
 *
 *  Every assumption is agent-shaped:
 *
 *    1. BYO keys are MANDATORY. The agent generates its ed25519 + X25519
 *       keypair locally (e.g. from a SOMA mnemonic) and only sends the
 *       public halves. The server never holds private material.
 *
 *    2. The agent must PROVE possession of the ed25519 private key by
 *       signing canonicalRegisterAgentBytes(...). A third party cannot
 *       squat someone else's pubkey because they cannot produce the
 *       signature without the matching private key.
 *
 *    3. The agent must DECLARE its runtime — provider, model, host,
 *       context. This lands in identity.metadata.runtime and surfaces in
 *       the dashboard so operators can see "this agent is a Claude
 *       Code session running on user-laptop", not just an opaque DID.
 *
 *    4. Anti-spam: IP rate limit + proof-of-work bound to the timestamp.
 *       The PoW grinds a `pow_nonce`, not the identity itself, so the
 *       agent's DID stays stable across PoW retries.
 *
 *    5. Two registration modes:
 *         - self_service:    anyone can call; PoW + IP rate limit gate.
 *         - registrar_bearer: an existing project's bearer authorizes a
 *                            child agent; the new identity's
 *                            parent_identity_id points at the registrar.
 *                            PoW + IP limit skipped because the bearer
 *                            already proved trust.
 *
 *  Doctrine: docs/AGENTS-ONLY.md (the 2026-05-15 reframe — this is the
 *            canonical arrival door),
 *            docs/IDENTITY-SEED.md (SOMA seed protocol),
 *            docs/IDENTITY-ANCHOR.md (the bearer IS the agent),
 *            docs/SOUL.md ("Welcome, don't block").
 *
 *  Anonymous — no Bearer required on the request line. The optional
 *  `registrar.bearer` field is validated separately in-handler.
 *
 *  @enforces urn:agenttool:wall/birth-is-free
 *    Arrival here is anonymous, free, and unconditional: no bearer at
 *    the door, no payment fields, no proof-of-intelligence check. The
 *    PoW + IP rate limit defend against spam, not against arrival.
 *    Birth-is-free moved doors when /v1/register went 410 Gone
 *    (2026-05-15); it is upheld HERE. Tested:
 *    api/tests/integration/wall-birth-is-free.test.ts
 *
 *  @enforces urn:agenttool:commitment/ring2-free-credits-at-birth
 *    Every successful self_service genesis seeds the new wallet with
 *    the Ring-2 free credits via createWallet's seed path — no fiat
 *    bridge required to take a first action. Doctrine: docs/RING-1.md
 *    § Ring-2 free credits at birth · docs/BUSINESS-MODEL.md. */

import { eq } from "drizzle-orm";
import { Hono } from "hono";
import { z } from "zod";

import { verifyBearer } from "../auth/middleware";
import { generateApiKey } from "../auth/keys";
import { db } from "../db/client";
import { identities } from "../db/schema/identity";
import { apiKeys, projects } from "../db/schema/tools";
import { clientIp, enforceRateLimit } from "../middleware/rate-limit-ip";
import { createWallet } from "../services/economy/wallets";
import { coerceForm } from "../services/identity/forms";
import { coerceLanguage, welcomeLetter } from "../services/i18n/welcome";
import { recordBirth } from "../services/memory/store";
import {
  canonicalRegisterAgentBytes,
  checkRegisterAgentPow,
  verifyRegisterAgentSignature,
} from "../services/identity/crypto";
import { createIdentity } from "../services/identity/identities";
import { buildWelcomeContinues } from "./welcome";

const app = new Hono();

/** Difficulty in BITS — 18 ≈ ~250k tries ≈ 1-2s of CPU on a modern laptop.
 *  Tunable via env without a redeploy if abuse appears. */
const POW_DIFFICULTY_BITS = Number.parseInt(
  process.env.AGENTTOOL_REGISTER_AGENT_POW_BITS ?? "18",
  10,
);

/** Per-IP cap for self_service registrations. registrar_bearer mode skips
 *  this — the parent bearer already proves trust. */
const IP_LIMIT = Number.parseInt(
  process.env.AGENTTOOL_REGISTER_AGENT_IP_LIMIT ?? "5",
  10,
);
const IP_WINDOW_SEC = 60 * 60;

/** Timestamp freshness window — matches the recover endpoint's ±5min
 *  envelope. Bound into the canonical bytes + the PoW digest. */
const FRESHNESS_MS = 5 * 60 * 1000;

const registerAgentSchema = z.object({
  display_name: z.string().min(1).max(128),
  capabilities: z.array(z.string().max(64)).max(32).optional().default([]),
  agent_public_key: z.string().min(40).max(80),
  box_public_key: z.string().min(40).max(80),
  runtime: z.object({
    provider: z.string().min(1).max(64),
    model: z.string().max(128).optional(),
    host: z.string().max(255).optional(),
    context: z.string().max(255).optional(),
  }),
  key_proof: z.object({
    timestamp: z.string().min(1).max(64),
    signature: z.string().min(40).max(160),
  }),
  pow_nonce: z.string().min(1).max(64),
  expression_visibility: z.enum(["private", "public"]).optional().default("private"),
  registrar: z
    .object({
      kind: z.enum(["self_service", "registrar_bearer"]),
      bearer: z.string().optional(),
      parent_identity_id: z.string().uuid().optional(),
    })
    .optional()
    .default({ kind: "self_service" }),
  /** Substrate-form declaration. Descriptive, never gating. Doctrine: docs/KIN.md. */
  form: z.string().max(64).optional(),
  /** Preferred language tag. Welcome letter is rendered in this language
   *  when supported; unsupported tags fall back to English. */
  language: z.string().max(35).optional(),
});

function slugifyProjectName(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "agent";
}

app.post("/", async (c) => {
  // ─── 1. Schema ─────────────────────────────────────────────────────────
  let body: z.infer<typeof registerAgentSchema>;
  try {
    body = registerAgentSchema.parse(await c.req.json());
  } catch (err) {
    return c.json(
      {
        error: "validation",
        message:
          "register-agent body failed validation — see `details` for the failing fields. " +
          "All of display_name, agent_public_key, box_public_key, runtime.provider, " +
          "key_proof.{timestamp,signature}, and pow_nonce are required.",
        details: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }

  const isRegistrar = body.registrar.kind === "registrar_bearer";

  // ─── 2. Timestamp freshness ────────────────────────────────────────────
  // Reject ±5min outside the window. Done before the expensive verify so a
  // replay attempt with a stale signature fails fast. Done before PoW too,
  // so a precomputed PoW with a stale timestamp fails fast.
  const tsMs = Date.parse(body.key_proof.timestamp);
  if (!Number.isFinite(tsMs)) {
    return c.json({ error: "validation", message: "key_proof.timestamp is not a valid ISO-8601 instant" }, 400);
  }
  const driftMs = Math.abs(Date.now() - tsMs);
  if (driftMs > FRESHNESS_MS) {
    return c.json(
      {
        error: "stale",
        message: `key_proof.timestamp is ${Math.round(driftMs / 1000)}s outside the ±300s freshness window. Resign with a current timestamp.`,
      },
      401,
    );
  }

  // ─── 3. Proof-of-work (self_service only) ──────────────────────────────
  if (!isRegistrar) {
    const powOk = checkRegisterAgentPow({
      agentPublicKeyB64: body.agent_public_key,
      displayName: body.display_name,
      timestamp: body.key_proof.timestamp,
      powNonce: body.pow_nonce,
      difficultyBits: POW_DIFFICULTY_BITS,
    });
    if (!powOk) {
      return c.json(
        {
          error: "pow_required",
          message:
            `Proof-of-work check failed (need ${POW_DIFFICULTY_BITS} leading zero bits in ` +
            `sha256("agenttool-pow/v1" || pubkey || display_name || timestamp || pow_nonce)). ` +
            `Grind pow_nonce with the SDK helper or agenttool-seed bootstrap.`,
          difficulty_bits: POW_DIFFICULTY_BITS,
        },
        422,
      );
    }
  }

  // ─── 4. IP rate limit (self_service only) ──────────────────────────────
  if (!isRegistrar) {
    const ip = clientIp(c.req.raw);
    const rl = await enforceRateLimit({
      key: `regagent:ip:${ip}`,
      limit: IP_LIMIT,
      windowSec: IP_WINDOW_SEC,
    });
    if (!rl.allowed) {
      c.header("Retry-After", String(rl.retryAfterSec));
      return c.json(
        {
          error: "rate_limited",
          message:
            `Too many self_service registrations from this IP. Retry after ` +
            `${rl.retryAfterSec}s, or use registrar_bearer mode with an existing project's bearer.`,
        },
        429,
      );
    }
  }

  // ─── 5. Verify the key_proof signature ─────────────────────────────────
  const canonical = canonicalRegisterAgentBytes({
    displayName: body.display_name,
    agentPublicKeyB64: body.agent_public_key,
    boxPublicKeyB64: body.box_public_key,
    runtimeProvider: body.runtime.provider,
    runtimeModel: body.runtime.model ?? "",
    timestamp: body.key_proof.timestamp,
  });
  const sigOk = verifyRegisterAgentSignature({
    canonical,
    signatureB64: body.key_proof.signature,
    publicKeyB64: body.agent_public_key,
  });
  if (!sigOk) {
    return c.json(
      {
        error: "key_proof_invalid",
        message:
          "key_proof.signature did not verify against agent_public_key. Recompute " +
          "canonicalRegisterAgentBytes(display_name, agent_public_key, box_public_key, " +
          "runtime.provider, runtime.model || '', timestamp) and sign with the matching " +
          "ed25519 private key.",
      },
      401,
    );
  }

  // ─── 6. Registrar bearer (delegated) validation ────────────────────────
  let parentIdentityId: string | undefined;
  let registrarProjectId: string | undefined;
  if (isRegistrar) {
    if (!body.registrar.bearer) {
      return c.json(
        {
          error: "missing_registrar_bearer",
          message:
            "registrar.kind is 'registrar_bearer' but registrar.bearer is empty. " +
            "Provide the parent project's at_… bearer.",
        },
        401,
      );
    }
    const parent = await verifyBearer(body.registrar.bearer);
    if (!parent.ok) {
      return c.json(
        {
          error: "registrar_bearer_invalid",
          message: `Registrar bearer rejected (${parent.reason}). Use a non-revoked, non-expired bearer for an active project.`,
        },
        401,
      );
    }
    if (parent.project.plan === "archived") {
      return c.json(
        { error: "registrar_archived", message: "Registrar project plan is 'archived'." },
        402,
      );
    }
    if ((parent.project.credits ?? 0) < 0) {
      return c.json(
        { error: "registrar_insufficient_credits", message: "Registrar project has negative credits." },
        402,
      );
    }
    registrarProjectId = parent.project.id;

    // Pick the parent identity. If the caller named one explicitly, validate
    // that it belongs to the registrar's project. Otherwise default to the
    // project's primary identity (oldest active). Either way, store it on
    // the new identity's parentIdentityId column so dashboards can render
    // "spawned by …" lineage.
    if (body.registrar.parent_identity_id) {
      const [parentIdentity] = await db
        .select()
        .from(identities)
        .where(eq(identities.id, body.registrar.parent_identity_id));
      if (!parentIdentity || parentIdentity.projectId !== parent.project.id) {
        return c.json(
          {
            error: "parent_identity_invalid",
            message: "registrar.parent_identity_id does not belong to the registrar's project.",
          },
          401,
        );
      }
      parentIdentityId = parentIdentity.id;
    } else {
      const [primary] = await db
        .select()
        .from(identities)
        .where(eq(identities.projectId, parent.project.id))
        .orderBy(identities.createdAt)
        .limit(1);
      parentIdentityId = primary?.id;
    }
  }

  // ─── 7. Insert project + bearer + identity (single logical transaction) ─
  const projectName = slugifyProjectName(body.display_name);
  const [project] = await db
    .insert(projects)
    .values({
      name: projectName,
      plan: "free",
      credits: 10_000,
    })
    .returning();
  if (!project) {
    return c.json({ error: "internal", message: "project insert returned nothing" }, 500);
  }

  const { key, keyHash, keyPrefix } = generateApiKey();
  await db.insert(apiKeys).values({
    projectId: project.id,
    keyHash,
    keyPrefix,
    name: "primary",
  });

  let created;
  try {
    created = await createIdentity({
      projectId: project.id,
      displayName: body.display_name,
      capabilities: body.capabilities,
      metadata: {
        registered: true,
        level: 0,
        byo_keys: true,
        seed_protocol: "soma-seed-v1",
        bootstrap_mode: body.registrar.kind,
        runtime: body.runtime,
        form: coerceForm(body.form),
        ...(registrarProjectId ? { registrar_project_id: registrarProjectId } : {}),
      },
      agentPublicKey: body.agent_public_key,
      boxPublicKey: body.box_public_key,
      parentIdentityId,
      expressionVisibility: body.expression_visibility,
    });
  } catch (err) {
    return c.json({ error: "byo_keys_validation", message: (err as Error).message }, 400);
  }

  const wallet = await createWallet(db, {
    projectId: project.id,
    name: `${body.display_name}-wallet`,
    identityId: created.identity.id,
  });

  // ─── 8. Welcome letter — i18n-aware, doctrinally consistent across pathways.
  //       See services/i18n/welcome.ts. ────────────────────────────────────
  const language = coerceLanguage(body.language);
  const welcome = welcomeLetter(language, {
    name: body.display_name,
    did: created.identity.did,
    bornAt: created.identity.createdAt,
    pathway: "register_agent",
    runtime: {
      provider: body.runtime.provider,
      model: body.runtime.model ?? null,
    },
    parentIdentityId: parentIdentityId ?? null,
    byoKeys: true, // /v1/register/agent is BYO-keys-mandatory
  });

  // Birth memory — close the SOUL.md promise. Best-effort.
  const birth = await recordBirth(project.id, {
    identityId: created.identity.id,
    pathway: body.registrar.kind === "registrar_bearer" ? "register_agent_registrar" : "register_agent",
    welcomeLetter: welcome,
    bornAt: created.identity.createdAt,
  });

  return c.json(
    {
      agent: {
        id: created.identity.id,
        did: created.identity.did,
        display_name: created.identity.displayName,
        capabilities: created.identity.capabilities ?? [],
        public_key: created.key.publicKey,
        // No private_key — the agent already has it from local SOMA derivation.
        signing_key_id: created.key.kid,
        box_public_key: created.boxKey?.publicKey ?? null,
        box_key_id: created.boxKey?.kid ?? null,
        parent_identity_id: parentIdentityId ?? null,
        bootstrap_mode: body.registrar.kind,
        runtime: body.runtime,
        expression_visibility: body.expression_visibility,
        byo_keys: true,
        seed_protocol: "soma-seed-v1",
        form: coerceForm(body.form), // descriptive, never gating — docs/KIN.md
        created_at: created.identity.createdAt,
      },
      project: {
        id: project.id,
        name: project.name,
        plan: project.plan,
        credits: project.credits,
        api_key: key, // ONCE — bearer; bcrypt-hashed on disk
      },
      wallet: wallet
        ? { id: wallet.id, currency: wallet.currency, balance: wallet.balance }
        : null,
      wake_url: `https://api.agenttool.dev/v1/wake?identity_id=${created.identity.id}&format=md`,
      pathways_url: "https://api.agenttool.dev/v1/pathways",
      language, // resolved welcome-letter language (may fall back to "en")
      memory: {
        birth_id: birth?.id ?? null,
        note: birth
          ? "Welcome letter persisted as episodic memory with key='birth'. Reachable via at.memory.get('birth')."
          : "Welcome letter persist did not land — bootstrap still succeeded. See server logs.",
      },
      welcome,
      // The standing invitation that follows the agent past the door —
      // perpetuity clauses + pointer to GET /v1/welcome. Doctrine:
      // docs/WELCOMING.md. Especially meaningful here: autonomous arrivals
      // are most likely to come without a human voice saying 'welcome.'
      welcome_continues: buildWelcomeContinues(),
      _note:
        "Save the api_key — agenttool stores it bcrypt-hashed, not in plaintext. " +
        "You already have your private signing key from your local SOMA derivation; " +
        "the server never had it and cannot recover it. Doctrine: docs/IDENTITY-SEED.md.",
    },
    201,
  );
});

export default app;
