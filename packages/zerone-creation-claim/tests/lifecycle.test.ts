import { describe, expect, test } from "bun:test";

import {
  aggregateCreationLifecycle,
  createCreationArtifact,
  createCreationContract,
  createCreationWitness,
  createCreationWorkSpec,
  createVerificationWitness,
  sha256Id,
} from "../src/index.js";
import {
  clone,
  contractInput,
  creationWitnessInput,
  rebuildVerifications,
  vectors,
  verificationWitnessInput,
  workSpecInput,
} from "./fixtures.js";

const ready = vectors.cases.ready_formal_creation;

function rebuild(input = contractInput(), witnessMutator?: (value: Record<string, any>) => void) {
  const contract = createCreationContract(input as any);
  const workSpec = createCreationWorkSpec(contract, workSpecInput() as any);
  const witnessInput = creationWitnessInput();
  witnessMutator?.(witnessInput);
  const witness = createCreationWitness(contract, workSpec, witnessInput as any);
  const verifications = rebuildVerifications(contract, workSpec, witness);
  return { contract, workSpec, witness, verifications };
}

describe("creation lifecycle", () => {
  test("keeps resource or participation stop honest and penalty-free", () => {
    const stop = vectors.cases.honest_resource_stop;
    expect(stop.lifecycle.state).toBe("honest_terminal");
    expect(stop.lifecycle.blockers).toEqual(["OUTCOME_OFFCHAIN_ONLY"]);
    expect(stop.lifecycle.accepted_new_posture).toBe("not_reached");
    expect(stop.creation_witness.result.candidate_artifact_ref).toBeNull();
    expect(stop.creation_witness.boundary.refusal_or_rest_penalty).toBe(false);
  });

  test("counts at most one pass per declared verifier controller", () => {
    const base = rebuild();
    const original = base.verifications.filter((witness: any) => witness.kind !== "independent_reproduction");
    const firstInput = verificationWitnessInput(
      ready.verification_witnesses.find((witness: any) => witness.kind === "independent_reproduction"),
    );
    const secondInput = clone(firstInput);
    secondInput.verifier.claimed_key_ref = ready.verification_witnesses[0].verifier.claimed_key_ref;
    secondInput.verifier.attestation_ref = ready.verification_witnesses[1].verifier.attestation_ref;
    secondInput.verifier.independence_evidence_ref = ready.verification_witnesses[2].verifier.independence_evidence_ref;
    secondInput.method_ref = ready.verification_witnesses[3].method_ref;
    secondInput.evidence_root = ready.verification_witnesses[4].evidence_root;
    secondInput.observation_ref = ready.verification_witnesses[1].observation_ref;
    const first = createVerificationWitness(base.contract, base.workSpec, base.witness, firstInput as any);
    const second = createVerificationWitness(base.contract, base.workSpec, base.witness, secondInput as any);
    const lifecycle = aggregateCreationLifecycle(base.contract, base.workSpec, base.witness, [
      ...original,
      first,
      second,
    ]);
    const reproduction = lifecycle.requirements.find((requirement) => requirement.kind === "independent_reproduction")!;
    expect(reproduction.counted_passes).toBe("1");
    expect(reproduction.ignored_duplicate_controller_or_key_witness_ids).toHaveLength(1);
    expect(lifecycle.state).toBe("verification_open");
  });

  test("does not count producer self-verification as independent reproduction", () => {
    const base = rebuild();
    const keep = base.verifications.filter((witness: any) =>
      witness.kind !== "independent_reproduction"
      || witness.verification_witness_id === base.verifications.find((candidate: any) =>
        candidate.kind === "independent_reproduction"
      ).verification_witness_id
    );
    const selfInput = verificationWitnessInput(
      ready.verification_witnesses.filter((witness: any) => witness.kind === "independent_reproduction")[1],
    );
    selfInput.verifier.controller_ref = base.witness.producer.wallet_controller_ref;
    const selfWitness = createVerificationWitness(base.contract, base.workSpec, base.witness, selfInput as any);
    const lifecycle = aggregateCreationLifecycle(base.contract, base.workSpec, base.witness, [...keep, selfWitness]);
    const reproduction = lifecycle.requirements.find((requirement) => requirement.kind === "independent_reproduction")!;
    expect(reproduction.counted_passes).toBe("1");
    expect(reproduction.ignored_non_independent_witness_ids).toEqual([selfWitness.verification_witness_id]);
    expect(lifecycle.state).toBe("verification_open");
  });

  test("does not count the producer key or a reused verifier key as independent", () => {
    const base = rebuild();
    const reproductions = base.verifications.filter((witness: any) =>
      witness.kind === "independent_reproduction"
    );
    const nonReproductions = base.verifications.filter((witness: any) =>
      witness.kind !== "independent_reproduction"
    );

    const producerKeyInput = verificationWitnessInput(reproductions[1]);
    producerKeyInput.verifier.claimed_key_ref = base.witness.producer.producer_key_ref;
    const producerKeyWitness = createVerificationWitness(
      base.contract,
      base.workSpec,
      base.witness,
      producerKeyInput as any,
    );
    const producerKeyLifecycle = aggregateCreationLifecycle(
      base.contract,
      base.workSpec,
      base.witness,
      [...nonReproductions, reproductions[0], producerKeyWitness],
    );
    const producerKeyAssessment = producerKeyLifecycle.requirements.find((entry) =>
      entry.kind === "independent_reproduction"
    )!;
    expect(producerKeyAssessment.counted_passes).toBe("1");
    expect(producerKeyAssessment.ignored_non_independent_witness_ids)
      .toEqual([producerKeyWitness.verification_witness_id]);

    const reusedKeyInput = verificationWitnessInput(reproductions[1]);
    reusedKeyInput.verifier.claimed_key_ref = reproductions[0].verifier.claimed_key_ref;
    const reusedKeyWitness = createVerificationWitness(
      base.contract,
      base.workSpec,
      base.witness,
      reusedKeyInput as any,
    );
    const reusedKeyLifecycle = aggregateCreationLifecycle(
      base.contract,
      base.workSpec,
      base.witness,
      [...nonReproductions, reproductions[0], reusedKeyWitness],
    );
    const reusedKeyAssessment = reusedKeyLifecycle.requirements.find((entry) =>
      entry.kind === "independent_reproduction"
    )!;
    expect(reusedKeyAssessment.counted_passes).toBe("1");
    expect(reusedKeyAssessment.ignored_duplicate_controller_or_key_witness_ids).toHaveLength(1);
    expect([
      reproductions[0].verification_witness_id,
      reusedKeyWitness.verification_witness_id,
    ]).toContain(reusedKeyAssessment.ignored_duplicate_controller_or_key_witness_ids[0]);
  });

  test("keeps contradictory evidence visible even after a passing threshold", () => {
    const base = rebuild();
    const pass = ready.verification_witnesses.find((witness: any) => witness.kind === "semantic_fidelity");
    const failedInput = verificationWitnessInput(pass);
    failedInput.outcome = "failed";
    failedInput.verifier.controller_ref = ready.verification_witnesses[4].verifier.controller_ref;
    failedInput.verifier.attestation_ref = ready.verification_witnesses[4].verifier.attestation_ref;
    failedInput.evidence_root = ready.verification_witnesses[4].evidence_root;
    const failed = createVerificationWitness(base.contract, base.workSpec, base.witness, failedInput as any);
    const lifecycle = aggregateCreationLifecycle(
      base.contract,
      base.workSpec,
      base.witness,
      [...base.verifications, failed],
    );
    const semantic = lifecycle.requirements.find((requirement) => requirement.kind === "semantic_fidelity")!;
    expect(semantic.counted_passes).toBe("1");
    expect(semantic.failed_witness_ids).toEqual([failed.verification_witness_id]);
    expect(semantic.status).toBe("contested");
    expect(lifecycle.state).toBe("contested");
    expect(lifecycle.blockers).toContain("VERIFICATION_CONTESTED");
    expect(() => createCreationArtifact(
      base.contract,
      base.workSpec,
      base.witness,
      [...base.verifications, failed],
      lifecycle,
    )).toThrow(/not structurally ready/u);
  });

  test("represents every counted pass up to the global verifier bound", () => {
    const base = rebuild();
    const nonSemantic = base.verifications.filter((witness: any) => witness.kind !== "semantic_fidelity");
    const template = ready.verification_witnesses.find((witness: any) => witness.kind === "semantic_fidelity");
    const semantic = Array.from({ length: 17 }, (_, index) => {
      const input = verificationWitnessInput(template);
      input.verifier.controller_ref = sha256Id(`semantic-controller-${String(index)}`);
      input.verifier.claimed_key_ref = sha256Id(`semantic-key-${String(index)}`);
      input.verifier.attestation_ref = sha256Id(`semantic-attestation-${String(index)}`);
      input.verifier.relation_to_producer = "unknown";
      input.verifier.independence_evidence_ref = null;
      return createVerificationWitness(base.contract, base.workSpec, base.witness, input as any);
    });
    const lifecycle = aggregateCreationLifecycle(
      base.contract,
      base.workSpec,
      base.witness,
      [...nonSemantic, ...semantic],
    );
    const assessment = lifecycle.requirements.find((requirement) => requirement.kind === "semantic_fidelity")!;
    expect(assessment.counted_passes).toBe("17");
    expect(assessment.passed_witness_ids).toHaveLength(17);
  });

  test("blocks projection when publication authority is absent", () => {
    const input = contractInput();
    input.authorities.publication_authority_ref = null;
    const base = rebuild(input);
    const lifecycle = aggregateCreationLifecycle(
      base.contract,
      base.workSpec,
      base.witness,
      base.verifications,
    );
    expect(lifecycle.state).toBe("projection_blocked");
    expect(lifecycle.blockers).toEqual(["PUBLICATION_AUTHORITY_MISSING"]);
  });

  test("blocks public projection while confidential material is present", () => {
    const base = rebuild(contractInput(), (input) => {
      input.result.confidential_material_present = true;
    });
    const lifecycle = aggregateCreationLifecycle(
      base.contract,
      base.workSpec,
      base.witness,
      base.verifications,
    );
    expect(lifecycle.state).toBe("projection_blocked");
    expect(lifecycle.blockers).toEqual(["CONFIDENTIAL_MATERIAL_PRESENT"]);
  });
});
