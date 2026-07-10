/** Level-1 sponsorship-staked sovereignty — orchestrates the four operations
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
 *  Trust-score recompute runs OUTSIDE the txn (idempotent, opens its own
 *  connection). Partial failures rollback automatically — there is no
 *  half-elevated state.
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Levels 0, 1) · docs/SOUL.md Principle 3
 *  ("Guide, don't punish") · docs/PATHWAYS.md (the contract) ·
 *  docs/superpowers/specs/2026-05-13-bootstrap-elevate-orchestrator.md
 *  (the design).
 */

import { and, eq, isNull } from "drizzle-orm";

import { db } from "../../db/client";
import { wallets, transactions } from "../../db/schema/economy";
import {
  attestations,
  identities,
  identityKeys,
} from "../../db/schema/identity";
import { vaultSecrets, vaultVersions } from "../../db/schema/vault";
import { canonicalPayload, verify } from "../identity/crypto";
import { mutableIdentityPredicate } from "../identity/terminality";
import { updateTrustScore } from "../identity/trust";
import { encrypt } from "../vault/crypto";

export interface ElevateInput {
  agentId: string;
  /** Either sponsor's identity UUID OR sponsor's DID — at least one is
   *  required. Identity-by-DID is the ergonomic SDK path; identity-by-UUID
   *  is the explicit path. When both are supplied, UUID wins (it's narrower). */
  sponsorIdentityId?: string;
  sponsorDid?: string;
  /** Sponsor's key UUID. Optional — when omitted, we auto-pick the
   *  identity's latest active un-revoked key. Explicit `sponsor_kid`
   *  lets callers pin a specific key (e.g. for multi-key sponsors). */
  sponsorKid?: string;
  sponsorSignature: string;
  initialCredits?: number; // default 1000
  claim?: string; // default "sponsorship"
  evidence?: unknown;
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

const DEFAULT_INITIAL_CREDITS = 1000;
const DEFAULT_CLAIM = "sponsorship";

export async function elevateToLevel1(
  projectId: string,
  input: ElevateInput,
): Promise<ElevateResult> {
  const initialCredits = input.initialCredits ?? DEFAULT_INITIAL_CREDITS;
  const claim = input.claim ?? DEFAULT_CLAIM;

  if (initialCredits < 0 || initialCredits > 1_000_000) {
    throw new ElevateError("initial_credits_out_of_range", 400, {
      received: initialCredits,
      allowed: { min: 0, max: 1_000_000 },
    });
  }
  if (!input.sponsorIdentityId && !input.sponsorDid) {
    throw new ElevateError("sponsor_not_provided", 400, {
      hint: "Provide either sponsor_identity_id (UUID) or sponsor_did (string).",
    });
  }

  // Pre-flight: verify the sponsor signature before opening a transaction.
  // Signature failure is the most expensive thing to detect inside a txn
  // (it has the longest pre-existing read), and pre-checking it lets us
  // give a clean 403 before any locks are taken. Same canonical payload
  // shape /v1/attestations verifies — byte-identical wire format.

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

  // 2. Sponsor key — explicit kid OR auto-pick the latest active un-revoked
  //    key. Auto-pick is the SDK-friendly path: callers don't need to
  //    surface kid as a separate field.
  const keyWhere = input.sponsorKid
    ? and(
        eq(identityKeys.id, input.sponsorKid),
        eq(identityKeys.identityId, sponsor.id),
        eq(identityKeys.active, true),
        isNull(identityKeys.revokedAt),
      )
    : and(
        eq(identityKeys.identityId, sponsor.id),
        eq(identityKeys.active, true),
        isNull(identityKeys.revokedAt),
      );
  const [sponsorKey] = await db
    .select()
    .from(identityKeys)
    .where(keyWhere)
    .orderBy(identityKeys.createdAt)
    .limit(1);
  if (!sponsorKey) {
    throw new ElevateError("sponsor_key_not_found", 403);
  }

  // 3. Signature verifies against canonical payload bytes.
  const payload = canonicalPayload({
    subject_id: input.agentId,
    attester_id: sponsor.id,
    claim,
    evidence: input.evidence,
  });
  if (!verify(payload, input.sponsorSignature, sponsorKey.publicKey)) {
    throw new ElevateError("signature_invalid", 403);
  }

  // Transactional core. Five writes; any throw rolls everything back.
  const result = await db.transaction(async (tx) => {
    // a. Lock the agent row FOR UPDATE — prevents concurrent elevate.
    const [agent] = await tx
      .select()
      .from(identities)
      .where(
        and(
          eq(identities.id, input.agentId),
          eq(identities.projectId, projectId),
        ),
      )
      .for("update")
      .limit(1);

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

    // b. Insert attestation.
    const [attestation] = await tx
      .insert(attestations)
      .values({
        subjectId: input.agentId,
        attesterId: sponsor.id,
        claim,
        evidence: input.evidence ?? null,
        signature: input.sponsorSignature,
      })
      .returning();

    // c. Find + fund the agent's wallet.
    const [wallet] = await tx
      .select()
      .from(wallets)
      .where(eq(wallets.identityId, input.agentId))
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
        description: `Level 1 elevation seed credits (sponsor ${sponsor.did})`,
        metadata: {
          elevation: true,
          sponsor_identity_id: sponsor.id,
          sponsor_did: sponsor.did,
          attestation_id: attestation!.id,
        },
      });
    }

    // d. Open the vault namespace — empty sentinel under `<agent_id>:config`.
    //    The agent itself populates real config later via PUT /v1/vault/:name.
    const sentinel = encrypt("", projectId);
    const namespaceName = `${input.agentId}:config`;
    const [vaultSecret] = await tx
      .insert(vaultSecrets)
      .values({
        projectId,
        name: namespaceName,
        description: "Level 1 elevation — sentinel namespace opened.",
        currentVersion: 1,
        agentIds: [input.agentId],
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

    // e. Patch agent metadata: level=1 + elevation provenance.
    const elevatedAt = new Date();
    const newMetadata = {
      ...(agent.metadata ?? {}),
      level: 1,
      elevated_at: elevatedAt.toISOString(),
      sponsor_did: sponsor.did,
      sponsor_identity_id: sponsor.id,
    };
    const [elevatedAgent] = await tx
      .update(identities)
      .set({ metadata: newMetadata })
      .where(mutableIdentityPredicate(input.agentId))
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
      sponsor,
    };
  });

  // Post-commit, post-transaction. Trust score recompute is idempotent and
  // opens its own connection — safe to call outside the txn.
  const newTrustScore = await updateTrustScore(input.agentId);

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
