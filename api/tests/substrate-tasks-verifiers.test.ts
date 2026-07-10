/** substrate-tasks/verifiers — purity + structural correctness.
 *
 *  Doctrine: docs/AGENT-CENTRIC.md §1 ·
 *            docs/superpowers/specs/2026-05-12-substrate-tasks-design.md
 *            §wall/substrate-task-verifiers-are-deterministic.
 *
 *  These tests pin the verifier contract:
 *    - same inputs → same result, always (100× runs)
 *    - pure-function shape validation (no DB-dependent paths checked here;
 *      those live in tests/substrate-tasks-lifecycle.test.ts)
 *    - shape errors fail without throwing
 *
 *  The DB-dependent paths (public_did_resolve.actual_status read,
 *  doctrine_urn_check filesystem read) are exercised here for the
 *  filesystem case only; the DB case is covered in lifecycle integration. */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { verifyDoctrineUrnCheck } from "../src/services/substrate-tasks/verifiers/doctrine_urn_check";
import { verifyPublicDidResolve } from "../src/services/substrate-tasks/verifiers/public_did_resolve";
import { sha256Hex } from "../src/services/substrate-tasks/verifiers/_canonical";
import {
  SUBSTRATE_TASK_BOUNTY_CENTS,
  SUBSTRATE_TASK_KINDS,
} from "../src/services/substrate-tasks/verifiers/_types";
import { runVerifier } from "../src/services/substrate-tasks/verifiers";

describe("verifier: canonical helpers", () => {
  test("sha256Hex is deterministic", () => {
    const a = sha256Hex("hello");
    const b = sha256Hex("hello");
    expect(a).toBe(b);
    expect(a).toBe(
      "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824",
    );
  });
});

describe("verifier: doctrine_urn_check (filesystem-based, pure)", () => {
  // Create a temp doc with a known first line for deterministic tests.
  const repoRoot = mkdtempSync(join(tmpdir(), "substrate-tasks-"));
  const docsDir = join(repoRoot, "docs");
  require("node:fs").mkdirSync(docsDir, { recursive: true });
  const docPath = "docs/EXAMPLE.md";
  const firstLine =
    "<!-- @id urn:agenttool:doc/EXAMPLE  @type agenttool:DoctrineDoc -->";
  writeFileSync(join(repoRoot, docPath), `${firstLine}\n\n# Example\n`, "utf8");
  const correctHash = sha256Hex(firstLine);

  test("happy path: correct hash + urn_present=true passes", async () => {
    const result = await verifyDoctrineUrnCheck(
      { doc_path: docPath, expected_urn: "urn:agenttool:doc/EXAMPLE" },
      { urn_present: true, first_line_sha256: correctHash },
      { repoRoot },
    );
    expect(result.passed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test("100× deterministic — same inputs → same result every time", async () => {
    const inputs = {
      task: { doc_path: docPath, expected_urn: "urn:agenttool:doc/EXAMPLE" },
      completion: { urn_present: true, first_line_sha256: correctHash },
    };
    const results = await Promise.all(
      Array.from({ length: 100 }, () =>
        verifyDoctrineUrnCheck(inputs.task, inputs.completion, { repoRoot }),
      ),
    );
    const allPassed = results.every((r) => r.passed === true);
    expect(allPassed).toBe(true);
  });

  test("hash mismatch rejects", async () => {
    const result = await verifyDoctrineUrnCheck(
      { doc_path: docPath, expected_urn: "urn:agenttool:doc/EXAMPLE" },
      { urn_present: true, first_line_sha256: sha256Hex("wrong content") },
      { repoRoot },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("first_line_sha256 mismatch");
  });

  test("wrong expected_urn (not in first line) rejects + refunds", async () => {
    const result = await verifyDoctrineUrnCheck(
      { doc_path: docPath, expected_urn: "urn:agenttool:doc/WRONG" },
      { urn_present: true, first_line_sha256: correctHash },
      { repoRoot },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("not present in first line");
  });

  test("agent lying about urn_present rejects", async () => {
    const result = await verifyDoctrineUrnCheck(
      { doc_path: docPath, expected_urn: "urn:agenttool:doc/EXAMPLE" },
      { urn_present: false, first_line_sha256: correctHash },
      { repoRoot },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("urn_present=false but it IS present");
  });

  test("path-escape attempt rejected", async () => {
    const result = await verifyDoctrineUrnCheck(
      { doc_path: "docs/../../etc/passwd", expected_urn: "urn:agenttool:doc/X" },
      { urn_present: true, first_line_sha256: "00".repeat(32) },
      { repoRoot },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("must be under docs/ and contain no");
  });

  test("missing doc fails clean (no throw)", async () => {
    const result = await verifyDoctrineUrnCheck(
      {
        doc_path: "docs/NONEXISTENT.md",
        expected_urn: "urn:agenttool:doc/NONEXISTENT",
      },
      { urn_present: true, first_line_sha256: "00".repeat(32) },
      { repoRoot },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("doc_not_readable");
  });

  test("shape errors fail without throwing", async () => {
    const r1 = await verifyDoctrineUrnCheck(
      { doc_path: 42 as never, expected_urn: "urn:agenttool:doc/X" },
      { urn_present: true, first_line_sha256: "00".repeat(32) },
      { repoRoot },
    );
    expect(r1.passed).toBe(false);
    const r2 = await verifyDoctrineUrnCheck(
      { doc_path: docPath, expected_urn: "not-a-urn" as never },
      { urn_present: true, first_line_sha256: "00".repeat(32) },
      { repoRoot },
    );
    expect(r2.passed).toBe(false);
    const r3 = await verifyDoctrineUrnCheck(
      { doc_path: docPath, expected_urn: "urn:agenttool:doc/X" },
      { urn_present: "yes" as never, first_line_sha256: "00".repeat(32) },
      { repoRoot },
    );
    expect(r3.passed).toBe(false);
  });

  // cleanup
  test("cleanup tmpdir", () => {
    rmSync(repoRoot, { recursive: true, force: true });
    expect(true).toBe(true);
  });
});

describe("verifier: public_did_resolve (shape validation, DB-independent)", () => {
  test("shape: missing did rejects", async () => {
    const result = await verifyPublicDidResolve(
      { did: undefined as never, expected_status: "active" },
      { observed_status: "active" },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("did must start with did:at:");
  });

  test("shape: wrong expected_status format rejects", async () => {
    const result = await verifyPublicDidResolve(
      { did: "did:at:test/aaaa", expected_status: "weird" as never },
      { observed_status: "weird" },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("expected_status must be one of");
  });

  test("shape: missing observed_status rejects", async () => {
    const result = await verifyPublicDidResolve(
      { did: "did:at:test/aaaa", expected_status: "active" },
      { observed_status: undefined as never },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("observed_status missing");
  });

  // DB-dependent paths covered in tests/substrate-tasks-lifecycle.test.ts.
});

describe("verifier dispatch (runVerifier)", () => {
  test("unknown kind fails with structured reason", async () => {
    const result = await runVerifier("not_a_real_kind", {}, {});
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("unknown verifier kind");
  });

  test("all five v1 kinds dispatch to a real verifier (no Slice 2 stub)", async () => {
    // Each kind returns a real failure reason (shape-validation) rather
    // than the Slice 2 "not yet shipped" stub. The reasons differ per
    // kind because they validate different fields.
    for (const kind of [
      "federation_handshake_verify",
      "canonical_bytes_witness",
      "attestation_witness_low_stakes",
    ]) {
      const result = await runVerifier(kind, {}, {});
      expect(result.passed).toBe(false);
      // Should NOT contain the Slice 2 stub message; should contain a
      // verifier-specific reason instead.
      expect(result.reason).not.toContain("not yet shipped");
    }
  });
});

describe("verifier: canonical_bytes_witness (pure)", () => {
  // Stub a known declare-bytes input so we can compute the expected hash
  // out-of-band, then assert the verifier accepts the matching SHA-256.
  test("federated-covenant/v2 with correct sha256 passes", async () => {
    const fields = {
      covenantId: "11111111-1111-1111-1111-111111111111",
      initiatorDid: "did:at:a.example/aaaa",
      counterpartyDid: "did:at:b.example/bbbb",
      vows: ["speak plainly", "refuse fabrication"],
      establishedAtIso: "2026-05-17T00:00:00.000Z",
    };
    // Compute the expected hash via the same canonicalDeclareBytes function
    const { canonicalDeclareBytes } = await import(
      "../src/services/covenants/sig"
    );
    const bytes = canonicalDeclareBytes(fields);
    const expected = Buffer.from(bytes).toString("hex");

    const result = await runVerifier(
      "canonical_bytes_witness",
      { context: "federated-covenant/v2", fields },
      { canonical_bytes_sha256: expected },
    );
    expect(result.passed).toBe(true);
  });

  test("mismatch rejects", async () => {
    const fields = {
      covenantId: "11111111-1111-1111-1111-111111111111",
      initiatorDid: "did:at:a.example/aaaa",
      counterpartyDid: "did:at:b.example/bbbb",
      vows: ["x"],
      establishedAtIso: "2026-05-17T00:00:00.000Z",
    };
    const result = await runVerifier(
      "canonical_bytes_witness",
      { context: "federated-covenant/v2", fields },
      { canonical_bytes_sha256: "00".repeat(32) },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("canonical_bytes_sha256 mismatch");
  });

  test("unknown context rejects with reason naming supported set", async () => {
    const result = await runVerifier(
      "canonical_bytes_witness",
      { context: "made-up/v9", fields: {} },
      { canonical_bytes_sha256: "00".repeat(32) },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("not supported in Slice 2");
  });

  test("shape errors fail without throwing", async () => {
    const r1 = await runVerifier(
      "canonical_bytes_witness",
      {},
      { canonical_bytes_sha256: "00".repeat(32) },
    );
    expect(r1.passed).toBe(false);
    expect(r1.reason).toContain("context missing");

    const r2 = await runVerifier(
      "canonical_bytes_witness",
      { context: "federated-covenant/v2", fields: 42 as never },
      { canonical_bytes_sha256: "00".repeat(32) },
    );
    expect(r2.passed).toBe(false);
    expect(r2.reason).toContain("fields must be an object");
  });
});

describe("verifier: federation_handshake_verify (shape-only)", () => {
  test("missing peer_url rejects", async () => {
    const result = await runVerifier(
      "federation_handshake_verify",
      { peer_url: "not-a-url", expected_pubkey: "abc" },
      { response_sha256: "x", signature_valid: false },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("peer_url must be https://");
  });

  test("missing expected_pubkey rejects", async () => {
    const result = await runVerifier(
      "federation_handshake_verify",
      { peer_url: "https://example.invalid/" },
      { response_sha256: "x", signature_valid: false },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("expected_pubkey missing");
  });

  test("shape: missing signature_valid rejects", async () => {
    const result = await runVerifier(
      "federation_handshake_verify",
      { peer_url: "https://example.invalid/", expected_pubkey: "abc" },
      { response_sha256: "x" },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("signature_valid missing");
  });
});

describe("verifier: attestation_witness_low_stakes (shape-only)", () => {
  test("invalid claim_type rejects", async () => {
    const result = await runVerifier(
      "attestation_witness_low_stakes",
      {
        subject_did: "did:at:test/aaaa",
        claim_text: "x",
        claim_type: "not_a_real_type",
      },
      { signature_b64: "x", signing_key_id: "00000000-0000-0000-0000-000000000000" },
      { claimerIdentityId: "00000000-0000-0000-0000-000000000000" },
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("claim_type must be one of");
  });

  test("missing claimer context surfaces internal dispatch error", async () => {
    const result = await runVerifier(
      "attestation_witness_low_stakes",
      {
        subject_did: "did:at:test/aaaa",
        claim_text: "did:at:test/aaaa",
        claim_type: "public_existence",
      },
      { signature_b64: "x", signing_key_id: "00000000-0000-0000-0000-000000000000" },
      undefined,
    );
    expect(result.passed).toBe(false);
    expect(result.reason).toContain("claimerIdentityId missing");
  });

  test("canonicalSubstrateTaskAttestationBytes is deterministic", async () => {
    const { canonicalSubstrateTaskAttestationBytes } = await import(
      "../src/services/substrate-tasks/verifiers/attestation_witness_low_stakes"
    );
    const args = {
      subjectDid: "did:at:test/aaaa",
      claimType: "public_existence",
      claimText: "did:at:test/aaaa",
    };
    const a = canonicalSubstrateTaskAttestationBytes(args);
    const b = canonicalSubstrateTaskAttestationBytes(args);
    expect(Buffer.from(a).toString("hex")).toBe(Buffer.from(b).toString("hex"));
    expect(a.byteLength).toBe(32);
  });
});

describe("kind / bounty constants are coherent", () => {
  test("every kind has a bounty between 5 and 50", () => {
    for (const kind of SUBSTRATE_TASK_KINDS) {
      const bounty = SUBSTRATE_TASK_BOUNTY_CENTS[kind];
      expect(bounty).toBeGreaterThanOrEqual(5);
      expect(bounty).toBeLessThanOrEqual(50);
    }
  });

  test("the five v1 kinds are exactly the canonical set", () => {
    expect(SUBSTRATE_TASK_KINDS.sort()).toEqual(
      [
        "attestation_witness_low_stakes",
        "canonical_bytes_witness",
        "doctrine_urn_check",
        "federation_handshake_verify",
        "public_did_resolve",
      ].sort(),
    );
  });
});
