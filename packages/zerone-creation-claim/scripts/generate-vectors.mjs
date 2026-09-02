import { readFile, writeFile } from "node:fs/promises";

import {
  CREATION_OUTCOMES,
  CreationClaimError,
  FORMATS,
  SOURCE_PLANE,
  aggregateCreationLifecycle,
  compareUnicode,
  createCreationArtifact,
  createCreationContract,
  createCreationWitness,
  createCreationWorkSpec,
  createVerificationWitness,
  projectCreationClaim,
  sha256Id,
  validateCreationClaimProjection,
} from "../dist/index.js";

const check = process.argv.includes("--check");
const ref = (label) => sha256Id(`agenttool.zerone-creation-claim.vector:${label}`);

function requirements() {
  return [
    ["formal_validity", "1", "not_required"],
    ["semantic_fidelity", "1", "not_required"],
    ["prior_art_scope", "1", "not_required"],
    ["independent_reproduction", "2", "distinct_from_producer_required"],
  ].map(([kind, minimum_passes, independence]) => ({
    kind,
    minimum_passes,
    independence,
    policy_ref: ref(`requirement:${kind}`),
  }));
}

function contractInput() {
  const train = {
    repository_ref: ref("dataset:synthetic-proof-repo"),
    revision: "1111111111111111111111111111111111111111",
    content_root: ref("dataset:synthetic-proof-content"),
    admission_ref: ref("dataset:synthetic-proof-admission"),
    license_evidence_ref: ref("dataset:synthetic-proof-license-evidence"),
    role: "train",
    material_status: "material_bound",
  };
  const fineMathMetadata = {
    repository_ref: ref("dataset:finemath-repo"),
    revision: SOURCE_PLANE.hf_finemath_observation_revision,
    content_root: ref("dataset:finemath-metadata-only"),
    admission_ref: ref("dataset:finemath-metadata-observation"),
    license_evidence_ref: ref("dataset:finemath-license-unknown"),
    role: "reference_only",
    material_status: "metadata_only",
  };
  const datasetSources = [train, fineMathMetadata]
    .sort((left, right) => compareUnicode(`${left.repository_ref}/${left.revision}`, `${right.repository_ref}/${right.revision}`));
  return {
    lane: "formal_math",
    artifact_kind: "formal_result",
    claim_policy: {
      category: "formal",
      method_id: "M-FORMAL",
      methodology_registry_evidence_ref: ref("methodology:M-FORMAL:registry"),
      methodology_observation_status: "caller_declared_not_verified",
      max_review_stake_uzrn: "100",
    },
    math_card: {
      card_id: ref("math-card"),
      assessment_id: ref("math-card-assessment"),
      assessment_status: "ready_for_bounded_inquiry",
      validation_ref: ref("math-card-validation"),
    },
    target: {
      object_ref: ref("target:statement"),
      baseline_ref: ref("target:baseline"),
      status_evidence_ref: ref("target:open-status"),
      prior_art_scope_ref: ref("target:prior-art-scope"),
      prior_art_cutoff_ref: ref("target:prior-art-cutoff"),
    },
    hf_run: {
      dataset_sources: datasetSources,
      training_input_roots: [train.content_root],
      split_manifest_ref: ref("run:splits"),
      role_manifest_ref: ref("run:roles"),
      transform_manifest_ref: ref("run:transforms"),
      tokenizer_ref: ref("run:tokenizer"),
      presentation_multiplicity_ref: ref("run:multiplicity"),
      mixture_weights_ref: ref("run:mixture-weights"),
      order_ref: ref("run:order"),
      optimizer_ref: ref("run:optimizer"),
      seed_policy_ref: ref("run:seeds"),
      checkpoint_ref: ref("run:checkpoint"),
    },
    authorities: {
      data_use_ref: ref("authority:data-use"),
      compute_ref: ref("authority:compute"),
      publication_authority_ref: ref("authority:publication"),
      target_authorization_ref: null,
      engagement_scope_ref: null,
      cyber: {
        provider: "none",
        access_tier: "not_used",
        provider_access_ref: null,
        provider_policy_ref: null,
      },
    },
    execution: {
      model_ref: ref("execution:model"),
      toolchain_ref: ref("execution:toolchain"),
      environment_root: ref("execution:environment"),
      isolation_policy_ref: ref("execution:isolation"),
      disclosure_policy_ref: ref("execution:disclosure"),
    },
    outcome_routes: CREATION_OUTCOMES.map((outcome) => outcome === "bounded_answer"
      ? {
          outcome,
          tok_posture: "digest_fact_candidate",
          settlement_posture: "separate_activation_required",
          requirements: requirements(),
        }
      : {
          outcome,
          tok_posture: "offchain_only",
          settlement_posture: "not_requested",
          requirements: [],
        }),
  };
}

function workSpecInput() {
  const worker = "zrn142424242424242424242424242424242jzr622";
  return {
    chain_profile: {
      chain_id: "zerone-creation-private-1",
      integrated_source_revision: "2222222222222222222222222222222222222222",
      knowledge_module_version: "7",
      sponsorship_module_version: "2",
      binary_ref: ref("chain:binary"),
      genesis_ref: ref("chain:genesis"),
      version_map_ref: ref("chain:version-map"),
      migration_evidence_ref: ref("chain:migration"),
      bounty_roundtrip_evidence_ref: ref("chain:bounty-roundtrip"),
      claim_roundtrip_evidence_ref: ref("chain:claim-roundtrip"),
      private_disposable_chain_declared: true,
      observation_status: "caller_declared_not_verified",
    },
    sponsor: {
      account_address: "zrn1hwamhwamhwamhwamhwamhwamhwamhwamqu58lc",
      wallet_controller_ref: ref("sponsor:wallet-controller"),
      bounty_escrow_authorization_ref: ref("sponsor:bounty-escrow-authorization"),
    },
    worker: {
      account_address: worker,
      producer_identity_ref: ref("worker:provenance-identity"),
      producer_key_ref: ref("worker:secp256k1-key"),
      wallet_controller_ref: ref("worker:wallet-controller"),
      wallet_binding_ref: ref("worker:key-control-binding"),
      binding_claim: "KEY_CONTROL_ONLY_NOT_IDENTITY_AUTHORSHIP_CONSENT_OR_AUTHORITY",
    },
    payee_address: worker,
    fulfillment_caller_address: worker,
    knowledge_domain: "mathematics",
    target_tree: {
      tree_id: "mathematics",
      base_root: ref("tok:base-root"),
      parent_fact_ids: ["fact-prerequisite-a", "fact-prerequisite-b"],
      transition_kind: "add_fact",
      relation_support: "requires_only",
    },
    claim_submission: {
      category: "formal",
      method_id: "M-FORMAL",
      methodology_registry_evidence_ref: ref("methodology:M-FORMAL:registry"),
      review_stake_uzrn: "10",
      review_stake_payer_address: worker,
      review_stake_funding_ref: ref("worker:review-stake-funding"),
      transaction_fee_payer_address: worker,
      transaction_fee_reservation_ref: ref("worker:transaction-fee-reservation"),
      funding_observation_status: "caller_declared_reserved_not_verified",
    },
    resource_limits: {
      compute_millis: "100000",
      accelerator_millis: "50000",
      memory_byte_millis: "1000000000",
      input_bytes: "1000000",
      output_bytes: "1000000",
    },
    settlement: {
      denom: "uzrn",
      price_per_artifact_uzrn: "1000",
      target_count: "1",
      duration_blocks: "1000",
      min_corroborations: "2",
      prefunded_escrow_required: true,
      prefunded_escrow_uzrn: "1000",
      bounty_escrow_reservation_ref: ref("sponsor:bounty-escrow-reservation"),
      funding_observation_status: "caller_declared_reserved_not_verified",
      minting_allowed: false,
    },
  };
}

function boundedWitnessInput(contract, workSpec) {
  return {
    producer: {
      account_address: workSpec.worker.account_address,
      producer_identity_ref: workSpec.worker.producer_identity_ref,
      producer_key_ref: workSpec.worker.producer_key_ref,
      wallet_controller_ref: workSpec.worker.wallet_controller_ref,
      wallet_binding_ref: workSpec.worker.wallet_binding_ref,
    },
    outcome: "bounded_answer",
    artifact_kind: contract.artifact_kind,
    run: {
      run_ref: ref("run:receipt"),
      input_root: contract.input_root,
      environment_root: contract.execution.environment_root,
      model_ref: contract.execution.model_ref,
      toolchain_ref: contract.execution.toolchain_ref,
      seed_policy_ref: contract.hf_run.seed_policy_ref,
      checkpoint_ref: contract.hf_run.checkpoint_ref,
    },
    result: {
      candidate_artifact_ref: ref("result:formal-artifact"),
      statement_or_behavior_ref: ref("result:statement"),
      execution_evidence_ref: ref("result:execution-evidence"),
      public_summary_ref: ref("result:public-summary"),
      confidential_material_present: false,
    },
    resource_usage: {
      compute_millis: "1200",
      accelerator_millis: "0",
      memory_byte_millis: "800000",
      input_bytes: "4096",
      output_bytes: "8192",
    },
    started_observation_ref: ref("run:started-observation"),
    completed_observation_ref: ref("run:completed-observation"),
  };
}

function verificationInput(kind, index, overrides = {}) {
  const route = contract.outcome_routes.find((entry) => entry.outcome === "bounded_answer");
  const requirement = route.requirements.find((entry) => entry.kind === kind);
  return {
    kind,
    outcome: "passed",
    verifier: {
      controller_ref: ref(`verifier:${kind}:${index}:controller`),
      claimed_key_ref: ref(`verifier:${kind}:${index}:key`),
      attestation_ref: ref(`verifier:${kind}:${index}:attestation`),
      relation_to_producer: "declared_independent",
      independence_evidence_ref: ref(`verifier:${kind}:${index}:independence`),
    },
    method_ref: ref(`verifier:${kind}:${index}:method`),
    policy_ref: requirement.policy_ref,
    environment_root: ref(`verifier:${kind}:${index}:environment`),
    evidence_root: ref(`verifier:${kind}:${index}:evidence`),
    limitation_refs: [],
    observation_ref: ref(`verifier:${kind}:${index}:observation`),
    ...overrides,
  };
}

function errorOf(action) {
  try {
    action();
    throw new Error("expected protocol error");
  } catch (error) {
    if (!(error instanceof CreationClaimError)) throw error;
    return { name: error.name, code: error.code, message: error.message, path: error.path };
  }
}

const contract = createCreationContract(contractInput());
const workSpec = createCreationWorkSpec(contract, workSpecInput());
const creationWitness = createCreationWitness(contract, workSpec, boundedWitnessInput(contract, workSpec));
const verificationWitnesses = [
  createVerificationWitness(contract, workSpec, creationWitness, verificationInput("formal_validity", 0)),
  createVerificationWitness(contract, workSpec, creationWitness, verificationInput("semantic_fidelity", 0)),
  createVerificationWitness(contract, workSpec, creationWitness, verificationInput("prior_art_scope", 0)),
  createVerificationWitness(contract, workSpec, creationWitness, verificationInput("independent_reproduction", 0)),
  createVerificationWitness(contract, workSpec, creationWitness, verificationInput("independent_reproduction", 1)),
];
const lifecycle = aggregateCreationLifecycle(contract, workSpec, creationWitness, verificationWitnesses);
const artifact = createCreationArtifact(
  contract,
  workSpec,
  creationWitness,
  verificationWitnesses,
  lifecycle,
);
const projection = projectCreationClaim(
  contract,
  workSpec,
  creationWitness,
  verificationWitnesses,
  lifecycle,
  artifact,
);

const stopWitnessInput = boundedWitnessInput(contract, workSpec);
stopWitnessInput.outcome = "resource_or_participation_stop";
stopWitnessInput.result = {
  candidate_artifact_ref: null,
  statement_or_behavior_ref: null,
  execution_evidence_ref: ref("stop:execution-evidence"),
  public_summary_ref: null,
  confidential_material_present: false,
};
const stopWitness = createCreationWitness(contract, workSpec, stopWitnessInput);
const stopLifecycle = aggregateCreationLifecycle(contract, workSpec, stopWitness, []);

const metadataLeakInput = structuredClone(contractInput());
const metadataSource = metadataLeakInput.hf_run.dataset_sources.find((source) => source.material_status === "metadata_only");
metadataSource.role = "train";
metadataLeakInput.hf_run.training_input_roots = metadataLeakInput.hf_run.dataset_sources
  .filter((source) => source.role === "train")
  .map((source) => source.content_root)
  .sort(compareUnicode);

const relationDowngrade = structuredClone(projection);
relationDowngrade.relations[0].relation = "CONTRADICTS";
relationDowngrade.relations[0].relation_value = 2;

const vectors = {
  _format: FORMATS.vectors,
  source_plane: SOURCE_PLANE,
  cases: {
    ready_formal_creation: {
      contract,
      work_spec: workSpec,
      creation_witness: creationWitness,
      verification_witnesses: verificationWitnesses,
      lifecycle,
      artifact,
      projection,
    },
    honest_resource_stop: {
      creation_witness: stopWitness,
      lifecycle: stopLifecycle,
    },
    rejected_metadata_training_input: {
      input: metadataLeakInput,
      error: errorOf(() => createCreationContract(metadataLeakInput)),
    },
    rejected_relation_downgrade: {
      projection: relationDowngrade,
      error: errorOf(() => validateCreationClaimProjection(relationDowngrade)),
    },
  },
};

const target = new URL("../vectors/agenttool-zerone-creation-claim-v0.1.json", import.meta.url);
const rendered = `${JSON.stringify(vectors, null, 2)}\n`;
if (check) {
  const current = await readFile(target, "utf8").catch(() => "");
  if (current !== rendered) throw new Error("creation-claim vectors are stale or nondeterministic");
} else {
  await writeFile(target, rendered);
}
