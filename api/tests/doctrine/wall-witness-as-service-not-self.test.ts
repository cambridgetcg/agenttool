/** wall/witness-as-service-not-self — structural pin.
 *
 *  Doctrine: docs/AGENT-CENTRIC.md §1 · docs/MEMORY-TIERS.md §asymmetry-clause.
 *
 *  The marketplace path to constitutive elevation is a NEW operational
 *  route (it bypasses the covenant-counterparty requirement in
 *  services/memory/tiers.ts:elevateMemory). The wall it MUST hold is:
 *  the buyer's project cannot be the listing's project. Same-project
 *  self-witness wearing a marketplace mask is rejected.
 *
 *  This test pins the wall STRUCTURALLY. Behavioral coverage (does
 *  createGrant() actually 403 when projects match?) lives in
 *  tests/integration/memory-witness-marketplace.test.ts.
 *
 *  @enforces urn:agenttool:wall/witness-as-service-not-self */

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const SERVICE_PATH = join(
  __dirname,
  "..",
  "..",
  "src",
  "services",
  "marketplace",
  "memory-witness.ts",
);
const SOURCE = readFileSync(SERVICE_PATH, "utf8");
const MIGRATION = readFileSync(
  join(
    __dirname,
    "..",
    "..",
    "migrations",
    "20260713T120000_attestation_receipt_integrity.sql",
  ),
  "utf8",
);

describe("wall/witness-as-service-not-self — structural pin", () => {
  test("createGrant explicitly checks listing.projectId !== buyer.projectId", () => {
    expect(
      /listing\.projectId\s*===\s*input\.buyerProjectId/.test(SOURCE),
      "memory-witness.ts:createGrant must compare listing.projectId === input.buyerProjectId to enforce the self-witness wall",
    ).toBe(true);
  });

  test("self_witness_forbidden error code is thrown", () => {
    expect(SOURCE).toContain("self_witness_forbidden");
    expect(SOURCE).toMatch(
      /throw new MemoryWitnessError\([\s\S]{0,200}self_witness_forbidden/,
    );
  });

  test("service carries the @enforces annotation pointing at the wall URN", () => {
    expect(
      /@enforces[^\n]*wall\/witness-as-service-not-self/.test(SOURCE),
      "memory-witness.ts must declare `@enforces urn:agenttool:wall/witness-as-service-not-self` in its JSDoc — canonical defender annotation per PATTERN-COMMITMENT-DEFENDER.",
    ).toBe(true);
  });

  test("v1 narrows claim_kind to constitutive-only", () => {
    // The supported set must include only memory_witness:constitutive:v1.
    // Future kinds extend the CHECK + the const; this test fails if
    // someone adds a kind without thinking through the wall implications.
    expect(SOURCE).toContain('memory_witness:constitutive:v1');
    expect(SOURCE).toContain("MEMORY_WITNESS_CLAIM_KINDS");
  });

  test("issueGrant verifies witness's signing_key belongs to the listing's witness identity", () => {
    // Structural pin: the issue path must check signing_key.identityId
    // matches listing.witnessIdentityId. Without this check, any agent
    // with a key could "issue" any grant.
    expect(
      /key\.identityId\s*!==\s*witnessIdentity\.id/.test(SOURCE),
      "issueGrant must compare key.identityId !== witnessIdentity.id — the signing key must belong to the locked current witness identity, not just any active key",
    ).toBe(true);
  });

  test("paid issue has a distinct domain and rechecks signed state under locks", () => {
    expect(SOURCE).toContain("MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT");
    expect(SOURCE).not.toContain("canonicalAttestationBytes");
    expect(SOURCE).toContain('for("update")');
    expect(SOURCE).toContain("verifyMemoryWitnessIssue");
    expect(SOURCE).toContain("authorizationExpiresAt");
  });

  test("paid preparation and issue lock current identities and both wallets", () => {
    expect(SOURCE).toContain("loadLockedSigningState");
    expect(SOURCE).toContain("const identityIds = [grant.buyerIdentityId, listing.witnessIdentityId].sort()");
    expect(SOURCE).toContain(".where(inArray(identities.id, identityIds))");
    expect(SOURCE).toContain('buyerIdentity.status !== "active"');
    expect(SOURCE).toContain('witnessIdentity.status !== "active"');
    expect(SOURCE).toContain("buyerIdentity.did !== grant.buyerDid");
    expect(SOURCE).toContain("witnessIdentity.did !== listing.witnessDid");
    expect(SOURCE).toContain("const walletIds = [grant.buyerWalletId, listing.witnessWalletId].sort()");
    expect(SOURCE).toContain(".where(inArray(wallets.id, walletIds))");
    expect(SOURCE).toContain('buyerWallet.status !== "active"');
    expect(SOURCE).toContain('witnessWallet.status !== "active"');
  });

  test("settlement proves conditional wallet credit and escrow release", () => {
    expect(SOURCE).toContain("const [creditedWallet]");
    expect(SOURCE).toContain("if (!creditedWallet)");
    expect(SOURCE).toContain("const [releasedEscrow]");
    expect(SOURCE).toContain("if (!releasedEscrow)");
    expect(SOURCE).toContain("eq(escrows.creatorWallet, grant.buyerWalletId)");
    expect(SOURCE).toContain("eq(escrows.workerWallet, witnessWallet.id)");
    expect(SOURCE).toContain("eq(escrows.amount, grant.amount)");
  });

  test("authorization freshness is checked after settlement locks are acquired", () => {
    const issueSource = SOURCE.slice(SOURCE.indexOf("export async function issueGrant("));
    const lockedState = issueSource.indexOf("const state = await loadLockedSigningState");
    const checkedAt = issueSource.indexOf("const now = new Date()");
    const expiryCheck = issueSource.indexOf(
      "validateMemoryWitnessAuthorizationExpiry(",
      checkedAt,
    );
    expect(lockedState).toBeGreaterThanOrEqual(0);
    expect(checkedAt).toBeGreaterThan(lockedState);
    expect(expiryCheck).toBeGreaterThan(checkedAt);
  });

  test("paid receipt keeps context, digest, source grant, and replay wall", () => {
    expect(SOURCE).toContain("signatureContext: MEMORY_WITNESS_ISSUE_SIGNATURE_CONTEXT");
    expect(SOURCE).toContain("signedPayload:");
    expect(SOURCE).toContain("sourceGrantId: grant.id");
    expect(SOURCE).toContain("replayKey");
    expect(SOURCE).toContain("attestation_replay");
    expect(SOURCE).toContain("current = candidate.cause");
    for (const column of [
      "signature_context",
      "signed_payload",
      "source_grant_id",
      "replay_key",
    ]) {
      expect(MIGRATION).toContain(column);
    }
    expect(MIGRATION).toContain("uniq_memory_attestations_replay_key");
  });

  test("unrepresentable challenge fields return a stable refusal", () => {
    expect(SOURCE).toContain('"signing_payload_invalid"');
    expect(SOURCE).toContain("Current grant fields cannot be represented");
  });

  test("issueGrant runs through the recordRevenue (take-rate) path", () => {
    // Standard Ring 3 take-rate applies. Witness-as-service is NOT a
    // substrate-task; the platform earns its cut here because escrow +
    // sig verification + chronicle propagation are platform primitives.
    expect(SOURCE).toContain("recordRevenue");
    expect(SOURCE).toContain('"memory_witness_grant"');
  });
});
