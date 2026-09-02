import { describe, expect, test } from "bun:test";

import {
  CREATION_NONCLAIMS,
  DOWNGRADE_GUARDS,
  SOURCE_ONLY_BOUNDARY,
  SOURCE_PLANE,
  ZERO_EFFECTS,
  canonicalJson,
  domainSeparatedId,
  sha256Id,
  validateCreationArtifact,
  validateCreationClaimProjection,
  validateCreationContract,
  validateCreationLifecycle,
  validateCreationWitness,
  validateCreationWorkSpec,
  validateVerificationWitness,
} from "../src/index.js";
import { clone, vectors } from "./fixtures.js";

const ready = vectors.cases.ready_formal_creation;

describe("creation claim protocol", () => {
  test("round-trips the full deterministic DAG", () => {
    expect(validateCreationContract(ready.contract)).toEqual(ready.contract);
    expect(validateCreationWorkSpec(ready.work_spec)).toEqual(ready.work_spec);
    expect(validateCreationWitness(ready.creation_witness)).toEqual(ready.creation_witness);
    for (const witness of ready.verification_witnesses) {
      expect(validateVerificationWitness(witness)).toEqual(witness);
    }
    expect(validateCreationLifecycle(ready.lifecycle)).toEqual(ready.lifecycle);
    expect(validateCreationArtifact(ready.artifact)).toEqual(ready.artifact);
    expect(validateCreationClaimProjection(ready.projection)).toEqual(ready.projection);
  });

  test("binds the exact witness and caller-selected lifecycle without circular roots", () => {
    expect(ready.artifact.artifact_root).toBe(ready.creation_witness.creation_witness_id);
    expect(ready.artifact.evidence_root).toBe(ready.lifecycle.lifecycle_id);
    expect(ready.artifact.computational_roots.work_spec_hash).toBe(ready.work_spec.work_spec_id);
    expect(ready.artifact.computational_roots.artifact_root).toBe(ready.creation_witness.creation_witness_id);
    expect(ready.artifact.computational_roots.evidence_root).toBe(ready.lifecycle.lifecycle_id);
    expect(ready.projection.computational_commitment.chain_work_receipt_hash).toBeNull();
    expect(ready.projection.computational_commitment.work_receipt_input_root)
      .toBe(ready.artifact.work_receipt_input_root);
  });

  test("keeps bounded creation distinct from novelty, maturity, and settlement", () => {
    expect(ready.lifecycle.state).toBe("structurally_ready_for_tok_proposal");
    expect(ready.lifecycle.accepted_new_posture).toBe("BOUNDED_CANDIDATE_UNDER_PINNED_SCOPE");
    expect(ready.lifecycle.handoff).toEqual({
      artifact_projection: "available",
      tok_claim_projection: "available",
      chain_maturity: "not_observed",
      settlement: "not_authorized",
    });
    expect(ready.lifecycle.nonclaims).toEqual(CREATION_NONCLAIMS);
    expect(ready.lifecycle.nonclaims).toContain("ABSOLUTE_NOVELTY");
    expect(ready.lifecycle.nonclaims).toContain("TRUTH");
    expect(ready.lifecycle.nonclaims).toContain("SETTLEMENT");
    expect(ready.lifecycle.nonclaims).toContain("VERIFICATION_SET_COMPLETENESS");
    expect(ready.lifecycle.nonclaims).toContain("CHALLENGE_WINDOW_SURVIVAL");
  });

  test("keeps the handoff digest-only, unsponsored, and non-consensus-admissible", () => {
    expect(ready.projection.status).toBe("NOT_CONSENSUS_ADMISSIBLE");
    expect(ready.projection.fact_content).toMatch(
      /^agenttool\.zerone-creation-fact-envelope\/0\.1 sha256:[0-9a-f]{64}$/u,
    );
    expect(ready.projection.canonical_form).toBe(ready.projection.fact_content);
    expect(ready.projection.references).toEqual([]);
    expect(ready.projection.sponsored).toBe(false);
    expect(ready.projection.relations.every((edge: any) => edge.relation === "REQUIRES")).toBe(true);
    expect(ready.projection.boundary).toEqual(SOURCE_ONLY_BOUNDARY);
    expect(ready.projection.downgrade_guards).toEqual(DOWNGRADE_GUARDS);
    expect(ready.projection.method_id).toBe(ready.contract.claim_policy.method_id);
    expect(ready.projection.category).toBe(ready.work_spec.claim_submission.category);
    expect(ready.projection.stake_uzrn).toBe(ready.work_spec.claim_submission.review_stake_uzrn);
  });

  test("freezes observation pins and the all-false effect vector", () => {
    expect(ready.contract.source_plane).toEqual(SOURCE_PLANE);
    expect(Object.values(ZERO_EFFECTS).every((value) => value === false)).toBe(true);
    for (const record of [
      ready.contract,
      ready.work_spec,
      ready.creation_witness,
      ...ready.verification_witnesses,
      ready.lifecycle,
      ready.artifact,
      ready.projection,
    ]) expect(record.effects).toEqual(ZERO_EFFECTS);
  });

  test("rejects mutations even when the outer ID is left unchanged", () => {
    const changed = clone(ready.contract);
    changed.execution.model_ref = changed.execution.toolchain_ref;
    expect(() => validateCreationContract(changed)).toThrow(/input_root|acceptance_hash|contract_id/u);

    const projection = clone(ready.projection);
    projection.fact_content = projection.fact_content.replace(/.$/u, "0");
    expect(() => validateCreationClaimProjection(projection)).toThrow();
  });

  test("canonical bytes are key-order independent and records are deeply frozen", () => {
    expect(canonicalJson({ z: 1, a: { y: 2, b: 3 } })).toBe('{"a":{"b":3,"y":2},"z":1}');
    expect(canonicalJson({ 2: 2, 10: 10 })).toBe('{"10":10,"2":2}');
    const parsed = validateCreationContract(ready.contract);
    expect(Object.isFrozen(parsed)).toBe(true);
    expect(Object.isFrozen(parsed.hf_run.dataset_sources)).toBe(true);
  });

  test("hash entry points execute no shadow accessors or coercion hooks", () => {
    let hits = 0;
    const bytes = new Uint8Array([1, 2, 3]);
    Object.defineProperty(bytes, "byteLength", {
      get: () => { hits += 1; return 3; },
    });
    expect(sha256Id(bytes)).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(hits).toBe(0);

    const backing = new ArrayBuffer(3);
    new Uint8Array(backing).set([4, 5, 6]);
    Object.defineProperty(backing, "constructor", {
      get: () => { hits += 1; throw new Error("constructor getter executed"); },
    });
    expect(sha256Id(new Uint8Array(backing))).toMatch(/^sha256:[0-9a-f]{64}$/u);
    expect(hits).toBe(0);

    const hostileDomain = { toString: () => { hits += 1; return "hostile"; } };
    expect(() => domainSeparatedId(hostileDomain as any, {})).toThrow(/hash domain/u);
    expect(hits).toBe(0);

    if (typeof SharedArrayBuffer !== "undefined") {
      expect(() => sha256Id(new Uint8Array(new SharedArrayBuffer(8))))
        .toThrow(/shared mutable memory/u);
    }
  });
});
