import { deepFreeze, domainSeparatedId } from "./canonical.js";
import {
  ARTIFACT_KINDS,
  CREATION_NONCLAIMS,
  CREATION_OUTCOMES,
  FORMATS,
  HASH_DOMAINS,
  MAX_ARRAY_ITEMS,
  SOURCE_ONLY_BOUNDARY,
  VERIFICATION_KINDS,
  VERIFICATION_OUTCOMES,
  VERIFIER_RELATIONS,
  ZERO_EFFECTS,
} from "./constants.js";
import {
  assertWorkSpecMatchesContract,
  parseResourceCounters,
} from "./contract.js";
import { fail } from "./errors.js";
import type {
  CreateCreationWitnessInput,
  CreateVerificationWitnessInput,
  CreationContract,
  CreationWitness,
  CreationWitnessCore,
  CreationWorkSpec,
  VerificationWitness,
  VerificationWitnessCore,
} from "./types.js";
import {
  assertSame,
  booleanValue,
  enumValue,
  exactKeys,
  literal,
  nullableSha256,
  record,
  sha256,
  snapshotRecord,
  sortedUniqueDigests,
  withoutKeys,
  zeroneAddress,
} from "./validation.js";

const CREATION_WITNESS_CORE_KEYS = [
  "_format",
  "artifact_kind",
  "boundary",
  "completed_observation_ref",
  "contract_id",
  "declaration",
  "effects",
  "nonclaims",
  "outcome",
  "producer",
  "resource_usage",
  "result",
  "run",
  "started_observation_ref",
  "work_spec_id",
] as const;

const VERIFICATION_WITNESS_CORE_KEYS = [
  "_format",
  "boundary",
  "contract_id",
  "creation_witness_id",
  "declaration",
  "effects",
  "environment_root",
  "evidence_root",
  "kind",
  "limitation_refs",
  "method_ref",
  "nonclaims",
  "observation_ref",
  "outcome",
  "policy_ref",
  "verifier",
] as const;

export function validateCreationWitnessCore(value: unknown): CreationWitnessCore {
  const item = snapshotRecord(value);
  exactKeys(item, CREATION_WITNESS_CORE_KEYS, "$");
  if (item._format !== FORMATS.creation_witness) {
    fail("invalid_record", `_format must be ${FORMATS.creation_witness}`, "$._format");
  }
  const producer = record(item.producer, "$.producer");
  exactKeys(producer, [
    "account_address",
    "producer_identity_ref",
    "producer_key_ref",
    "wallet_binding_ref",
    "wallet_controller_ref",
  ], "$.producer");
  const run = record(item.run, "$.run");
  exactKeys(run, [
    "checkpoint_ref",
    "environment_root",
    "input_root",
    "model_ref",
    "run_ref",
    "seed_policy_ref",
    "toolchain_ref",
  ], "$.run");
  const result = record(item.result, "$.result");
  exactKeys(result, [
    "candidate_artifact_ref",
    "confidential_material_present",
    "execution_evidence_ref",
    "public_summary_ref",
    "statement_or_behavior_ref",
  ], "$.result");
  if (item.declaration !== "PRODUCER_REPORTED_NOT_INDEPENDENTLY_VERIFIED") {
    fail("invalid_record", "creation witness must retain its producer-report boundary", "$.declaration");
  }
  literal(item.nonclaims, CREATION_NONCLAIMS, "$.nonclaims");
  literal(item.boundary, SOURCE_ONLY_BOUNDARY, "$.boundary");
  literal(item.effects, ZERO_EFFECTS, "$.effects");
  const outcome = enumValue(item.outcome, CREATION_OUTCOMES, "$.outcome");
  const candidateArtifactRef = nullableSha256(result.candidate_artifact_ref, "$.result.candidate_artifact_ref");
  const statementRef = nullableSha256(result.statement_or_behavior_ref, "$.result.statement_or_behavior_ref");
  const publicSummaryRef = nullableSha256(result.public_summary_ref, "$.result.public_summary_ref");
  if (outcome === "bounded_answer" && (candidateArtifactRef === null || statementRef === null)) {
    fail("invalid_record", "a bounded answer requires exact candidate and statement/behavior references", "$.result");
  }
  if (
    outcome === "resource_or_participation_stop"
    && (candidateArtifactRef !== null || statementRef !== null || publicSummaryRef !== null)
  ) {
    fail("invalid_record", "an honest resource or participation stop must not manufacture a candidate", "$.result");
  }
  return deepFreeze({
    _format: FORMATS.creation_witness,
    contract_id: sha256(item.contract_id, "$.contract_id"),
    work_spec_id: sha256(item.work_spec_id, "$.work_spec_id"),
    producer: {
      account_address: zeroneAddress(producer.account_address, "$.producer.account_address"),
      producer_identity_ref: sha256(producer.producer_identity_ref, "$.producer.producer_identity_ref"),
      producer_key_ref: sha256(producer.producer_key_ref, "$.producer.producer_key_ref"),
      wallet_controller_ref: sha256(producer.wallet_controller_ref, "$.producer.wallet_controller_ref"),
      wallet_binding_ref: sha256(producer.wallet_binding_ref, "$.producer.wallet_binding_ref"),
    },
    outcome,
    artifact_kind: enumValue(item.artifact_kind, ARTIFACT_KINDS, "$.artifact_kind"),
    run: {
      run_ref: sha256(run.run_ref, "$.run.run_ref"),
      input_root: sha256(run.input_root, "$.run.input_root"),
      environment_root: sha256(run.environment_root, "$.run.environment_root"),
      model_ref: sha256(run.model_ref, "$.run.model_ref"),
      toolchain_ref: sha256(run.toolchain_ref, "$.run.toolchain_ref"),
      seed_policy_ref: sha256(run.seed_policy_ref, "$.run.seed_policy_ref"),
      checkpoint_ref: sha256(run.checkpoint_ref, "$.run.checkpoint_ref"),
    },
    result: {
      candidate_artifact_ref: candidateArtifactRef,
      statement_or_behavior_ref: statementRef,
      execution_evidence_ref: sha256(result.execution_evidence_ref, "$.result.execution_evidence_ref"),
      public_summary_ref: publicSummaryRef,
      confidential_material_present: booleanValue(
        result.confidential_material_present,
        "$.result.confidential_material_present",
      ),
    },
    resource_usage: parseResourceCounters(item.resource_usage, "$.resource_usage"),
    started_observation_ref: sha256(item.started_observation_ref, "$.started_observation_ref"),
    completed_observation_ref: sha256(item.completed_observation_ref, "$.completed_observation_ref"),
    declaration: "PRODUCER_REPORTED_NOT_INDEPENDENTLY_VERIFIED",
    nonclaims: CREATION_NONCLAIMS,
    boundary: SOURCE_ONLY_BOUNDARY,
    effects: ZERO_EFFECTS,
  }) as CreationWitnessCore;
}

function assertUsageWithinLimits(
  witness: CreationWitnessCore,
  workSpec: CreationWorkSpec,
): void {
  for (const key of [
    "compute_millis",
    "accelerator_millis",
    "memory_byte_millis",
    "input_bytes",
    "output_bytes",
  ] as const) {
    if (BigInt(witness.resource_usage[key]) > BigInt(workSpec.resource_limits[key])) {
      fail("contract_mismatch", `resource_usage.${key} exceeds the frozen WorkSpec limit`, `$.resource_usage.${key}`);
    }
  }
}

function assertOutcomeRouteResult(
  contract: CreationContract,
  witness: CreationWitnessCore,
): void {
  const route = contract.outcome_routes.find((entry) => entry.outcome === witness.outcome)!;
  if (
    route.tok_posture === "digest_fact_candidate"
    && (witness.result.public_summary_ref === null || witness.result.candidate_artifact_ref === null)
  ) {
    fail(
      "contract_mismatch",
      "a ToK-routed outcome requires exact candidate-artifact and digest-only public-summary references",
      "$.result",
    );
  }
}

export function createCreationWitness(
  contractValue: CreationContract,
  workSpecValue: CreationWorkSpec,
  input: CreateCreationWitnessInput,
): CreationWitness {
  const { contract, work_spec: workSpec } = assertWorkSpecMatchesContract(contractValue, workSpecValue);
  const safe = snapshotRecord(input);
  const core = validateCreationWitnessCore({
    ...safe,
    _format: FORMATS.creation_witness,
    contract_id: contract.contract_id,
    work_spec_id: workSpec.work_spec_id,
    declaration: "PRODUCER_REPORTED_NOT_INDEPENDENTLY_VERIFIED",
    nonclaims: CREATION_NONCLAIMS,
    boundary: SOURCE_ONLY_BOUNDARY,
    effects: ZERO_EFFECTS,
  });
  assertSame(core.artifact_kind, contract.artifact_kind, "creation_witness.artifact_kind");
  assertSame(core.producer.account_address, workSpec.worker.account_address, "creation_witness.producer.account_address");
  assertSame(core.producer.producer_identity_ref, workSpec.worker.producer_identity_ref, "creation_witness.producer.producer_identity_ref");
  assertSame(core.producer.producer_key_ref, workSpec.worker.producer_key_ref, "creation_witness.producer.producer_key_ref");
  assertSame(core.producer.wallet_controller_ref, workSpec.worker.wallet_controller_ref, "creation_witness.producer.wallet_controller_ref");
  assertSame(core.producer.wallet_binding_ref, workSpec.worker.wallet_binding_ref, "creation_witness.producer.wallet_binding_ref");
  assertSame(core.run.input_root, contract.input_root, "creation_witness.run.input_root");
  assertSame(core.run.environment_root, contract.execution.environment_root, "creation_witness.run.environment_root");
  assertSame(core.run.model_ref, contract.execution.model_ref, "creation_witness.run.model_ref");
  assertSame(core.run.toolchain_ref, contract.execution.toolchain_ref, "creation_witness.run.toolchain_ref");
  assertSame(core.run.seed_policy_ref, contract.hf_run.seed_policy_ref, "creation_witness.run.seed_policy_ref");
  assertSame(core.run.checkpoint_ref, contract.hf_run.checkpoint_ref, "creation_witness.run.checkpoint_ref");
  assertOutcomeRouteResult(contract, core);
  assertUsageWithinLimits(core, workSpec);
  return deepFreeze({
    ...core,
    creation_witness_id: domainSeparatedId(HASH_DOMAINS.creation_witness, core),
  }) as CreationWitness;
}

export function validateCreationWitness(value: unknown): CreationWitness {
  const item = snapshotRecord(value);
  exactKeys(item, [...CREATION_WITNESS_CORE_KEYS, "creation_witness_id"], "$");
  const core = validateCreationWitnessCore(withoutKeys(item, ["creation_witness_id"]));
  const id = sha256(item.creation_witness_id, "$.creation_witness_id");
  assertSame(
    id,
    domainSeparatedId(HASH_DOMAINS.creation_witness, core),
    "$.creation_witness_id",
    "creation_witness_id does not match canonical bytes",
  );
  return deepFreeze({ ...core, creation_witness_id: id }) as CreationWitness;
}

export function assertCreationWitnessMatches(
  contractValue: CreationContract,
  workSpecValue: CreationWorkSpec,
  witnessValue: CreationWitness,
): {
  readonly contract: CreationContract;
  readonly work_spec: CreationWorkSpec;
  readonly creation_witness: CreationWitness;
} {
  const { contract, work_spec: workSpec } = assertWorkSpecMatchesContract(contractValue, workSpecValue);
  const witness = validateCreationWitness(witnessValue);
  assertSame(witness.contract_id, contract.contract_id, "creation_witness.contract_id");
  assertSame(witness.work_spec_id, workSpec.work_spec_id, "creation_witness.work_spec_id");
  assertSame(witness.artifact_kind, contract.artifact_kind, "creation_witness.artifact_kind");
  assertSame(witness.producer.account_address, workSpec.worker.account_address, "creation_witness.producer.account_address");
  assertSame(
    witness.producer.producer_identity_ref,
    workSpec.worker.producer_identity_ref,
    "creation_witness.producer.producer_identity_ref",
  );
  assertSame(
    witness.producer.producer_key_ref,
    workSpec.worker.producer_key_ref,
    "creation_witness.producer.producer_key_ref",
  );
  assertSame(
    witness.producer.wallet_controller_ref,
    workSpec.worker.wallet_controller_ref,
    "creation_witness.producer.wallet_controller_ref",
  );
  assertSame(
    witness.producer.wallet_binding_ref,
    workSpec.worker.wallet_binding_ref,
    "creation_witness.producer.wallet_binding_ref",
  );
  assertSame(witness.run.input_root, contract.input_root, "creation_witness.run.input_root");
  assertSame(witness.run.environment_root, contract.execution.environment_root, "creation_witness.run.environment_root");
  assertSame(witness.run.model_ref, contract.execution.model_ref, "creation_witness.run.model_ref");
  assertSame(witness.run.toolchain_ref, contract.execution.toolchain_ref, "creation_witness.run.toolchain_ref");
  assertSame(witness.run.seed_policy_ref, contract.hf_run.seed_policy_ref, "creation_witness.run.seed_policy_ref");
  assertSame(witness.run.checkpoint_ref, contract.hf_run.checkpoint_ref, "creation_witness.run.checkpoint_ref");
  assertOutcomeRouteResult(contract, witness);
  assertUsageWithinLimits(witness, workSpec);
  return deepFreeze({ contract, work_spec: workSpec, creation_witness: witness });
}

export function validateVerificationWitnessCore(value: unknown): VerificationWitnessCore {
  const item = snapshotRecord(value);
  exactKeys(item, VERIFICATION_WITNESS_CORE_KEYS, "$");
  if (item._format !== FORMATS.verification_witness) {
    fail("invalid_record", `_format must be ${FORMATS.verification_witness}`, "$._format");
  }
  const verifier = record(item.verifier, "$.verifier");
  exactKeys(verifier, [
    "attestation_ref",
    "claimed_key_ref",
    "controller_ref",
    "independence_evidence_ref",
    "relation_to_producer",
  ], "$.verifier");
  const relation = enumValue(
    verifier.relation_to_producer,
    VERIFIER_RELATIONS,
    "$.verifier.relation_to_producer",
  );
  const independenceEvidence = nullableSha256(
    verifier.independence_evidence_ref,
    "$.verifier.independence_evidence_ref",
  );
  if (relation === "declared_independent" && independenceEvidence === null) {
    fail("invalid_record", "declared independence requires a separate evidence reference", "$.verifier");
  }
  if (relation !== "declared_independent" && independenceEvidence !== null) {
    fail("invalid_record", "non-independent or unknown relation cannot carry an independence claim", "$.verifier");
  }
  if (item.declaration !== "CALLER_REPORTED_ATTESTATION_REFERENCE_NOT_VERIFIED") {
    fail("invalid_record", "verification witness must retain its attestation boundary", "$.declaration");
  }
  literal(item.nonclaims, CREATION_NONCLAIMS, "$.nonclaims");
  literal(item.boundary, SOURCE_ONLY_BOUNDARY, "$.boundary");
  literal(item.effects, ZERO_EFFECTS, "$.effects");
  return deepFreeze({
    _format: FORMATS.verification_witness,
    contract_id: sha256(item.contract_id, "$.contract_id"),
    creation_witness_id: sha256(item.creation_witness_id, "$.creation_witness_id"),
    kind: enumValue(item.kind, VERIFICATION_KINDS, "$.kind"),
    outcome: enumValue(item.outcome, VERIFICATION_OUTCOMES, "$.outcome"),
    verifier: {
      controller_ref: sha256(verifier.controller_ref, "$.verifier.controller_ref"),
      claimed_key_ref: sha256(verifier.claimed_key_ref, "$.verifier.claimed_key_ref"),
      attestation_ref: sha256(verifier.attestation_ref, "$.verifier.attestation_ref"),
      relation_to_producer: relation,
      independence_evidence_ref: independenceEvidence,
    },
    method_ref: sha256(item.method_ref, "$.method_ref"),
    policy_ref: sha256(item.policy_ref, "$.policy_ref"),
    environment_root: sha256(item.environment_root, "$.environment_root"),
    evidence_root: sha256(item.evidence_root, "$.evidence_root"),
    limitation_refs: sortedUniqueDigests(item.limitation_refs, "$.limitation_refs", 0, MAX_ARRAY_ITEMS),
    observation_ref: sha256(item.observation_ref, "$.observation_ref"),
    declaration: "CALLER_REPORTED_ATTESTATION_REFERENCE_NOT_VERIFIED",
    nonclaims: CREATION_NONCLAIMS,
    boundary: SOURCE_ONLY_BOUNDARY,
    effects: ZERO_EFFECTS,
  }) as VerificationWitnessCore;
}

export function createVerificationWitness(
  contractValue: CreationContract,
  workSpecValue: CreationWorkSpec,
  creationWitnessValue: CreationWitness,
  input: CreateVerificationWitnessInput,
): VerificationWitness {
  const { contract, creation_witness: creationWitness } = assertCreationWitnessMatches(
    contractValue,
    workSpecValue,
    creationWitnessValue,
  );
  const safe = snapshotRecord(input);
  const core = validateVerificationWitnessCore({
    ...safe,
    _format: FORMATS.verification_witness,
    contract_id: contract.contract_id,
    creation_witness_id: creationWitness.creation_witness_id,
    declaration: "CALLER_REPORTED_ATTESTATION_REFERENCE_NOT_VERIFIED",
    nonclaims: CREATION_NONCLAIMS,
    boundary: SOURCE_ONLY_BOUNDARY,
    effects: ZERO_EFFECTS,
  });
  const route = contract.outcome_routes.find((entry) => entry.outcome === creationWitness.outcome)!;
  const requirement = route.requirements.find((entry) => entry.kind === core.kind);
  if (requirement === undefined) {
    fail("contract_mismatch", "verification kind is not selected by the creation outcome route", "$.kind");
  }
  assertSame(
    core.policy_ref,
    requirement.policy_ref,
    "verification_witness.policy_ref",
    "verification witness must bind the selected requirement policy",
  );
  return deepFreeze({
    ...core,
    verification_witness_id: domainSeparatedId(HASH_DOMAINS.verification_witness, core),
  }) as VerificationWitness;
}

export function validateVerificationWitness(value: unknown): VerificationWitness {
  const item = snapshotRecord(value);
  exactKeys(item, [...VERIFICATION_WITNESS_CORE_KEYS, "verification_witness_id"], "$");
  const core = validateVerificationWitnessCore(withoutKeys(item, ["verification_witness_id"]));
  const id = sha256(item.verification_witness_id, "$.verification_witness_id");
  assertSame(
    id,
    domainSeparatedId(HASH_DOMAINS.verification_witness, core),
    "$.verification_witness_id",
    "verification_witness_id does not match canonical bytes",
  );
  return deepFreeze({ ...core, verification_witness_id: id }) as VerificationWitness;
}
