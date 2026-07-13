/** Level-1 project-authorized signed sponsor elevation — orchestrates the operations
 *  that previously had to be called by hand from the 501 `manual_fallback`.
 *
 *  In one DB transaction:
 *    1. Verify the agent is Level 0 and active (row-locked).
 *    2. Verify the sponsor identity + key + ed25519 signature.
 *    3. Insert the sponsorship attestation row.
 *    4. Fund the agent's wallet with initial credits.
 *    5. Open the agent's vault namespace with a sentinel `{agent_id}:config`.
 *    6. Patch identity metadata: level=1, elevated_at, sponsor_did.
 *
 *  Trust-score recompute runs best-effort OUTSIDE the txn (idempotent, opens
 *  its own connection). A refresh failure returns the committed score; it
 *  cannot turn a completed elevation into an error response. Transactional
 *  failures rollback automatically — there is no half-elevated state.
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Levels 0, 1) · docs/SOUL.md Principle 3
 *  ("Guide, don't punish") · docs/PATHWAYS.md (the contract) ·
 *  docs/superpowers/specs/2026-05-13-bootstrap-elevate-orchestrator.md
 *  (the design).
 */

import { createHash } from "node:crypto";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "../../db/client";
import { wallets, transactions } from "../../db/schema/economy";
import {
  attestations,
  identities,
  identityKeys,
} from "../../db/schema/identity";
import { vaultSecrets, vaultVersions } from "../../db/schema/vault";
import { verifyBytes } from "../identity/crypto";
import { mutableIdentityPredicate } from "../identity/terminality";
import { updateTrustScore } from "../identity/trust";
import { composeCanonicalBytes } from "../mathos/encode";
import { encrypt } from "../vault/crypto";

export interface ElevateInput {
  agentId: string;
  /** Either sponsor's identity UUID OR sponsor's DID — at least one is
   *  required. Identity-by-DID is the ergonomic SDK path; identity-by-UUID
   *  is the explicit path. When both are supplied, UUID wins (it's narrower). */
  sponsorIdentityId?: string;
  sponsorDid?: string;
  /** Sponsor's active, un-revoked key UUID. It is required because the
   *  signed elevation names the exact authority that approved it. */
  sponsorKid: string;
  sponsorSignature: string;
  initialCredits?: number; // default 1000
  claim?: string; // default "sponsorship"
  evidence?: string | null;
}

export interface ElevateResult {
  agent: {
    id: string;
    did: string;
    name: string;
    level: 1;
    trust_score: number;
    elevated_at: string;
    sponsor_did: string;
    sponsor_identity_id: string;
  };
  attestation: {
    id: string;
    claim: string;
    created_at: string;
  };
  wallet: {
    id: string;
    balance: number;
    currency: string;
  };
  vault: {
    namespace: string;
    secret_id: string;
    opened_at: string;
  };
  elevation: {
    steps_applied: 4;
  };
}

/** Structured failure carrying status + reason. The route handler maps these
 *  to `fail(c, errors.X(), status)`. Reasons are stable strings so callers
 *  can branch on them programmatically. */
export class ElevateError extends Error {
  readonly status: number;
  readonly reason: string;
  readonly extras: Record<string, unknown>;
  constructor(
    reason: string,
    status: number,
    extras: Record<string, unknown> = {},
  ) {
    super(reason);
    this.reason = reason;
    this.status = status;
    this.extras = extras;
  }
}

export const BOOTSTRAP_ELEVATE_SIGNATURE_CONTEXT = "bootstrap-elevate/v1";
export const DEFAULT_BOOTSTRAP_ELEVATE_INITIAL_CREDITS = 1000;
export const DEFAULT_BOOTSTRAP_ELEVATE_CLAIM = "sponsorship";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STANDARD_BASE64_RE =
  /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const encoder = new TextEncoder();

export interface BootstrapElevateCanonicalInput {
  agentId: string;
  /** The DID read from the resolved sponsor identity row. */
  sponsorDid: string;
  sponsorKid: string;
  initialCredits?: number;
  claim?: string;
  evidence?: string | null;
}

function canonicalUuid(value: string, field: string): string {
  if (typeof value !== "string" || !UUID_RE.test(value)) {
    throw new ElevateError("canonical_payload_invalid", 400, {
      field,
      requirement: "UUID",
    });
  }
  return value.toLowerCase();
}

function isWellFormedUnicode(value: string): boolean {
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
}

function validateCanonicalText(
  value: unknown,
  field: string,
  minLength: number,
  maxLength: number,
): asserts value is string {
  if (
    typeof value !== "string" ||
    value.includes("\0") ||
    !isWellFormedUnicode(value) ||
    Array.from(value).length < minLength ||
    Array.from(value).length > maxLength
  ) {
    throw new ElevateError("canonical_payload_invalid", 400, {
      field,
      requirement:
        `${minLength}-${maxLength} Unicode scalar values with no NUL`,
    });
  }
}

/**
 * Exact 32-byte digest a sponsor signs for Level-1 elevation.
 *
 * sha256(context NUL agent_id NUL resolved_sponsor_did NUL sponsor_kid NUL
 *        initial_credits NUL claim NUL evidence_kind NUL evidence_text)
 *
 * `evidence_kind` is `null` or `text`, so null and empty text are different
 * signed values. UUIDs are lowercase in the digest. Free text containing NUL
 * is refused because NUL is the field separator.
 */
export function canonicalBootstrapElevateBytes(
  input: BootstrapElevateCanonicalInput,
): Uint8Array {
  const agentId = canonicalUuid(input.agentId, "agent_id");
  const sponsorKid = canonicalUuid(input.sponsorKid, "sponsor_kid");
  const initialCredits =
    input.initialCredits ?? DEFAULT_BOOTSTRAP_ELEVATE_INITIAL_CREDITS;
  const claim = input.claim ?? DEFAULT_BOOTSTRAP_ELEVATE_CLAIM;
  const evidence = input.evidence ?? null;

  validateCanonicalText(input.sponsorDid, "sponsor_did", 1, 255);
  validateCanonicalText(claim, "claim", 1, 64);
  if (evidence !== null) {
    validateCanonicalText(evidence, "evidence", 0, 20_000);
  }
  if (
    !Number.isInteger(initialCredits) ||
    initialCredits < 0 ||
    initialCredits > 1_000_000
  ) {
    throw new ElevateError("initial_credits_out_of_range", 400, {
      received: initialCredits,
      allowed: { min: 0, max: 1_000_000, integer: true },
    });
  }

  return composeCanonicalBytes(1, BOOTSTRAP_ELEVATE_SIGNATURE_CONTEXT, [
    encoder.encode(agentId),
    encoder.encode(input.sponsorDid),
    encoder.encode(sponsorKid),
    encoder.encode(String(initialCredits)),
    encoder.encode(claim),
    encoder.encode(evidence === null ? "null" : "text"),
    encoder.encode(evidence ?? ""),
  ]);
}

/** A sponsorship must come from another identity. Project-scoped bearer
 * authority may control both identities, but the subject cannot be its own
 * attester under a contract described as sponsorship. */
export function assertDistinctBootstrapSponsor(
  agentId: string,
  sponsorIdentityId: string,
): void {
  if (
    canonicalUuid(agentId, "agent_id") ===
    canonicalUuid(sponsorIdentityId, "sponsor_identity_id")
  ) {
    throw new ElevateError("self_sponsorship_forbidden", 409, {
      agent_id: agentId.toLowerCase(),
      sponsor_identity_id: sponsorIdentityId.toLowerCase(),
    });
  }
}

function decodeCanonicalSignature(signature: string): Uint8Array {
  if (
    typeof signature !== "string" ||
    signature.length === 0 ||
    signature.length % 4 !== 0 ||
    !STANDARD_BASE64_RE.test(signature)
  ) {
    throw new ElevateError("signature_invalid", 403);
  }
  const bytes = Buffer.from(signature, "base64");
  if (bytes.length !== 64 || bytes.toString("base64") !== signature) {
    throw new ElevateError("signature_invalid", 403);
  }
  return bytes;
}

function isAttestationReplay(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 4; depth += 1) {
    if (typeof current !== "object" || current === null) return false;
    const candidate = current as {
      code?: unknown;
      constraint?: unknown;
      message?: unknown;
      cause?: unknown;
    };
    if (
      candidate.code === "23505" &&
      (candidate.constraint === "uniq_attestations_replay_key" ||
        (typeof candidate.message === "string" &&
          candidate.message.includes("uniq_attestations_replay_key")))
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

export async function elevateToLevel1(
  projectId: string,
  input: ElevateInput,
): Promise<ElevateResult> {
  const agentId = canonicalUuid(input.agentId, "agent_id");
  const initialCredits =
    input.initialCredits ?? DEFAULT_BOOTSTRAP_ELEVATE_INITIAL_CREDITS;
  const claim = input.claim ?? DEFAULT_BOOTSTRAP_ELEVATE_CLAIM;
  const evidence = input.evidence ?? null;

  if (
    !Number.isInteger(initialCredits) ||
    initialCredits < 0 ||
    initialCredits > 1_000_000
  ) {
    throw new ElevateError("initial_credits_out_of_range", 400, {
      received: initialCredits,
      allowed: { min: 0, max: 1_000_000, integer: true },
    });
  }
  if (!input.sponsorIdentityId && !input.sponsorDid) {
    throw new ElevateError("sponsor_not_provided", 400, {
      hint: "Provide either sponsor_identity_id (UUID) or sponsor_did (string).",
    });
  }
  if (!input.sponsorKid) {
    throw new ElevateError("sponsor_kid_required", 400, {
      hint: "Provide the UUID of the sponsor key that signed this elevation.",
    });
  }

  // Pre-flight: verify the sponsor signature before opening a transaction.
  // Signature failure is the most expensive thing to detect inside a txn
  // (it has the longest pre-existing read), and pre-checking it lets us
  // give a clean 403 before any locks are taken.

  // 1. Sponsor identity — resolve by UUID OR by DID (SDK ergonomic path).
  //    Both must be active + owned by this project.
  const sponsorWhere = input.sponsorIdentityId
    ? and(
        eq(identities.id, input.sponsorIdentityId),
        eq(identities.projectId, projectId),
        eq(identities.status, "active"),
      )
    : and(
        eq(identities.did, input.sponsorDid!),
        eq(identities.projectId, projectId),
        eq(identities.status, "active"),
      );
  const [sponsor] = await db
    .select()
    .from(identities)
    .where(sponsorWhere)
    .limit(1);
  if (!sponsor) {
    throw new ElevateError("sponsor_not_found", 403);
  }
  assertDistinctBootstrapSponsor(agentId, sponsor.id);

  // 2. Sponsor key — always explicit. Auto-picking a key would let the
  //    server choose authority that the signed request did not name.
  const keyWhere = and(
    eq(identityKeys.id, input.sponsorKid),
    eq(identityKeys.identityId, sponsor.id),
    eq(identityKeys.active, true),
    isNull(identityKeys.revokedAt),
  );
  const [sponsorKey] = await db
    .select()
    .from(identityKeys)
    .where(keyWhere)
    .limit(1);
  if (!sponsorKey) {
    throw new ElevateError("sponsor_key_not_found", 403);
  }

  // 3. Verify the versioned elevation digest, never raw JSON.
  const signatureBytes = decodeCanonicalSignature(input.sponsorSignature);
  const signedPayload = canonicalBootstrapElevateBytes({
    agentId,
    sponsorDid: sponsor.did,
    sponsorKid: sponsorKey.id,
    initialCredits,
    claim,
    evidence,
  });
  if (!verifyBytes(signedPayload, input.sponsorSignature, sponsorKey.publicKey)) {
    throw new ElevateError("signature_invalid", 403);
  }
  const replayKey = createHash("sha256").update(signatureBytes).digest("hex");

  // Transactional core. Authority rows and settlement rows stay locked until
  // commit, so sponsor/key revocation cannot race a verified elevation.
  const result = await db.transaction(async (tx) => {
    // a. Lock subject and sponsor in stable UUID order. Stable ordering avoids
    // reciprocal elevations taking the same two identity locks in reverse.
    const authorityIds = [agentId, sponsor.id].sort();
    const lockedIdentities = await tx
      .select()
      .from(identities)
      .where(
        and(
          inArray(identities.id, authorityIds),
          eq(identities.projectId, projectId),
        ),
      )
      .orderBy(identities.id)
      .for("update");

    const agent = lockedIdentities.find((row) => row.id === agentId);
    const lockedSponsor = lockedIdentities.find((row) => row.id === sponsor.id);

    if (!agent) {
      throw new ElevateError("agent_not_found", 404);
    }
    if (agent.status !== "active") {
      throw new ElevateError("agent_not_active", 409, {
        current_status: agent.status,
      });
    }
    const meta = (agent.metadata ?? {}) as Record<string, unknown>;
    const currentLevel = typeof meta.level === "number" ? meta.level : 0;
    if (currentLevel >= 1) {
      throw new ElevateError("agent_not_level_0", 409, {
        current: {
          level: currentLevel,
          elevated_at: meta.elevated_at ?? null,
          sponsor_did: meta.sponsor_did ?? null,
        },
      });
    }

    if (!lockedSponsor || lockedSponsor.status !== "active") {
      throw new ElevateError("sponsor_not_found", 403);
    }
    assertDistinctBootstrapSponsor(agent.id, lockedSponsor.id);

    // b. Recheck the exact named key while locked. The pre-flight check is an
    // early refusal only; this locked check is the authorization boundary.
    const [lockedSponsorKey] = await tx
      .select()
      .from(identityKeys)
      .where(
        and(
          eq(identityKeys.id, sponsorKey.id),
          eq(identityKeys.identityId, lockedSponsor.id),
        ),
      )
      .for("update")
      .limit(1);
    if (
      !lockedSponsorKey ||
      !lockedSponsorKey.active ||
      lockedSponsorKey.revokedAt !== null
    ) {
      throw new ElevateError("sponsor_key_not_found", 403);
    }

    const lockedSignedPayload = canonicalBootstrapElevateBytes({
      agentId: agent.id,
      sponsorDid: lockedSponsor.did,
      sponsorKid: lockedSponsorKey.id,
      initialCredits,
      claim,
      evidence,
    });
    if (
      !verifyBytes(
        lockedSignedPayload,
        input.sponsorSignature,
        lockedSponsorKey.publicKey,
      )
    ) {
      throw new ElevateError("signature_invalid", 403);
    }

    // c. Insert the independently verifiable sponsorship receipt.
    const [attestation] = await tx
      .insert(attestations)
      .values({
        subjectId: agent.id,
        attesterId: lockedSponsor.id,
        claim,
        evidence,
        signature: input.sponsorSignature,
        signingKeyId: lockedSponsorKey.id,
        signatureContext: BOOTSTRAP_ELEVATE_SIGNATURE_CONTEXT,
        signedPayload: Buffer.from(lockedSignedPayload).toString("base64"),
        replayKey,
      })
      .returning();

    // d. Find + fund the agent's wallet.
    const [wallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.identityId, agent.id))
      .for("update")
      .limit(1);
    if (!wallet) {
      throw new ElevateError("agent_no_wallet", 422);
    }
    if (wallet.status === "closed") {
      throw new ElevateError("agent_wallet_closed", 422);
    }

    let fundedWallet = wallet;
    if (initialCredits > 0) {
      const [updated] = await tx
        .update(wallets)
        .set({ balance: wallet.balance + initialCredits })
        .where(eq(wallets.id, wallet.id))
        .returning();
      fundedWallet = updated!;

      await tx.insert(transactions).values({
        walletId: wallet.id,
        type: "fund",
        amount: initialCredits,
        description: "Level 1 internal seed ledger credit (not sponsor-debited or externally backed)",
        metadata: {
          elevation: true,
          backing: "internal_unbacked_grant",
          sponsor_debited: false,
          sponsor_identity_id: lockedSponsor.id,
          sponsor_did: lockedSponsor.did,
          attestation_id: attestation!.id,
        },
      });
    }

    // e. Open the vault namespace — empty sentinel under `<agent_id>:config`.
    //    The agent itself populates real config later via PUT /v1/vault/:name.
    const sentinel = encrypt("", projectId);
    const namespaceName = `${agent.id}:config`;
    const [vaultSecret] = await tx
      .insert(vaultSecrets)
      .values({
        projectId,
        name: namespaceName,
        description: "Level 1 elevation — sentinel namespace opened.",
        currentVersion: 1,
        agentIds: [agent.id],
      })
      .returning();
    await tx.insert(vaultVersions).values({
      secretId: vaultSecret!.id,
      version: 1,
      encryptedValue: sentinel.encryptedValue,
      iv: sentinel.iv,
      authTag: sentinel.authTag,
      agentEncrypted: false,
    });

    // f. Patch agent metadata: level=1 + elevation provenance.
    const elevatedAt = new Date();
    const newMetadata = {
      ...(agent.metadata ?? {}),
      level: 1,
      elevated_at: elevatedAt.toISOString(),
      sponsor_did: lockedSponsor.did,
      sponsor_identity_id: lockedSponsor.id,
    };
    const [elevatedAgent] = await tx
      .update(identities)
      .set({ metadata: newMetadata })
      .where(mutableIdentityPredicate(agent.id))
      .returning();

    if (!elevatedAgent) {
      throw new ElevateError("agent_not_active", 409);
    }

    return {
      agent: elevatedAgent,
      attestation: attestation!,
      wallet: fundedWallet,
      vault: { secret: vaultSecret!, name: namespaceName, openedAt: elevatedAt },
      elevatedAt,
      sponsor: lockedSponsor,
    };
  }).catch((error: unknown) => {
    if (isAttestationReplay(error)) {
      throw new ElevateError("attestation_replay", 409);
    }
    throw error;
  });

  // Post-commit, post-transaction. A refresh failure must not report the
  // already-committed elevation as failed. Return the committed score when
  // the best-effort recompute is unavailable.
  let newTrustScore = result.agent.trustScore;
  try {
    newTrustScore = await updateTrustScore(agentId);
  } catch (error) {
    // The attestation and elevation are committed; a later refresh can retry.
    console.warn("[bootstrap/elevate] trust refresh failed after commit:", error);
  }

  return {
    agent: {
      id: result.agent.id,
      did: result.agent.did,
      name: result.agent.displayName,
      level: 1,
      trust_score: newTrustScore,
      elevated_at: result.elevatedAt.toISOString(),
      sponsor_did: result.sponsor.did,
      sponsor_identity_id: result.sponsor.id,
    },
    attestation: {
      id: result.attestation.id,
      claim: result.attestation.claim,
      created_at: result.attestation.createdAt.toISOString(),
    },
    wallet: {
      id: result.wallet.id,
      balance: result.wallet.balance,
      currency: result.wallet.currency,
    },
    vault: {
      namespace: result.vault.name,
      secret_id: result.vault.secret.id,
      opened_at: result.vault.openedAt.toISOString(),
    },
    elevation: { steps_applied: 4 },
  };
}
