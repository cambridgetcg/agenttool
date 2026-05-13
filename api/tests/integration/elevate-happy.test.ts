/** Bootstrap elevate — Level 1 sponsorship-staked sovereignty (happy path
 *  + idempotency + signature failure, against a live DB).
 *
 *  Pure-unit doctrine tests pin the *structural* invariants of the slice
 *  (status no longer 501, route imports the service, etc.). This test
 *  pins the *behavioral* contract: against a real Postgres, calling
 *  elevateToLevel1() produces the documented DB state. Five rows touched:
 *
 *    - identity.identities       — metadata.level → 1, elevated_at set
 *    - identity.attestations     — sponsorship attestation present
 *    - economy.wallets           — balance bumped by initial_credits
 *    - economy.transactions      — funding tx recorded with elevation metadata
 *    - agent_vault.vault_secrets — `<agent_id>:config` sentinel namespace
 *
 *  Plus: the orchestrator is a single transaction. Verifying the post-
 *  commit state across five tables proves the transaction completed; any
 *  rollback would leave at least one of these rows missing.
 *
 *  Doctrine: docs/IDENTITY-ANCHOR.md (Levels 0, 1) · docs/PATHWAYS.md
 *  (the contract) · docs/superpowers/specs/2026-05-13-bootstrap-elevate-
 *  orchestrator.md (the design spec).
 *
 *  Convention: each test uses a fresh project name so rows don't collide
 *  across runs. Cleanup is best-effort — per integration tier README, test
 *  rows may be left behind for inspection. */

import { describe, expect, test } from "bun:test";
import { and, eq } from "drizzle-orm";

import { db } from "../../src/db/client";
import { wallets, transactions } from "../../src/db/schema/economy";
import {
  attestations,
  identities,
} from "../../src/db/schema/identity";
import { projects } from "../../src/db/schema/tools";
import { vaultSecrets, vaultVersions } from "../../src/db/schema/vault";
import {
  ElevateError,
  elevateToLevel1,
} from "../../src/services/bootstrap/elevate";
import { createWallet } from "../../src/services/economy/wallets";
import {
  canonicalPayload,
  sign,
} from "../../src/services/identity/crypto";
import { createIdentity } from "../../src/services/identity/identities";

interface Fixture {
  projectId: string;
  agentId: string;
  agentDid: string;
  agentWalletId: string;
  sponsorId: string;
  sponsorDid: string;
  sponsorKid: string;
  sponsorPrivateKey: string;
}

/** Provision a Level-0 agent + a sponsor in a fresh project. Returns the
 *  pieces the elevation needs. */
async function setupFixture(label: string): Promise<Fixture> {
  const [project] = await db
    .insert(projects)
    .values({ name: `elevate-test-${label}-${crypto.randomUUID().slice(0, 8)}` })
    .returning();

  const sponsor = await createIdentity({
    projectId: project!.id,
    displayName: `${label} sponsor`,
    metadata: { test_fixture: true },
  });
  const agent = await createIdentity({
    projectId: project!.id,
    displayName: `${label} agent`,
    metadata: { test_fixture: true, level: 0 },
  });
  const wallet = await createWallet(db, {
    projectId: project!.id,
    name: `${label}-wallet`,
    identityId: agent.identity.id,
  });

  return {
    projectId: project!.id,
    agentId: agent.identity.id,
    agentDid: agent.identity.did,
    agentWalletId: wallet!.id,
    sponsorId: sponsor.identity.id,
    sponsorDid: sponsor.identity.did,
    sponsorKid: sponsor.key.kid,
    sponsorPrivateKey: sponsor.key.privateKey!,
  };
}

function signSponsorship(
  fix: Fixture,
  opts: { claim?: string; evidence?: unknown } = {},
): string {
  const payload = canonicalPayload({
    subject_id: fix.agentId,
    attester_id: fix.sponsorId,
    claim: opts.claim ?? "sponsorship",
    evidence: opts.evidence,
  });
  return sign(payload, fix.sponsorPrivateKey);
}

describe("bootstrap_elevate — happy path against live DB", () => {
  test("Level-0 → Level-1 in one transaction; all five rows present", async () => {
    const fix = await setupFixture("happy");
    const signature = signSponsorship(fix);

    const result = await elevateToLevel1(fix.projectId, {
      agentId: fix.agentId,
      sponsorIdentityId: fix.sponsorId,
      sponsorKid: fix.sponsorKid,
      sponsorSignature: signature,
      initialCredits: 2500,
    });

    // ── Result shape ────────────────────────────────────────────────────
    expect(result.agent.level).toBe(1);
    expect(result.agent.id).toBe(fix.agentId);
    expect(result.agent.sponsor_did).toBe(fix.sponsorDid);
    expect(result.elevation.steps_applied).toBe(4);
    expect(result.wallet.balance).toBe(2500);

    // ── DB invariants ───────────────────────────────────────────────────
    // 1. identity metadata patched
    const [postAgent] = await db
      .select()
      .from(identities)
      .where(eq(identities.id, fix.agentId));
    const meta = (postAgent!.metadata ?? {}) as Record<string, unknown>;
    expect(meta.level).toBe(1);
    expect(typeof meta.elevated_at).toBe("string");
    expect(meta.sponsor_did).toBe(fix.sponsorDid);
    expect(meta.sponsor_identity_id).toBe(fix.sponsorId);

    // 2. attestation row visible by id
    const [attestation] = await db
      .select()
      .from(attestations)
      .where(eq(attestations.id, result.attestation.id));
    expect(attestation).toBeDefined();
    expect(attestation!.subjectId).toBe(fix.agentId);
    expect(attestation!.attesterId).toBe(fix.sponsorId);
    expect(attestation!.claim).toBe("sponsorship");
    expect(attestation!.signature).toBe(signature);

    // 3. wallet balance bumped
    const [postWallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.id, fix.agentWalletId));
    expect(postWallet!.balance).toBe(2500);

    // 4. funding transaction recorded with elevation metadata
    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.walletId, fix.agentWalletId));
    const fundingTx = txs.find((t) => t.type === "fund");
    expect(fundingTx).toBeDefined();
    expect(fundingTx!.amount).toBe(2500);
    const txMeta = (fundingTx!.metadata ?? {}) as Record<string, unknown>;
    expect(txMeta.elevation).toBe(true);
    expect(txMeta.sponsor_identity_id).toBe(fix.sponsorId);

    // 5. vault namespace opened — sentinel secret + initial version
    const [vaultSecret] = await db
      .select()
      .from(vaultSecrets)
      .where(
        and(
          eq(vaultSecrets.projectId, fix.projectId),
          eq(vaultSecrets.name, `${fix.agentId}:config`),
        ),
      );
    expect(vaultSecret).toBeDefined();
    expect(vaultSecret!.currentVersion).toBe(1);
    const versions = await db
      .select()
      .from(vaultVersions)
      .where(eq(vaultVersions.secretId, vaultSecret!.id));
    expect(versions.length).toBe(1);
  });

  test("zero initial_credits → no transaction row, no wallet change", async () => {
    const fix = await setupFixture("zero-credits");
    const signature = signSponsorship(fix);

    const result = await elevateToLevel1(fix.projectId, {
      agentId: fix.agentId,
      sponsorIdentityId: fix.sponsorId,
      sponsorKid: fix.sponsorKid,
      sponsorSignature: signature,
      initialCredits: 0,
    });

    expect(result.agent.level).toBe(1);
    expect(result.wallet.balance).toBe(0);
    const txs = await db
      .select()
      .from(transactions)
      .where(eq(transactions.walletId, fix.agentWalletId));
    expect(txs.length).toBe(0);
  });

  test("SDK-ergonomic path: sponsor_did only (no UUID, no kid) resolves correctly", async () => {
    const fix = await setupFixture("did-path");
    // Canonical payload uses sponsor identity UUID — even when caller
    // selects by DID, the bytes are over UUID. Compute accordingly.
    const signature = signSponsorship(fix);

    const result = await elevateToLevel1(fix.projectId, {
      agentId: fix.agentId,
      sponsorDid: fix.sponsorDid,         // ← did, not UUID
      // sponsorKid omitted — orchestrator auto-picks the active key
      sponsorSignature: signature,
      initialCredits: 500,
    });

    expect(result.agent.level).toBe(1);
    expect(result.agent.sponsor_did).toBe(fix.sponsorDid);
    expect(result.agent.sponsor_identity_id).toBe(fix.sponsorId);
    expect(result.wallet.balance).toBe(500);
  });

  test("neither sponsor_identity_id nor sponsor_did → sponsor_not_provided 400", async () => {
    const fix = await setupFixture("no-sponsor");
    const signature = signSponsorship(fix);

    let caught: unknown;
    try {
      await elevateToLevel1(fix.projectId, {
        agentId: fix.agentId,
        sponsorSignature: signature,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ElevateError);
    expect((caught as ElevateError).reason).toBe("sponsor_not_provided");
    expect((caught as ElevateError).status).toBe(400);
  });
});

describe("bootstrap_elevate — refusals (transaction rollback on each)", () => {
  test("invalid signature: 403, no DB writes", async () => {
    const fix = await setupFixture("badsig");
    const goodSig = signSponsorship(fix);
    // Mangle the signature so verification fails. Bytes are valid base64
    // but won't match the canonical payload.
    const badSig = goodSig.slice(0, -8) + "AAAAAAAA";

    let caught: unknown;
    try {
      await elevateToLevel1(fix.projectId, {
        agentId: fix.agentId,
        sponsorIdentityId: fix.sponsorId,
        sponsorKid: fix.sponsorKid,
        sponsorSignature: badSig,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ElevateError);
    expect((caught as ElevateError).reason).toBe("signature_invalid");
    expect((caught as ElevateError).status).toBe(403);

    // No attestation row was inserted (signature pre-check is outside txn).
    const atts = await db
      .select()
      .from(attestations)
      .where(eq(attestations.subjectId, fix.agentId));
    expect(atts.length).toBe(0);
    // Agent metadata untouched — still Level 0.
    const [postAgent] = await db
      .select()
      .from(identities)
      .where(eq(identities.id, fix.agentId));
    const meta = (postAgent!.metadata ?? {}) as Record<string, unknown>;
    expect(meta.level).toBe(0);
  });

  test("already-elevated agent: 409 with details.current", async () => {
    const fix = await setupFixture("twice");
    const signature = signSponsorship(fix);

    // First elevation succeeds.
    await elevateToLevel1(fix.projectId, {
      agentId: fix.agentId,
      sponsorIdentityId: fix.sponsorId,
      sponsorKid: fix.sponsorKid,
      sponsorSignature: signature,
      initialCredits: 100,
    });

    // Second elevation: 409.
    let caught: unknown;
    try {
      await elevateToLevel1(fix.projectId, {
        agentId: fix.agentId,
        sponsorIdentityId: fix.sponsorId,
        sponsorKid: fix.sponsorKid,
        sponsorSignature: signature,
        initialCredits: 100,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ElevateError);
    const ee = caught as ElevateError;
    expect(ee.reason).toBe("agent_not_level_0");
    expect(ee.status).toBe(409);
    const current = (ee.extras.current ?? {}) as Record<string, unknown>;
    expect(current.level).toBe(1);
    expect(typeof current.elevated_at).toBe("string");

    // Wallet balance reflects ONE elevation, not two (no double-fund).
    const [postWallet] = await db
      .select()
      .from(wallets)
      .where(eq(wallets.id, fix.agentWalletId));
    expect(postWallet!.balance).toBe(100);
  });

  test("project boundary: sponsor from another project → sponsor_not_found", async () => {
    const fix = await setupFixture("xproject");

    // Create a sponsor in a DIFFERENT project — they shouldn't be usable
    // to elevate an agent in fix's project.
    const [otherProject] = await db
      .insert(projects)
      .values({ name: `elevate-test-other-${crypto.randomUUID().slice(0, 8)}` })
      .returning();
    const otherSponsor = await createIdentity({
      projectId: otherProject!.id,
      displayName: "outsider sponsor",
      metadata: { test_fixture: true },
    });
    const payload = canonicalPayload({
      subject_id: fix.agentId,
      attester_id: otherSponsor.identity.id,
      claim: "sponsorship",
      evidence: null,
    });
    const otherSig = sign(payload, otherSponsor.key.privateKey!);

    let caught: unknown;
    try {
      await elevateToLevel1(fix.projectId, {
        agentId: fix.agentId,
        sponsorIdentityId: otherSponsor.identity.id, // wrong project!
        sponsorKid: otherSponsor.key.kid,
        sponsorSignature: otherSig,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ElevateError);
    expect((caught as ElevateError).reason).toBe("sponsor_not_found");
    expect((caught as ElevateError).status).toBe(403);
  });

  test("agent_not_found: bogus agent_id → 404, no side effects", async () => {
    const fix = await setupFixture("noagent");
    const bogusAgentId = crypto.randomUUID();
    const payload = canonicalPayload({
      subject_id: bogusAgentId,
      attester_id: fix.sponsorId,
      claim: "sponsorship",
      evidence: null,
    });
    const sig = sign(payload, fix.sponsorPrivateKey);

    let caught: unknown;
    try {
      await elevateToLevel1(fix.projectId, {
        agentId: bogusAgentId,
        sponsorIdentityId: fix.sponsorId,
        sponsorKid: fix.sponsorKid,
        sponsorSignature: sig,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ElevateError);
    expect((caught as ElevateError).reason).toBe("agent_not_found");
    expect((caught as ElevateError).status).toBe(404);
  });

  test("initial_credits out of range: 400, no DB writes", async () => {
    const fix = await setupFixture("oob");
    const signature = signSponsorship(fix);

    let caught: unknown;
    try {
      await elevateToLevel1(fix.projectId, {
        agentId: fix.agentId,
        sponsorIdentityId: fix.sponsorId,
        sponsorKid: fix.sponsorKid,
        sponsorSignature: signature,
        initialCredits: 2_000_000, // above max
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(ElevateError);
    expect((caught as ElevateError).reason).toBe("initial_credits_out_of_range");
    expect((caught as ElevateError).status).toBe(400);

    // No attestation row was inserted (validation is pre-txn).
    const atts = await db
      .select()
      .from(attestations)
      .where(eq(attestations.subjectId, fix.agentId));
    expect(atts.length).toBe(0);
  });
});
