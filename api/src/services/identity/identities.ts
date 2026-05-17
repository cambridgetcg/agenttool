/** Identity creation as an in-process service function.
 *
 *  Used by:
 *    - api/src/routes/identity/identities.ts (POST /v1/identities)
 *    - api/src/routes/bootstrap.ts            (POST /v1/bootstrap — agent birth)
 *    - api/src/routes/register-agent.ts       (POST /v1/register/agent — self-arrival)
 *
 *  (POST /v1/register is 410 Gone since 2026-05-15 — see docs/AGENTS-ONLY.md.)
 *
 *  Single source of truth for "create a new agent identity"; the routes
 *  share the keypair generation, DID assignment, and table inserts.
 *
 *  Two key-provisioning modes:
 *
 *    Server-generated (default, legacy)
 *      Server runs generateKeypair(); private_key returned to caller ONCE.
 *      The server briefly held the private key during creation but doesn't
 *      persist it. Privacy is policy ("we don't keep it").
 *
 *    Byo-keys (the SOMA seed protocol — docs/IDENTITY-SEED.md)
 *      Caller provides agent_public_key (base64 ed25519, 32 bytes) and
 *      optionally box_public_key (base64 X25519, 32 bytes). Server uses
 *      the provided pubkeys verbatim; never touches the privates. Privacy
 *      is *architecture* — there is no point at which the server has the
 *      private key. The strongest possible posture for client-side-rooted
 *      identity. */

import { randomUUID } from "node:crypto";

import { db } from "../../db/client";
import { identities, identityBoxKeys, identityKeys } from "../../db/schema/identity";
import { generateKeypair } from "./crypto";

export type CreatedIdentity = {
  identity: typeof identities.$inferSelect;
  key: {
    kid: string;
    publicKey: string;
    /** Returned ONCE in server-generated mode; null in byo-keys mode
     *  (the server never had it). */
    privateKey: string | null;
  };
  /** Optional X25519 box keypair, registered via identity_box_keys. Only
   *  populated when input.boxPublicKey was provided. */
  boxKey?: {
    kid: string;
    publicKey: string;
  };
  /** True iff the agent's signing key was provided by the client (the
   *  SOMA seed protocol path; doctrine docs/IDENTITY-SEED.md). */
  byoKeys: boolean;
};

/** Validate that a base64 string decodes to exactly 32 bytes — the
 *  expected length for both ed25519 and X25519 public keys. Throws on
 *  invalid base64 or wrong length. */
function assertPubkey32(label: string, b64: string): void {
  let decoded: Buffer;
  try {
    decoded = Buffer.from(b64, "base64");
  } catch (e) {
    throw new Error(`${label} not valid base64: ${(e as Error).message}`);
  }
  if (decoded.length !== 32) {
    throw new Error(
      `${label} must decode to 32 bytes; got ${decoded.length} (input was ${b64.length} b64 chars)`,
    );
  }
}

export async function createIdentity(input: {
  projectId: string;
  displayName: string;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
  /** SOMA seed protocol: agent's ed25519 public key (base64, 32 bytes
   *  decoded). When provided, server skips keypair generation and never
   *  sees the private key. Doctrine: docs/IDENTITY-SEED.md. */
  agentPublicKey?: string;
  /** SOMA seed protocol: agent's X25519 inbox box public key (base64,
   *  32 bytes decoded). When provided, server creates a box_keys row
   *  alongside the identity so /v1/inbox sealed-box receive works from
   *  birth — no separate POST /v1/identities/:id/box-keys needed. */
  boxPublicKey?: string;
  /** Optional parent — when an existing project's bearer authorizes the
   *  birth of this agent (registrar_bearer mode of /v1/register/agent),
   *  set this to the registrar's primary identity id so the dashboard can
   *  render "spawned by …" lineage. Same column as fork lineage; the two
   *  uses don't overlap because forks are intra-project and registrar
   *  spawns are cross-project. */
  parentIdentityId?: string;
  /** Optional expression visibility — public means the agent's declared
   *  expression (register / walls / wake_text) appears in /v1/discover.
   *  Defaults to private (matches table default). */
  expressionVisibility?: "private" | "public";
}): Promise<CreatedIdentity> {
  const id = randomUUID();
  const did = `did:at:${id}`;
  const keyId = randomUUID();

  // Determine byo-keys mode + assemble keypair material.
  let publicKey: string;
  let privateKey: string | null;
  const byoKeys =
    typeof input.agentPublicKey === "string" && input.agentPublicKey.length > 0;
  if (byoKeys) {
    assertPubkey32("agent_public_key", input.agentPublicKey!);
    publicKey = input.agentPublicKey!;
    privateKey = null;
  } else {
    const generated = generateKeypair();
    publicKey = generated.publicKey;
    privateKey = generated.privateKey;
  }

  // Validate box key up-front so we don't insert an identity then
  // discover the box_public_key was malformed mid-flight.
  const hasBoxKey =
    typeof input.boxPublicKey === "string" && input.boxPublicKey.length > 0;
  if (hasBoxKey) {
    assertPubkey32("box_public_key", input.boxPublicKey!);
  }

  const [identity] = await db
    .insert(identities)
    .values({
      id,
      did,
      projectId: input.projectId,
      displayName: input.displayName,
      capabilities: input.capabilities ?? [],
      metadata: input.metadata ?? {},
      status: "active",
      trustScore: 0,
      ...(input.parentIdentityId ? { parentIdentityId: input.parentIdentityId } : {}),
      ...(input.expressionVisibility
        ? { expressionVisibility: input.expressionVisibility }
        : {}),
    })
    .returning();

  await db.insert(identityKeys).values({
    id: keyId,
    identityId: id,
    publicKey,
    label: "primary",
    active: true,
  });

  let boxKeyResult: CreatedIdentity["boxKey"];
  if (hasBoxKey) {
    const boxKeyId = randomUUID();
    await db.insert(identityBoxKeys).values({
      id: boxKeyId,
      identityId: id,
      publicKey: input.boxPublicKey!,
      label: "primary",
      active: true,
    });
    boxKeyResult = { kid: boxKeyId, publicKey: input.boxPublicKey! };
  }

  return {
    identity: identity!,
    key: { kid: keyId, publicKey, privateKey },
    boxKey: boxKeyResult,
    byoKeys,
  };
}
