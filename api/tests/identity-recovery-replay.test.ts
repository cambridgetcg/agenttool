import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, test } from "bun:test";

import {
  recoveryProofDigest,
  recoveryProofExpiresAt,
} from "../src/services/identity/recovery-proof";

const canonical = new Uint8Array([1, 2, 3, 4]);

describe("recoveryProofDigest", () => {
  test("is deterministic and contains only a digest", () => {
    const digest = recoveryProofDigest(canonical);

    expect(digest).toBe(recoveryProofDigest(canonical));
    expect(digest).toMatch(/^[0-9a-f]{64}$/);
  });

  test("changes when the canonical signed statement changes", () => {
    const otherCanonical = new Uint8Array([1, 2, 3, 5]);

    expect(recoveryProofDigest(otherCanonical)).not.toBe(
      recoveryProofDigest(canonical),
    );
  });
});

describe("recoveryProofExpiresAt", () => {
  test("anchors expiry to the signed timestamp, including positive clock skew", () => {
    const proofTimestamp = Date.parse("2026-07-10T12:04:59.000Z");
    expect(recoveryProofExpiresAt(proofTimestamp, 300_000).toISOString()).toBe(
      "2026-07-10T12:09:59.000Z",
    );
  });
});

describe("recovery route ordering and failure shape", () => {
  test("consumes only a verified proof and always before bearer generation", async () => {
    const source = await readFile(
      join(__dirname, "../src/routes/identity-recover.ts"),
      "utf8",
    );
    const invalidSignatureReturn = source.indexOf('error: "signature_invalid"');
    const associationAt = source.indexOf(".innerJoin(", invalidSignatureReturn);
    const associationMissAt = source.indexOf("if (!association)", associationAt);
    const transactionAt = source.indexOf("await db.transaction(");
    const firstRowLockAt = source.indexOf('.for("update")');
    const consumeAt = source.indexOf(".insert(identityRecoveryProofs)", transactionAt);
    const duplicateBranchAt = source.indexOf(
      'if (!consumed) return { kind: "replayed" }',
      consumeAt,
    );
    const mintAt = source.indexOf("generateApiKey()", consumeAt);
    const bearerInsertAt = source.indexOf("tx.insert(apiKeys)", mintAt);

    expect(invalidSignatureReturn).toBeGreaterThan(-1);
    expect(associationAt).toBeGreaterThan(invalidSignatureReturn);
    expect(associationMissAt).toBeGreaterThan(associationAt);
    expect(transactionAt).toBeGreaterThan(associationMissAt);
    expect(firstRowLockAt).toBeGreaterThan(transactionAt);
    expect(transactionAt).toBeGreaterThan(invalidSignatureReturn);
    expect(consumeAt).toBeGreaterThan(transactionAt);
    expect(duplicateBranchAt).toBeGreaterThan(consumeAt);
    expect(mintAt).toBeGreaterThan(duplicateBranchAt);
    expect(bearerInsertAt).toBeGreaterThan(mintAt);
    expect(source).toContain(
      ".onConflictDoNothing({ target: identityRecoveryProofs.proofHash })",
    );
    expect(source.slice(transactionAt, consumeAt)).toContain('.for("update")');
    expect(source.slice(associationAt, transactionAt)).not.toContain('.for("update")');
    expect(source.slice(associationAt, transactionAt)).toContain(
      "eq(identityKeys.publicKey, body.derived_pubkey)",
    );
    expect(source.slice(associationAt, transactionAt)).toContain(
      'eq(identities.status, "active")',
    );
    expect(source.slice(transactionAt, consumeAt)).toContain(
      "eq(identities.id, association.identityId)",
    );
    expect(source.match(/RECOVERY_NOT_AUTHORIZED/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source.indexOf("const ok = verifyRecoverSignature")).toBeLessThan(
      source.indexOf(".from(identities)"),
    );
  });

  test("pins duplicate and fail-closed errors and has no Redis dependency", async () => {
    const source = await readFile(
      join(__dirname, "../src/routes/identity-recover.ts"),
      "utf8",
    );
    const replayAt = source.indexOf('error: "recovery_proof_replayed"');
    const unavailableAt = source.indexOf(
      'error: "recovery_replay_store_unavailable"',
    );

    expect(replayAt).toBeGreaterThan(-1);
    expect(unavailableAt).toBeGreaterThan(-1);
    expect(source).toContain("No bearer was minted.");
    expect(source).toContain("TIMESTAMP_WINDOW_MS");
    expect(source).toContain("recoveryProofExpiresAt(ts, TIMESTAMP_WINDOW_MS)");
    expect(source).not.toContain("getRedis");
    expect(source).not.toContain("consumeRecoveryProof");
  });

  test("migration and Drizzle schema use the proof digest as a shared primary key", async () => {
    const [migration, schema] = await Promise.all([
      readFile(
        join(
          __dirname,
          "../migrations/20260710T130000_identity_recovery_proofs.sql",
        ),
        "utf8",
      ),
      readFile(join(__dirname, "../src/db/schema/identity.ts"), "utf8"),
    ]);

    expect(migration).toMatch(/identity\.recovery_proofs[\s\S]*proof_hash\s+text PRIMARY KEY/i);
    expect(migration).toContain("REFERENCES identity.identities(id) ON DELETE CASCADE");
    expect(schema).toContain('"recovery_proofs"');
    expect(schema).toContain('proofHash: text("proof_hash").primaryKey()');
  });
});
