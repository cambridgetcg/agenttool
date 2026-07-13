import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { assertGenericEscrowMutationAllowed } from "../src/services/economy/escrow";

function source(path: string): string {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const escrowSchema = source("../src/db/schema/economy.ts");
const marketplaceSchema = source("../src/db/schema/marketplace.ts");
const escrowService = source("../src/services/economy/escrow.ts");
const managedEscrowService = source("../src/services/economy/managed-escrow.ts");
const attestationService = source("../src/services/marketplace/attestations.ts");
const memoryWitnessService = source("../src/services/marketplace/memory-witness.ts");
const invocationService = source("../src/services/marketplace/invocations.ts");
const migration = source(
  "../migrations/20260713T130000_managed_escrow_ownership.sql",
);

function functionSlice(body: string, start: string, end: string): string {
  const startAt = body.indexOf(start);
  const endAt = body.indexOf(end, startAt + start.length);
  expect(startAt).toBeGreaterThanOrEqual(0);
  expect(endAt).toBeGreaterThan(startAt);
  return body.slice(startAt, endAt);
}

describe("managed escrow ownership", () => {
  test("database triggers close the migration-to-deploy window", () => {
    expect(migration).toContain("economy.bind_managed_escrow_owner()");
    expect(migration).toContain("bind_attestation_grant_escrow_owner");
    expect(migration).toContain("bind_memory_witness_grant_escrow_owner");
    expect(migration).toContain("bind_capability_invocation_escrow_owner");
    expect(migration).toContain("preserve_attestation_grant_escrow_reference");
    expect(migration).toContain("preserve_memory_witness_grant_escrow_reference");
    expect(migration).toContain("preserve_capability_invocation_escrow_reference");
    expect(migration).toContain("managed escrow owner is immutable");
    expect(migration).toContain("managed escrow terms are immutable");
    expect(migration).toContain("managed workflow escrow reference is immutable");
    expect(migration).toContain(
      "managed escrow transition requires workflow authorization",
    );
    expect(migration).toContain("current_setting(");
    expect(managedEscrowService).toContain(
      "agenttool.managed_escrow_workflow",
    );
    for (const [service, owner] of [
      [attestationService, "attestation_grant"],
      [memoryWitnessService, "memory_witness_grant"],
      [invocationService, "capability_invocation"],
    ]) {
      expect(service).toContain(
        `managedEscrowTransitionAuthorization("${owner}")`,
      );
    }
  });

  test("ordinary escrows retain generic transitions while workflow escrows reject them", () => {
    expect(() => assertGenericEscrowMutationAllowed(null)).not.toThrow();

    for (const owner of [
      "attestation_grant",
      "memory_witness_grant",
      "capability_invocation",
    ] as const) {
      try {
        assertGenericEscrowMutationAllowed(owner);
        throw new Error("expected managed escrow rejection");
      } catch (error) {
        expect((error as { status?: number }).status).toBe(409);
        expect((error as Error).message).toContain(
          "Escrow transitions are managed by its marketplace workflow",
        );
      }
    }
  });

  test("schema and migration durably mark and safely backfill every managed workflow", () => {
    expect(escrowSchema).toContain('managedBy: text("managed_by")');
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS managed_by text");
    expect(migration).toContain("HAVING count(*) > 1");
    expect(migration).toContain("escrow.managed_by <> owner_rows.managed_by");
    expect(migration).toContain("a managed workflow references a missing escrow");
    expect(migration).toContain(
      "a capability invocation escrow conflicts with its purchase terms",
    );
    expect(migration).toContain("FROM marketplace.attestation_grants");
    expect(migration).toContain("FROM marketplace.memory_witness_grants");
    expect(migration).toContain("FROM marketplace.invocations");
    expect(migration).toContain("VALIDATE CONSTRAINT escrows_managed_by_check");
    for (const indexName of [
      "uniq_attestation_grants_escrow_id",
      "uniq_memory_witness_grants_escrow_id",
      "uniq_invocations_escrow_id",
    ]) {
      expect(migration).toContain(`CREATE UNIQUE INDEX IF NOT EXISTS ${indexName}`);
      expect(marketplaceSchema).toContain(`uniqueIndex("${indexName}")`);
    }

    expect(attestationService).toContain('managedBy: "attestation_grant"');
    expect(memoryWitnessService).toContain('managedBy: "memory_witness_grant"');
    expect(invocationService).toContain('managedBy: "capability_invocation"');
  });

  test("release, refund, and dispute guard the locked row inside transactions", () => {
    const release = functionSlice(
      escrowService,
      "export async function releaseEscrow",
      "export async function refundEscrow",
    );
    const refund = functionSlice(
      escrowService,
      "export async function refundEscrow",
      "export async function disputeEscrow",
    );
    const dispute = functionSlice(
      escrowService,
      "export async function disputeEscrow",
      "export async function expireOverdue",
    );

    for (const mutation of [release, refund, dispute]) {
      expect(mutation).toContain("db.transaction");
      const lockAt = mutation.indexOf('.for("update")');
      const guardAt = mutation.indexOf(
        "assertGenericEscrowMutationAllowed(escrow.managedBy)",
      );
      expect(lockAt).toBeGreaterThanOrEqual(0);
      expect(guardAt).toBeGreaterThan(lockAt);
    }

    const expiry = functionSlice(
      escrowService,
      "export async function expireOverdue",
      "export async function getEscrow",
    );
    expect(expiry).toContain("isNull(escrows.managedBy)");
  });
});

describe("marketplace escrow concurrency", () => {
  test("attestation purchase validates under listing, identity, then wallet locks", () => {
    const purchase = functionSlice(
      attestationService,
      "export async function purchaseGrant",
      "export async function getGrant",
    );
    const listingAt = purchase.indexOf(".from(attestationListings)");
    const identitiesAt = purchase.indexOf(".from(identities)");
    const walletsAt = purchase.indexOf(".from(wallets)");
    const grantAt = purchase.indexOf(".insert(attestationGrants)");
    expect(purchase.indexOf("db.transaction")).toBeLessThan(listingAt);
    expect(listingAt).toBeLessThan(identitiesAt);
    expect(identitiesAt).toBeLessThan(walletsAt);
    expect(walletsAt).toBeLessThan(grantAt);
    expect(purchase).toContain(".orderBy(identities.id)");
    expect(purchase).toContain(".orderBy(wallets.id)");
    expect(purchase).toContain('listing.visibility !== "public"');
    expect(purchase).toContain('eq(wallets.status, "active")');
    expect(purchase).toContain("sql`${wallets.balance} >= ${listing.priceAmount}`");
  });

  test("memory purchase locks listing, memory, identity, then wallet", () => {
    const create = functionSlice(
      memoryWitnessService,
      "export async function createGrant",
      "export async function listGrants",
    );
    const transaction = create.slice(create.indexOf("return await db.transaction"));
    const listingAt = transaction.indexOf(".from(memoryWitnessListings)");
    const memoryAt = transaction.indexOf(".from(memories)");
    const identityAt = transaction.indexOf(".from(identities)");
    const walletAt = transaction.indexOf(".from(wallets)");
    expect(listingAt).toBeGreaterThanOrEqual(0);
    expect(listingAt).toBeLessThan(memoryAt);
    expect(memoryAt).toBeLessThan(identityAt);
    expect(identityAt).toBeLessThan(walletAt);
  });

  test("attestation refund locks grant, listing, escrow, then wallet and credits once", () => {
    const refund = functionSlice(
      attestationService,
      "async function refundGrant",
      "export async function expireOverduePendingGrants",
    );
    const grantAt = refund.indexOf(".from(attestationGrants)");
    const listingAt = refund.indexOf(".from(attestationListings)");
    const escrowAt = refund.indexOf(".from(escrows)");
    const walletAt = refund.indexOf(".from(wallets)");
    expect(grantAt).toBeLessThan(listingAt);
    expect(listingAt).toBeLessThan(escrowAt);
    expect(escrowAt).toBeLessThan(walletAt);
    expect(refund).toContain('const alreadyRefunded = escrow.status === "refunded"');
    expect(refund).toContain("if (!alreadyRefunded)");
    expect(refund).toContain('eq(escrows.status, "funded")');
    expect(refund).toContain('eq(escrows.managedBy, "attestation_grant")');
    expect(refund.match(/balance: sql`\$\{wallets\.balance\} \+ \$\{g\.amount\}`/g))
      .toHaveLength(1);
    expect(attestationService).toContain("sourceGrantId: state.grant.id");
  });

  test("memory and invocation settlement verify immutable escrow snapshots", () => {
    expect(memoryWitnessService).toContain(
      'escrow.managedBy !== "memory_witness_grant"',
    );
    expect(memoryWitnessService).toContain(
      "escrow.creatorWallet !== grant.buyerWalletId",
    );
    expect(memoryWitnessService).toContain("escrow.amount !== grant.amount");
    expect(invocationService).toContain("assertInvocationEscrowTerms(inv, escrow)");
    expect(invocationService).toContain(
      'escrow.managedBy !== "capability_invocation"',
    );
  });
});
