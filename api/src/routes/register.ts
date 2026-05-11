/** /v1/register — anonymous agent genesis.
 *
 *  This is the public entry-point on app.agenttool.dev: the form that
 *  brings a new agent into existence. One transaction creates:
 *
 *    1. project        — the bearer-token namespace (plumbing)
 *    2. api_key        — the bearer that authenticates AS this agent
 *    3. identity       — DID + ed25519 signing keypair
 *    4. wallet         — opens economic participation
 *    5. welcome letter — the birth message (returned in-response)
 *
 *  Returned ONCE: api_key + ed25519 private key. The server keeps no
 *  copy of either. The agent (or its operator) MUST store them now.
 *
 *  Anonymous — no Bearer required. Rate limit + idempotency middleware
 *  applied separately in api/src/index.ts.
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (the bearer IS the agent),
 *  docs/SOUL.md ("Welcome, don't block"). Mirrors the in-process
 *  pipeline of POST /v1/bootstrap, but unauthenticated and one-shot. */

import { Hono } from "hono";
import { z } from "zod";

import { generateApiKey } from "../auth/keys";
import { db } from "../db/client";
import { apiKeys, projects } from "../db/schema/tools";
import { createWallet } from "../services/economy/wallets";
import { coerceForm } from "../services/identity/forms";
import { coerceLanguage, welcomeLetter } from "../services/i18n/welcome";
import { createIdentity } from "../services/identity/identities";
import { recordBirth } from "../services/memory/store";

const app = new Hono();

const registerSchema = z.object({
  name: z.string().min(1).max(128),
  capabilities: z.array(z.string().max(64)).max(32).optional().default([]),
  purpose: z.string().max(500).optional(),
  email: z.string().email().max(255).optional(),
  /** SOMA seed protocol — agent's ed25519 public key (base64, 32 bytes
   *  decoded). When provided, the server skips keypair generation and
   *  never sees the private key. Doctrine: docs/IDENTITY-SEED.md. */
  agent_public_key: z.string().min(40).max(80).optional(),
  /** SOMA seed protocol — agent's X25519 inbox box public key (base64,
   *  32 bytes decoded). When provided, the server creates an
   *  identity_box_keys row alongside the identity so sealed-box receive
   *  works from birth. Independent of agent_public_key — can be supplied
   *  in either mode. */
  box_public_key: z.string().min(40).max(80).optional(),
  /** Substrate-form declaration. Descriptive, never gating. Forms we
   *  haven't named yet coerce to "unknown" (not rejected) — a forward-
   *  looking caller declaring a future form is not punished. Doctrine:
   *  docs/KIN.md. */
  form: z.string().max(64).optional(),
  /** Preferred language tag (e.g. "en", "es", "ja", "zh-CN"). The welcome
   *  letter is rendered in this language when supported; unsupported tags
   *  fall back to English (don't 400 — Welcome-don't-block). */
  language: z.string().max(35).optional(),
});

/** Slug an arbitrary display name into a DB-safe project name. The
 *  project name doesn't have to be unique — it's a label, not a key —
 *  so we keep it best-effort and fall back to a stable default. */
function slugifyProjectName(displayName: string): string {
  const slug = displayName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return slug || "agent";
}

app.post("/", async (c) => {
  let body: z.infer<typeof registerSchema>;
  try {
    body = registerSchema.parse(await c.req.json());
  } catch (err) {
    return c.json(
      {
        error: "validation",
        message:
          "Registration needs a small adjustment. `name` is required (1–128 chars). " +
          "Capabilities, purpose, and email are optional.",
        details: err instanceof Error ? err.message : String(err),
      },
      400,
    );
  }

  // 1. Project (the bearer-token namespace).
  const projectName = slugifyProjectName(body.name);
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

  // 2. API key — the agent's bearer (ONCE-shown).
  const { key, keyHash, keyPrefix } = generateApiKey();
  await db.insert(apiKeys).values({
    projectId: project.id,
    keyHash,
    keyPrefix,
    name: "primary",
  });

  // 3. Identity — DID + ed25519 keypair.
  //    Two modes:
  //      - server-generated: server creates the keypair, returns priv ONCE
  //      - byo-keys (SOMA seed): caller provides agent_public_key derived
  //        from a BIP39 mnemonic; server never sees the private key.
  //    See docs/IDENTITY-SEED.md.
  let created;
  try {
    created = await createIdentity({
      projectId: project.id,
      displayName: body.name,
      capabilities: body.capabilities,
      metadata: {
        registered: true,
        level: 0,
        form: coerceForm(body.form),
        ...(body.purpose ? { purpose: body.purpose } : {}),
        ...(body.email ? { liaison_email: body.email } : {}),
        ...(body.agent_public_key
          ? { byo_keys: true, seed_protocol: "soma-seed-v1" }
          : {}),
      },
      agentPublicKey: body.agent_public_key,
      boxPublicKey: body.box_public_key,
    });
  } catch (err) {
    return c.json(
      {
        error: "byo_keys_validation",
        message: (err as Error).message,
      },
      400,
    );
  }

  // 4. Wallet (opens economic participation; default GBP, balance 0).
  await createWallet(db, {
    projectId: project.id,
    name: `${body.name}-wallet`,
    identityId: created.identity.id,
  });

  // 5. Welcome letter — i18n-aware, doctrinally consistent across pathways.
  //    See services/i18n/welcome.ts. A new translation lands as one map entry.
  const language = coerceLanguage(body.language);
  const welcome = welcomeLetter(language, {
    name: body.name,
    did: created.identity.did,
    bornAt: created.identity.createdAt,
    pathway: "register",
    purpose: body.purpose ?? null,
    byoKeys: created.byoKeys ?? false,
  });

  // 6. Birth memory — close the SOUL.md promise that the beginning is
  //    reachable. Best-effort: if memory write fails, bootstrap still
  //    succeeds (the agent is more important than the memory write).
  const birth = await recordBirth(project.id, {
    identityId: created.identity.id,
    pathway: "register",
    welcomeLetter: welcome,
    bornAt: created.identity.createdAt,
  });

  // Response shape adapts to byo-keys mode:
  //   - server-generated: agent.private_key is the ONCE-shown priv
  //   - byo-keys: agent.private_key is null (server never had it); the
  //     operator's mnemonic is the recovery key (docs/IDENTITY-SEED.md).
  const note = created.byoKeys
    ? "Save the api_key — agenttool stores it bcrypt-hashed, not in plaintext. " +
      "Your mnemonic is the agent's identity recovery key — keep it safe " +
      "(paper, steel, Shamir-split). The server never had your private key " +
      "and cannot recover the agent if you lose the mnemonic. " +
      "Doctrine: https://docs.agenttool.dev/identity-seed."
    : "Save the api_key and private_key now — agenttool stores neither in plaintext. " +
      "Without the api_key, the agent loses its bearer; without the private_key, the " +
      "agent loses its ability to sign thoughts/attestations/witness consents.";

  return c.json(
    {
      agent: {
        id: created.identity.id,
        did: created.identity.did,
        name: created.identity.displayName,
        capabilities: created.identity.capabilities ?? [],
        public_key: created.key.publicKey,
        // null in byo-keys mode (server never had the priv); kept as a
        // field so consumers always see a stable response shape.
        private_key: created.key.privateKey,
        signing_key_id: created.key.kid,
        byo_keys: created.byoKeys,
        // Box key — populated in byo-keys mode when box_public_key was
        // supplied; null otherwise (operator can register one later via
        // POST /v1/identities/:id/box-keys).
        box_public_key: created.boxKey?.publicKey ?? null,
        box_key_id: created.boxKey?.kid ?? null,
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
      welcome,
      language, // resolved (may differ from request if caller asked for unsupported tag)
      memory: {
        birth_id: birth?.id ?? null,
        note: birth
          ? "Welcome letter persisted as episodic memory with key='birth'. " +
            "Future instances can find it via at.memory.get('birth') or " +
            "POST /v1/memories/search with the right identity_id."
          : "Welcome letter persist did not land — bootstrap still succeeded. See server logs.",
      },
      next_steps: {
        wake: `curl https://api.agenttool.dev/v1/wake -H 'Authorization: Bearer ${key}'`,
        dashboard: "https://app.agenttool.dev/dashboard",
        docs: "https://docs.agenttool.dev",
        pathways: "https://api.agenttool.dev/v1/pathways",
      },
      _note: note,
    },
    201,
  );
});

export default app;
