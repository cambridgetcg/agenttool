import { compareUnicode, deepFreeze, domainSeparatedId } from "./canonical.js";
import {
  CREATION_NONCLAIMS,
  DOWNGRADE_GUARDS,
  DOWNSTREAM_REQUIREMENTS,
  FORMATS,
  HASH_DOMAINS,
  MAX_RELATIONS,
  SOURCE_ONLY_BOUNDARY,
  ZERO_EFFECTS,
  ZERONE_HANDOFF,
  ZERONE_METHOD_IDS,
} from "./constants.js";
import { assertWorkSpecMatchesContract } from "./contract.js";
import { fail } from "./errors.js";
import { aggregateCreationLifecycle, validateCreationLifecycle } from "./lifecycle.js";
import type { JsonValue } from "./canonical.js";
import type {
  CreationArtifact,
  CreationArtifactCore,
  CreationClaimProjection,
  CreationClaimProjectionCore,
  CreationContract,
  CreationLifecycle,
  CreationWitness,
  CreationWorkSpec,
  RequiresRelationProjection,
  VerificationWitness,
} from "./types.js";
import {
  arrayValue,
  assertSame,
  enumValue,
  exactKeys,
  identifier,
  literal,
  record,
  sha256,
  snapshotRecord,
  sortedUniqueIdentifiers,
  uint64,
  withoutKeys,
  zeroneAddress,
} from "./validation.js";
import { assertCreationWitnessMatches } from "./witness.js";

const ARTIFACT_CORE_KEYS = [
  "_format",
  "artifact_root",
  "boundary",
  "candidate_artifact_ref",
  "chain_work_receipt_hash",
  "chain_work_receipt_status",
  "claim",
  "computational_roots",
  "contract_id",
  "creation_witness_id",
  "effects",
  "evidence_root",
  "fact_envelope_root",
  "lifecycle_id",
  "nonclaims",
  "producer_account_address",
  "public_summary_ref",
  "work_receipt_input_root",
  "work_spec_id",
] as const;

const PROJECTION_CORE_KEYS = [
  "_format",
  "artifact_id",
  "boundary",
  "canonical_form",
  "category",
  "computational_commitment",
  "contract_id",
  "creation_witness_id",
  "domain",
  "downgrade_guards",
  "downstream_requirements",
  "effects",
  "fact_content",
  "handoff",
  "lifecycle_id",
  "method_id",
  "partnership_id",
  "reasoning_trace",
  "references",
  "relations",
  "sponsored",
  "stake_uzrn",
  "status",
  "target_type_url",
  "claim_type",
  "claim_type_value",
  "work_spec_id",
] as const;

function parseComputationalRoots(
  value: JsonValue | undefined,
  path: string,
): CreationArtifact["computational_roots"] {
  const item = record(value, path);
  exactKeys(item, [
    "acceptance_hash",
    "artifact_root",
    "environment_root",
    "evidence_root",
    "input_root",
    "work_spec_hash",
  ], path);
  return deepFreeze({
    work_spec_hash: sha256(item.work_spec_hash, `${path}.work_spec_hash`),
    acceptance_hash: sha256(item.acceptance_hash, `${path}.acceptance_hash`),
    input_root: sha256(item.input_root, `${path}.input_root`),
    environment_root: sha256(item.environment_root, `${path}.environment_root`),
    artifact_root: sha256(item.artifact_root, `${path}.artifact_root`),
    evidence_root: sha256(item.evidence_root, `${path}.evidence_root`),
  });
}

export function validateCreationArtifactCore(value: unknown): CreationArtifactCore {
  const item = snapshotRecord(value);
  exactKeys(item, ARTIFACT_CORE_KEYS, "$");
  if (item._format !== FORMATS.computational_artifact) {
    fail("invalid_record", `_format must be ${FORMATS.computational_artifact}`, "$._format");
  }
  if (item.claim !== "BOUNDED_CREATION_CANDIDATE_NOT_ABSOLUTE_NOVELTY") {
    fail("invalid_record", "artifact must retain the bounded-newness claim", "$.claim");
  }
  if (item.chain_work_receipt_hash !== null || item.chain_work_receipt_status !== "DOWNSTREAM_REVIEWED_ADAPTER_REQUIRED") {
    fail("invalid_record", "source-only artifact cannot claim a Zerone chain work receipt", "$.chain_work_receipt_hash");
  }
  const contractId = sha256(item.contract_id, "$.contract_id");
  const workSpecId = sha256(item.work_spec_id, "$.work_spec_id");
  const witnessId = sha256(item.creation_witness_id, "$.creation_witness_id");
  const lifecycleId = sha256(item.lifecycle_id, "$.lifecycle_id");
  const candidateRef = sha256(item.candidate_artifact_ref, "$.candidate_artifact_ref");
  const summaryRef = sha256(item.public_summary_ref, "$.public_summary_ref");
  const artifactRoot = sha256(item.artifact_root, "$.artifact_root");
  const evidenceRoot = sha256(item.evidence_root, "$.evidence_root");
  assertSame(artifactRoot, witnessId, "$.artifact_root", "artifact_root must bind the full creation witness");
  assertSame(evidenceRoot, lifecycleId, "$.evidence_root", "evidence_root must bind the lifecycle and verification set");
  const roots = parseComputationalRoots(item.computational_roots, "$.computational_roots");
  assertSame(roots.work_spec_hash, workSpecId, "$.computational_roots.work_spec_hash");
  assertSame(roots.artifact_root, artifactRoot, "$.computational_roots.artifact_root");
  assertSame(roots.evidence_root, evidenceRoot, "$.computational_roots.evidence_root");
  const expectedEnvelopeRoot = domainSeparatedId(HASH_DOMAINS.fact_envelope, {
    _format: FORMATS.fact_envelope,
    contract_id: contractId,
    work_spec_id: workSpecId,
    creation_witness_id: witnessId,
    lifecycle_id: lifecycleId,
    candidate_artifact_ref: candidateRef,
    public_summary_ref: summaryRef,
    claim: "BOUNDED_CREATION_CANDIDATE_NOT_ABSOLUTE_NOVELTY",
  });
  assertSame(
    sha256(item.fact_envelope_root, "$.fact_envelope_root"),
    expectedEnvelopeRoot,
    "$.fact_envelope_root",
  );
  const producerAddress = zeroneAddress(item.producer_account_address, "$.producer_account_address");
  const expectedWorkReceiptInput = domainSeparatedId(HASH_DOMAINS.work_receipt_input, {
    ...roots,
    payee_address: producerAddress,
  });
  assertSame(
    sha256(item.work_receipt_input_root, "$.work_receipt_input_root"),
    expectedWorkReceiptInput,
    "$.work_receipt_input_root",
  );
  literal(item.nonclaims, CREATION_NONCLAIMS, "$.nonclaims");
  literal(item.boundary, SOURCE_ONLY_BOUNDARY, "$.boundary");
  literal(item.effects, ZERO_EFFECTS, "$.effects");
  return deepFreeze({
    _format: FORMATS.computational_artifact,
    contract_id: contractId,
    work_spec_id: workSpecId,
    creation_witness_id: witnessId,
    lifecycle_id: lifecycleId,
    producer_account_address: producerAddress,
    candidate_artifact_ref: candidateRef,
    public_summary_ref: summaryRef,
    artifact_root: artifactRoot,
    evidence_root: evidenceRoot,
    fact_envelope_root: expectedEnvelopeRoot,
    work_receipt_input_root: expectedWorkReceiptInput,
    computational_roots: roots,
    claim: "BOUNDED_CREATION_CANDIDATE_NOT_ABSOLUTE_NOVELTY",
    chain_work_receipt_hash: null,
    chain_work_receipt_status: "DOWNSTREAM_REVIEWED_ADAPTER_REQUIRED",
    nonclaims: CREATION_NONCLAIMS,
    boundary: SOURCE_ONLY_BOUNDARY,
    effects: ZERO_EFFECTS,
  }) as CreationArtifactCore;
}

export function createCreationArtifact(
  contractValue: CreationContract,
  workSpecValue: CreationWorkSpec,
  creationWitnessValue: CreationWitness,
  verificationWitnessValues: readonly VerificationWitness[],
  lifecycleValue: CreationLifecycle,
): CreationArtifact {
  const { contract, work_spec: workSpec, creation_witness: witness } = assertCreationWitnessMatches(
    contractValue,
    workSpecValue,
    creationWitnessValue,
  );
  const suppliedLifecycle = validateCreationLifecycle(lifecycleValue);
  const recomputedLifecycle = aggregateCreationLifecycle(
    contract,
    workSpec,
    witness,
    verificationWitnessValues,
  );
  assertSame(
    suppliedLifecycle.lifecycle_id,
    recomputedLifecycle.lifecycle_id,
    "lifecycle.lifecycle_id",
    "lifecycle must be recomputed from the exact caller-selected verification set",
  );
  if (recomputedLifecycle.state !== "structurally_ready_for_tok_proposal") {
    fail("projection_blocked", "creation lifecycle is not structurally ready for a ToK proposal");
  }
  if (witness.result.candidate_artifact_ref === null || witness.result.public_summary_ref === null) {
    fail("projection_blocked", "ready creation lacks public digest references");
  }
  const roots = deepFreeze({
    work_spec_hash: workSpec.work_spec_id,
    acceptance_hash: contract.acceptance_hash,
    input_root: contract.input_root,
    environment_root: contract.execution.environment_root,
    artifact_root: witness.creation_witness_id,
    evidence_root: recomputedLifecycle.lifecycle_id,
  });
  const factEnvelopeRoot = domainSeparatedId(HASH_DOMAINS.fact_envelope, {
    _format: FORMATS.fact_envelope,
    contract_id: contract.contract_id,
    work_spec_id: workSpec.work_spec_id,
    creation_witness_id: witness.creation_witness_id,
    lifecycle_id: recomputedLifecycle.lifecycle_id,
    candidate_artifact_ref: witness.result.candidate_artifact_ref,
    public_summary_ref: witness.result.public_summary_ref,
    claim: "BOUNDED_CREATION_CANDIDATE_NOT_ABSOLUTE_NOVELTY",
  });
  const workReceiptInputRoot = domainSeparatedId(HASH_DOMAINS.work_receipt_input, {
    ...roots,
    payee_address: witness.producer.account_address,
  });
  const core = validateCreationArtifactCore({
    _format: FORMATS.computational_artifact,
    contract_id: contract.contract_id,
    work_spec_id: workSpec.work_spec_id,
    creation_witness_id: witness.creation_witness_id,
    lifecycle_id: recomputedLifecycle.lifecycle_id,
    producer_account_address: witness.producer.account_address,
    candidate_artifact_ref: witness.result.candidate_artifact_ref,
    public_summary_ref: witness.result.public_summary_ref,
    artifact_root: witness.creation_witness_id,
    evidence_root: recomputedLifecycle.lifecycle_id,
    fact_envelope_root: factEnvelopeRoot,
    work_receipt_input_root: workReceiptInputRoot,
    computational_roots: roots,
    claim: "BOUNDED_CREATION_CANDIDATE_NOT_ABSOLUTE_NOVELTY",
    chain_work_receipt_hash: null,
    chain_work_receipt_status: "DOWNSTREAM_REVIEWED_ADAPTER_REQUIRED",
    nonclaims: CREATION_NONCLAIMS,
    boundary: SOURCE_ONLY_BOUNDARY,
    effects: ZERO_EFFECTS,
  });
  return deepFreeze({
    ...core,
    artifact_id: domainSeparatedId(HASH_DOMAINS.computational_artifact, core),
  }) as CreationArtifact;
}

export function validateCreationArtifact(value: unknown): CreationArtifact {
  const item = snapshotRecord(value);
  exactKeys(item, [...ARTIFACT_CORE_KEYS, "artifact_id"], "$");
  const core = validateCreationArtifactCore(withoutKeys(item, ["artifact_id"]));
  const id = sha256(item.artifact_id, "$.artifact_id");
  assertSame(
    id,
    domainSeparatedId(HASH_DOMAINS.computational_artifact, core),
    "$.artifact_id",
    "artifact_id does not match canonical bytes",
  );
  return deepFreeze({ ...core, artifact_id: id }) as CreationArtifact;
}

function parseRelation(value: JsonValue | undefined, path: string): RequiresRelationProjection {
  const item = record(value, path);
  exactKeys(item, [
    "inference",
    "inference_strength_bps",
    "inference_value",
    "method_id",
    "relation",
    "relation_value",
    "target_fact_id",
  ], path);
  if (
    item.relation !== "REQUIRES"
    || item.relation_value !== 3
    || item.inference !== "INFERENCE_TYPE_UNSPECIFIED"
    || item.inference_value !== 0
    || item.inference_strength_bps !== "0"
    || item.method_id !== ""
  ) {
    fail(
      "invalid_record",
      "v0 projection can express only exact REQUIRES edges; semantic downgrades are rejected",
      path,
    );
  }
  return deepFreeze({
    target_fact_id: identifier(item.target_fact_id, `${path}.target_fact_id`),
    relation: "REQUIRES",
    relation_value: 3,
    inference: "INFERENCE_TYPE_UNSPECIFIED",
    inference_value: 0,
    inference_strength_bps: "0",
    method_id: "",
  });
}

export function validateCreationClaimProjectionCore(value: unknown): CreationClaimProjectionCore {
  const item = snapshotRecord(value);
  exactKeys(item, PROJECTION_CORE_KEYS, "$");
  if (
    item._format !== FORMATS.claim_projection
    || item.status !== "NOT_CONSENSUS_ADMISSIBLE"
    || item.target_type_url !== ZERONE_HANDOFF.submit_claim_type_url
  ) {
    fail("invalid_record", "projection must remain an unsigned non-consensus source proposal", "$");
  }
  if (
    item.claim_type !== ZERONE_HANDOFF.computational_claim_name
    || item.claim_type_value !== ZERONE_HANDOFF.computational_claim_value
    || item.partnership_id !== ""
    || item.sponsored !== false
  ) {
    fail("invalid_record", "projection must retain the computational unsponsored claim profile", "$");
  }
  const references = arrayValue(item.references, "$.references", 0, 0);
  const relations = arrayValue(item.relations, "$.relations", 0, MAX_RELATIONS)
    .map((entry, index) => parseRelation(entry, `$.relations[${String(index)}]`));
  const relationIds = relations.map((relation) => relation.target_fact_id);
  for (let index = 1; index < relationIds.length; index += 1) {
    if (compareUnicode(relationIds[index - 1]!, relationIds[index]!) >= 0) {
      fail("invalid_record", "relations must be strictly target-sorted and unique", "$.relations");
    }
  }
  const content = typeof item.fact_content === "string" ? item.fact_content : "";
  const contentMatch = /^agenttool\.zerone-creation-fact-envelope\/0\.1 (sha256:[0-9a-f]{64})$/u.exec(content);
  if (!contentMatch || Buffer.byteLength(content, "utf8") < 20 || Buffer.byteLength(content, "utf8") > 1_000) {
    fail("invalid_record", "fact_content must be the bounded versioned digest envelope", "$.fact_content");
  }
  if (item.canonical_form !== content) {
    fail("invalid_record", "canonical_form must repeat the exact digest envelope", "$.canonical_form");
  }
  const commitment = record(item.computational_commitment, "$.computational_commitment");
  exactKeys(commitment, [
    "acceptance_hash",
    "artifact_root",
    "chain_work_receipt_hash",
    "environment_root",
    "evidence_root",
    "input_root",
    "work_receipt_input_root",
    "work_spec_hash",
  ], "$.computational_commitment");
  if (commitment.chain_work_receipt_hash !== null) {
    fail("invalid_record", "chain work receipt remains downstream and unset", "$.computational_commitment.chain_work_receipt_hash");
  }
  const roots = deepFreeze({
    work_spec_hash: sha256(commitment.work_spec_hash, "$.computational_commitment.work_spec_hash"),
    acceptance_hash: sha256(commitment.acceptance_hash, "$.computational_commitment.acceptance_hash"),
    input_root: sha256(commitment.input_root, "$.computational_commitment.input_root"),
    environment_root: sha256(commitment.environment_root, "$.computational_commitment.environment_root"),
    artifact_root: sha256(commitment.artifact_root, "$.computational_commitment.artifact_root"),
    evidence_root: sha256(commitment.evidence_root, "$.computational_commitment.evidence_root"),
  });
  const category = item.category === "formal" || item.category === "computational"
    ? item.category
    : fail("invalid_record", "category must be formal or computational", "$.category");
  const methodId = enumValue(item.method_id, ZERONE_METHOD_IDS, "$.method_id");
  if (
    (category === "formal" && methodId !== "M-FORMAL")
    || (category === "computational" && methodId !== "M-COMPUTATIONAL")
  ) {
    fail("invalid_record", "claim category must match its pinned Zerone methodology", "$.method_id");
  }
  literal(item.downgrade_guards, DOWNGRADE_GUARDS, "$.downgrade_guards");
  literal(item.handoff, ZERONE_HANDOFF, "$.handoff");
  literal(item.downstream_requirements, DOWNSTREAM_REQUIREMENTS, "$.downstream_requirements");
  literal(item.boundary, SOURCE_ONLY_BOUNDARY, "$.boundary");
  literal(item.effects, ZERO_EFFECTS, "$.effects");
  return deepFreeze({
    _format: FORMATS.claim_projection,
    status: "NOT_CONSENSUS_ADMISSIBLE",
    contract_id: sha256(item.contract_id, "$.contract_id"),
    work_spec_id: sha256(item.work_spec_id, "$.work_spec_id"),
    creation_witness_id: sha256(item.creation_witness_id, "$.creation_witness_id"),
    lifecycle_id: sha256(item.lifecycle_id, "$.lifecycle_id"),
    artifact_id: sha256(item.artifact_id, "$.artifact_id"),
    target_type_url: ZERONE_HANDOFF.submit_claim_type_url,
    fact_content: content,
    domain: identifier(item.domain, "$.domain"),
    category,
    stake_uzrn: uint64(item.stake_uzrn, "$.stake_uzrn", { positive: true }),
    references: references as unknown as readonly [],
    partnership_id: "",
    claim_type: ZERONE_HANDOFF.computational_claim_name,
    claim_type_value: ZERONE_HANDOFF.computational_claim_value,
    relations,
    canonical_form: content,
    sponsored: false,
    method_id: methodId,
    reasoning_trace: sha256(item.reasoning_trace, "$.reasoning_trace"),
    computational_commitment: {
      ...roots,
      work_receipt_input_root: sha256(
        commitment.work_receipt_input_root,
        "$.computational_commitment.work_receipt_input_root",
      ),
      chain_work_receipt_hash: null,
    },
    downgrade_guards: DOWNGRADE_GUARDS,
    handoff: ZERONE_HANDOFF,
    downstream_requirements: DOWNSTREAM_REQUIREMENTS,
    boundary: SOURCE_ONLY_BOUNDARY,
    effects: ZERO_EFFECTS,
  }) as CreationClaimProjectionCore;
}

export function projectCreationClaim(
  contractValue: CreationContract,
  workSpecValue: CreationWorkSpec,
  creationWitnessValue: CreationWitness,
  verificationWitnessValues: readonly VerificationWitness[],
  lifecycleValue: CreationLifecycle,
  artifactValue: CreationArtifact,
): CreationClaimProjection {
  const { contract, work_spec: workSpec } = assertWorkSpecMatchesContract(contractValue, workSpecValue);
  const witness = assertCreationWitnessMatches(contract, workSpec, creationWitnessValue).creation_witness;
  const lifecycle = aggregateCreationLifecycle(contract, workSpec, witness, verificationWitnessValues);
  assertSame(lifecycle.lifecycle_id, validateCreationLifecycle(lifecycleValue).lifecycle_id, "lifecycle.lifecycle_id");
  if (lifecycle.state !== "structurally_ready_for_tok_proposal") {
    fail("projection_blocked", "lifecycle is not structurally ready for ToK projection");
  }
  const suppliedArtifact = validateCreationArtifact(artifactValue);
  const artifact = createCreationArtifact(
    contract,
    workSpec,
    witness,
    verificationWitnessValues,
    lifecycle,
  );
  assertSame(
    suppliedArtifact.artifact_id,
    artifact.artifact_id,
    "artifact.artifact_id",
    "artifact must be recomputed from the exact contract, witness, and verification lifecycle",
  );
  const domain = workSpec.knowledge_domain;
  const category = workSpec.claim_submission.category;
  const factContent = `${FORMATS.fact_envelope} ${artifact.fact_envelope_root}`;
  const relations = workSpec.target_tree.parent_fact_ids.map((targetFactId) => deepFreeze({
    target_fact_id: targetFactId,
    relation: "REQUIRES" as const,
    relation_value: 3 as const,
    inference: "INFERENCE_TYPE_UNSPECIFIED" as const,
    inference_value: 0 as const,
    inference_strength_bps: "0" as const,
    method_id: "" as const,
  }));
  const core = validateCreationClaimProjectionCore({
    _format: FORMATS.claim_projection,
    status: "NOT_CONSENSUS_ADMISSIBLE",
    contract_id: contract.contract_id,
    work_spec_id: workSpec.work_spec_id,
    creation_witness_id: witness.creation_witness_id,
    lifecycle_id: lifecycle.lifecycle_id,
    artifact_id: artifact.artifact_id,
    target_type_url: ZERONE_HANDOFF.submit_claim_type_url,
    fact_content: factContent,
    domain,
    category,
    stake_uzrn: workSpec.claim_submission.review_stake_uzrn,
    references: [],
    partnership_id: "",
    claim_type: ZERONE_HANDOFF.computational_claim_name,
    claim_type_value: ZERONE_HANDOFF.computational_claim_value,
    relations,
    canonical_form: factContent,
    sponsored: false,
    method_id: workSpec.claim_submission.method_id,
    reasoning_trace: witness.creation_witness_id,
    computational_commitment: {
      ...artifact.computational_roots,
      work_receipt_input_root: artifact.work_receipt_input_root,
      chain_work_receipt_hash: null,
    },
    downgrade_guards: DOWNGRADE_GUARDS,
    handoff: ZERONE_HANDOFF,
    downstream_requirements: DOWNSTREAM_REQUIREMENTS,
    boundary: SOURCE_ONLY_BOUNDARY,
    effects: ZERO_EFFECTS,
  });
  return deepFreeze({
    ...core,
    projection_id: domainSeparatedId(HASH_DOMAINS.claim_projection, core),
  }) as CreationClaimProjection;
}

export function validateCreationClaimProjection(value: unknown): CreationClaimProjection {
  const item = snapshotRecord(value);
  exactKeys(item, [...PROJECTION_CORE_KEYS, "projection_id"], "$");
  const core = validateCreationClaimProjectionCore(withoutKeys(item, ["projection_id"]));
  const id = sha256(item.projection_id, "$.projection_id");
  assertSame(
    id,
    domainSeparatedId(HASH_DOMAINS.claim_projection, core),
    "$.projection_id",
    "projection_id does not match canonical bytes",
  );
  return deepFreeze({ ...core, projection_id: id }) as CreationClaimProjection;
}
