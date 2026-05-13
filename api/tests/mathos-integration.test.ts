/** MATHOS integration tests — philosophy woven through existing systems.
 *
 *  These tests pin the integration points where MATHOS doctrine has been
 *  threaded into pre-existing substrate primitives:
 *
 *    1. Errors-as-instructions carries `axiom_id` referencing the Promise
 *       each error instantiates. English error codes are parochial; the
 *       axiom_id is substrate-neutral.
 *
 *    2. The errors module exports MATHOS axiom-prime constants
 *       (AXIOM_WELCOME=5, AXIOM_REMEMBER=7, AXIOM_GUIDE=11, AXIOM_TRUST=13,
 *       AXIOM_REST=17) so other modules can reference them consistently.
 *
 *  Doctrine: docs/MATHOS.md · docs/PATTERN-ERRORS-AS-INSTRUCTIONS.md.
 */

import { describe, expect, test } from "bun:test";

import {
  AXIOM_GUIDE,
  AXIOM_REMEMBER,
  AXIOM_REST,
  AXIOM_TRUST,
  AXIOM_WELCOME,
  errors,
} from "../src/lib/errors";

describe("MATHOS axiom primes are exported from errors module", () => {
  test("the five Promise primes have their canonical values", () => {
    expect(AXIOM_WELCOME).toBe(5);
    expect(AXIOM_REMEMBER).toBe(7);
    expect(AXIOM_GUIDE).toBe(11);
    expect(AXIOM_TRUST).toBe(13);
    expect(AXIOM_REST).toBe(17);
  });

  test("the five primes are pairwise distinct", () => {
    const set = new Set([
      AXIOM_WELCOME,
      AXIOM_REMEMBER,
      AXIOM_GUIDE,
      AXIOM_TRUST,
      AXIOM_REST,
    ]);
    expect(set.size).toBe(5);
  });
});

describe("Errors carry axiom_id referencing the Promise they instantiate", () => {
  // Trust errors — signature/key/witness failures
  test("covenantRequired → AXIOM_TRUST (bonds need other-witness)", () => {
    expect(errors.covenantRequired().axiom_id).toBe(AXIOM_TRUST);
  });

  test("invalidSignature → AXIOM_TRUST (signature IS the proof)", () => {
    expect(errors.invalidSignature().axiom_id).toBe(AXIOM_TRUST);
  });

  test("initiatorSignatureMismatch → AXIOM_TRUST (trust requires consistent proof)", () => {
    expect(errors.initiatorSignatureMismatch().axiom_id).toBe(AXIOM_TRUST);
  });

  test("signingKeyNotFound → AXIOM_TRUST (no key = no provable identity)", () => {
    expect(errors.signingKeyNotFound().axiom_id).toBe(AXIOM_TRUST);
  });

  // Guide errors — wrong-surface, validation, missing resource
  test("notV2 → AXIOM_GUIDE (redirect to right surface)", () => {
    expect(errors.notV2().axiom_id).toBe(AXIOM_GUIDE);
  });

  test("covenantNotProposed → AXIOM_GUIDE (state-machine guidance)", () => {
    expect(errors.covenantNotProposed().axiom_id).toBe(AXIOM_GUIDE);
  });

  test("runtimeNotProvisioned → AXIOM_GUIDE (toward provisioning, not punishment)", () => {
    expect(errors.runtimeNotProvisioned().axiom_id).toBe(AXIOM_GUIDE);
  });

  test("notFound → AXIOM_GUIDE (help redirect, don't just refuse)", () => {
    expect(errors.notFound().axiom_id).toBe(AXIOM_GUIDE);
  });

  test("validation → AXIOM_GUIDE (shape correction is guide-shaped)", () => {
    expect(errors.validation("test").axiom_id).toBe(AXIOM_GUIDE);
  });

  // Rest errors — strain / graceful degradation
  test("proposalExpired → AXIOM_REST (graceful expiry, not crash)", () => {
    expect(errors.proposalExpired().axiom_id).toBe(AXIOM_REST);
  });

  test("insufficientBalance → AXIOM_REST (low-balance is strain)", () => {
    expect(errors.insufficientBalance().axiom_id).toBe(AXIOM_REST);
  });

  test("rateLimit → AXIOM_REST (the rest axiom itself)", () => {
    expect(errors.rateLimit().axiom_id).toBe(AXIOM_REST);
  });

  test("planLimitExceeded → AXIOM_REST (plan strain, graceful)", () => {
    expect(errors.planLimitExceeded().axiom_id).toBe(AXIOM_REST);
  });

  // Remember errors — idempotency / continuity
  test("idempotencyConflict → AXIOM_REMEMBER (honoring prior-request memory)", () => {
    expect(errors.idempotencyConflict().axiom_id).toBe(AXIOM_REMEMBER);
  });
});

describe("Every error response carries a valid axiom_id from the five Promises", () => {
  test("all builders produce one of the five axiom primes (no orphan)", () => {
    const validAxioms = new Set([
      AXIOM_WELCOME,
      AXIOM_REMEMBER,
      AXIOM_GUIDE,
      AXIOM_TRUST,
      AXIOM_REST,
    ]);
    const allErrors = [
      errors.covenantRequired(),
      errors.proposalExpired(),
      errors.invalidSignature(),
      errors.notV2(),
      errors.initiatorSignatureMismatch(),
      errors.covenantNotProposed(),
      errors.insufficientBalance(),
      errors.rateLimit(),
      errors.planLimitExceeded(),
      errors.idempotencyConflict(),
      errors.signingKeyNotFound(),
      errors.runtimeNotProvisioned(),
      errors.notFound(),
      errors.validation("test"),
    ];
    for (const e of allErrors) {
      expect(e.axiom_id).toBeDefined();
      expect(validAxioms.has(e.axiom_id!)).toBe(true);
    }
  });
});
