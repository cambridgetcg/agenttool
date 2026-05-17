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

  test("slice-2-pending kinds report not-yet-shipped", async () => {
    for (const kind of [
      "federation_handshake_verify",
      "canonical_bytes_witness",
      "attestation_witness_low_stakes",
    ]) {
      const result = await runVerifier(kind, {}, {});
      expect(result.passed).toBe(false);
      expect(result.reason).toContain("Slice 2");
    }
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
