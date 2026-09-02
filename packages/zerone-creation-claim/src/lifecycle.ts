import { compareUnicode, deepFreeze, domainSeparatedId, snapshotJson } from "./canonical.js";
import {
  ARTIFACT_KINDS,
  CREATION_NONCLAIMS,
  CREATION_OUTCOMES,
  FORMATS,
  HASH_DOMAINS,
  LIFECYCLE_STATES,
  REQUIREMENT_STATUSES,
  MAX_VERIFIERS,
  SOURCE_ONLY_BOUNDARY,
  VERIFICATION_KINDS,
  ZERO_EFFECTS,
} from "./constants.js";
import { assertWorkSpecMatchesContract } from "./contract.js";
import { fail } from "./errors.js";
import type { JsonValue } from "./canonical.js";
import type {
  CreationContract,
  CreationLifecycle,
  CreationLifecycleCore,
  CreationWitness,
  CreationWorkSpec,
  RequirementAssessment,
  VerificationRequirement,
  VerificationWitness,
} from "./types.js";
import {
  arrayValue,
  assertSame,
  assertStrictlySortedUnique,
  enumValue,
  exactKeys,
  literal,
  nullableSha256,
  record,
  sha256,
  snapshotRecord,
  sortedUniqueDigests,
  uint64,
  withoutKeys,
} from "./validation.js";
import {
  assertCreationWitnessMatches,
  validateVerificationWitness,
} from "./witness.js";

const LIFECYCLE_CORE_KEYS = [
  "_format",
  "accepted_new_posture",
  "artifact_kind",
  "blockers",
  "boundary",
  "contract_id",
  "creation_witness_id",
  "effects",
  "handoff",
  "nonclaims",
  "outcome",
  "requirements",
  "state",
  "verification_set_root",
  "work_spec_id",
] as const;

const BLOCKER_ORDER = [
  "AWAITING_CREATION",
  "OUTCOME_OFFCHAIN_ONLY",
  "PUBLICATION_AUTHORITY_MISSING",
  "CONFIDENTIAL_MATERIAL_PRESENT",
  "VERIFICATION_OPEN",
  "VERIFICATION_CONTESTED",
] as const;

type Blocker = CreationLifecycleCore["blockers"][number];

function blocker(value: JsonValue | undefined, path: string): Blocker {
  return enumValue(value, BLOCKER_ORDER, path);
}

function parseRequirementAssessment(
  value: JsonValue | undefined,
  path: string,
): RequirementAssessment {
  const item = record(value, path);
  exactKeys(item, [
    "counted_passes",
    "failed_witness_ids",
    "ignored_duplicate_controller_or_key_witness_ids",
    "ignored_non_independent_witness_ids",
    "inconclusive_witness_ids",
    "kind",
    "minimum_passes",
    "passed_witness_ids",
    "status",
  ], path);
  const minimum = uint64(item.minimum_passes, `${path}.minimum_passes`, { positive: true, maximum: 16n });
  const counted = uint64(item.counted_passes, `${path}.counted_passes`, {
    maximum: BigInt(MAX_VERIFIERS),
  });
  const passed = sortedUniqueDigests(item.passed_witness_ids, `${path}.passed_witness_ids`);
  if (BigInt(counted) !== BigInt(passed.length)) {
    fail("invalid_record", `${path}.counted_passes must equal the number of counted pass witnesses`, path);
  }
  const failed = sortedUniqueDigests(item.failed_witness_ids, `${path}.failed_witness_ids`);
  const inconclusive = sortedUniqueDigests(
    item.inconclusive_witness_ids,
    `${path}.inconclusive_witness_ids`,
  );
  const ignoredNonIndependent = sortedUniqueDigests(
    item.ignored_non_independent_witness_ids,
    `${path}.ignored_non_independent_witness_ids`,
  );
  const ignoredDuplicateControllerOrKey = sortedUniqueDigests(
    item.ignored_duplicate_controller_or_key_witness_ids,
    `${path}.ignored_duplicate_controller_or_key_witness_ids`,
  );
  const allIds = [
    ...passed,
    ...failed,
    ...inconclusive,
    ...ignoredNonIndependent,
    ...ignoredDuplicateControllerOrKey,
  ];
  if (new Set(allIds).size !== allIds.length) {
    fail("invalid_record", `${path} must classify each verification witness at most once`, path);
  }
  const status = enumValue(item.status, REQUIREMENT_STATUSES, `${path}.status`);
  const expectedStatus = failed.length > 0
    ? "contested"
    : BigInt(counted) >= BigInt(minimum)
      ? "satisfied"
      : "open";
  if (status !== expectedStatus) {
    fail("invalid_record", `${path}.status does not match its visible pass/fail evidence`, `${path}.status`);
  }
  return deepFreeze({
    kind: enumValue(item.kind, VERIFICATION_KINDS, `${path}.kind`),
    minimum_passes: minimum,
    counted_passes: counted,
    passed_witness_ids: passed,
    failed_witness_ids: failed,
    inconclusive_witness_ids: inconclusive,
    ignored_non_independent_witness_ids: ignoredNonIndependent,
    ignored_duplicate_controller_or_key_witness_ids: ignoredDuplicateControllerOrKey,
    status,
  }) as RequirementAssessment;
}

export function validateCreationLifecycleCore(value: unknown): CreationLifecycleCore {
  const item = snapshotRecord(value);
  exactKeys(item, LIFECYCLE_CORE_KEYS, "$");
  if (item._format !== FORMATS.lifecycle) {
    fail("invalid_record", `_format must be ${FORMATS.lifecycle}`, "$._format");
  }
  const creationWitnessId = nullableSha256(item.creation_witness_id, "$.creation_witness_id");
  const outcome = item.outcome === null ? null : enumValue(item.outcome, CREATION_OUTCOMES, "$.outcome");
  const artifactKind = item.artifact_kind === null
    ? null
    : enumValue(item.artifact_kind, ARTIFACT_KINDS, "$.artifact_kind");
  const requirements = arrayValue(item.requirements, "$.requirements", 0, VERIFICATION_KINDS.length)
    .map((entry, index) => parseRequirementAssessment(entry, `$.requirements[${String(index)}]`));
  for (let index = 1; index < requirements.length; index += 1) {
    if (
      VERIFICATION_KINDS.indexOf(requirements[index - 1]!.kind)
      >= VERIFICATION_KINDS.indexOf(requirements[index]!.kind)
    ) {
      fail("invalid_record", "requirements must follow frozen verification-kind order", "$.requirements");
    }
  }
  const blockers = arrayValue(item.blockers, "$.blockers", 0, BLOCKER_ORDER.length)
    .map((entry, index) => blocker(entry, `$.blockers[${String(index)}]`));
  const blockerIndexes = blockers.map((entry) => BLOCKER_ORDER.indexOf(entry));
  for (let index = 1; index < blockerIndexes.length; index += 1) {
    if (blockerIndexes[index - 1]! >= blockerIndexes[index]!) {
      fail("invalid_record", "blockers must follow frozen order without duplicates", "$.blockers");
    }
  }
  const state = enumValue(item.state, LIFECYCLE_STATES, "$.state");
  const accepted = enumValue(
    item.accepted_new_posture,
    ["not_reached", "BOUNDED_CANDIDATE_UNDER_PINNED_SCOPE"] as const,
    "$.accepted_new_posture",
  );
  const handoff = record(item.handoff, "$.handoff");
  exactKeys(handoff, ["artifact_projection", "chain_maturity", "settlement", "tok_claim_projection"], "$.handoff");
  const artifactProjection = enumValue(
    handoff.artifact_projection,
    ["available", "not_available"] as const,
    "$.handoff.artifact_projection",
  );
  const tokProjection = enumValue(
    handoff.tok_claim_projection,
    ["available", "not_available"] as const,
    "$.handoff.tok_claim_projection",
  );
  if (handoff.chain_maturity !== "not_observed" || handoff.settlement !== "not_authorized") {
    fail("invalid_record", "source-only lifecycle cannot claim chain maturity or settlement", "$.handoff");
  }
  if (state === "awaiting_creation") {
    if (creationWitnessId !== null || outcome !== null || artifactKind !== null) {
      fail("invalid_record", "awaiting_creation must not invent a witness or outcome", "$");
    }
  } else if (creationWitnessId === null || outcome === null || artifactKind === null) {
    fail("invalid_record", "post-creation lifecycle requires witness, outcome, and artifact kind", "$");
  }
  if (state === "structurally_ready_for_tok_proposal") {
    if (
      accepted !== "BOUNDED_CANDIDATE_UNDER_PINNED_SCOPE"
      || blockers.length !== 0
      || artifactProjection !== "available"
      || tokProjection !== "available"
    ) {
      fail("invalid_record", "ready lifecycle must expose only bounded readiness with no blockers", "$");
    }
  } else if (
    accepted !== "not_reached"
    || artifactProjection !== "not_available"
    || tokProjection !== "not_available"
  ) {
    fail("invalid_record", "non-ready lifecycle cannot expose a creation or ToK projection", "$");
  }
  const hasOpen = requirements.some((requirement) => requirement.status === "open");
  const hasContested = requirements.some((requirement) => requirement.status === "contested");
  const hasBlocker = (value: Blocker) => blockers.includes(value);
  if (state === "awaiting_creation" && (blockers.length !== 1 || !hasBlocker("AWAITING_CREATION"))) {
    fail("invalid_record", "awaiting_creation must carry only AWAITING_CREATION", "$.blockers");
  }
  if (state === "honest_terminal" && (blockers.length !== 1 || !hasBlocker("OUTCOME_OFFCHAIN_ONLY"))) {
    fail("invalid_record", "honest_terminal must carry only OUTCOME_OFFCHAIN_ONLY", "$.blockers");
  }
  if (
    state === "contested"
    && (!hasContested || !hasBlocker("VERIFICATION_CONTESTED") || hasBlocker("AWAITING_CREATION") || hasBlocker("OUTCOME_OFFCHAIN_ONLY"))
  ) {
    fail("invalid_record", "contested state must expose contested verification evidence", "$");
  }
  if (
    state === "verification_open"
    && (!hasOpen || hasContested || !hasBlocker("VERIFICATION_OPEN") || hasBlocker("VERIFICATION_CONTESTED"))
  ) {
    fail("invalid_record", "verification_open state must expose open and no contested requirements", "$");
  }
  if (
    state === "projection_blocked"
    && (
      hasOpen
      || hasContested
      || (!hasBlocker("PUBLICATION_AUTHORITY_MISSING") && !hasBlocker("CONFIDENTIAL_MATERIAL_PRESENT"))
      || hasBlocker("VERIFICATION_OPEN")
      || hasBlocker("VERIFICATION_CONTESTED")
    )
  ) {
    fail("invalid_record", "projection_blocked must have satisfied verification plus a publication/privacy blocker", "$");
  }
  if (
    state === "structurally_ready_for_tok_proposal"
    && (requirements.length === 0 || requirements.some((requirement) => requirement.status !== "satisfied"))
  ) {
    fail("invalid_record", "ready lifecycle requires a nonempty set of satisfied verification dimensions", "$.requirements");
  }
  literal(item.nonclaims, CREATION_NONCLAIMS, "$.nonclaims");
  literal(item.boundary, SOURCE_ONLY_BOUNDARY, "$.boundary");
  literal(item.effects, ZERO_EFFECTS, "$.effects");
  return deepFreeze({
    _format: FORMATS.lifecycle,
    contract_id: sha256(item.contract_id, "$.contract_id"),
    work_spec_id: sha256(item.work_spec_id, "$.work_spec_id"),
    creation_witness_id: creationWitnessId,
    outcome,
    artifact_kind: artifactKind,
    verification_set_root: sha256(item.verification_set_root, "$.verification_set_root"),
    requirements,
    state,
    blockers,
    accepted_new_posture: accepted,
    handoff: {
      artifact_projection: artifactProjection,
      tok_claim_projection: tokProjection,
      chain_maturity: "not_observed",
      settlement: "not_authorized",
    },
    nonclaims: CREATION_NONCLAIMS,
    boundary: SOURCE_ONLY_BOUNDARY,
    effects: ZERO_EFFECTS,
  }) as CreationLifecycleCore;
}

function assessRequirement(
  requirement: VerificationRequirement,
  witnesses: readonly VerificationWitness[],
  creationWitness: CreationWitness,
): RequirementAssessment {
  const relevant = witnesses.filter((witness) => witness.kind === requirement.kind);
  const failed = relevant
    .filter((witness) => witness.outcome === "failed")
    .map((witness) => witness.verification_witness_id)
    .sort(compareUnicode);
  const inconclusive = relevant
    .filter((witness) => witness.outcome === "inconclusive")
    .map((witness) => witness.verification_witness_id)
    .sort(compareUnicode);
  const passCandidates = relevant
    .filter((witness) => witness.outcome === "passed")
    .sort((left, right) => compareUnicode(left.verification_witness_id, right.verification_witness_id));
  const nonIndependent: VerificationWitness[] = [];
  const eligible: VerificationWitness[] = [];
  for (const witness of passCandidates) {
    const independent = witness.verifier.relation_to_producer === "declared_independent"
      && witness.verifier.independence_evidence_ref !== null
      && witness.verifier.controller_ref !== creationWitness.producer.wallet_controller_ref
      && witness.verifier.controller_ref !== creationWitness.producer.producer_identity_ref
      && witness.verifier.claimed_key_ref !== creationWitness.producer.producer_key_ref;
    if (requirement.independence === "distinct_from_producer_required" && !independent) {
      nonIndependent.push(witness);
    } else {
      eligible.push(witness);
    }
  }
  const controllers = new Set<string>();
  const keys = new Set<string>();
  const counted: VerificationWitness[] = [];
  const duplicates: VerificationWitness[] = [];
  for (const witness of eligible) {
    if (
      controllers.has(witness.verifier.controller_ref)
      || keys.has(witness.verifier.claimed_key_ref)
    ) duplicates.push(witness);
    else {
      controllers.add(witness.verifier.controller_ref);
      keys.add(witness.verifier.claimed_key_ref);
      counted.push(witness);
    }
  }
  const status = failed.length > 0
    ? "contested"
    : BigInt(counted.length) >= BigInt(requirement.minimum_passes)
      ? "satisfied"
      : "open";
  return deepFreeze({
    kind: requirement.kind,
    minimum_passes: requirement.minimum_passes,
    counted_passes: String(counted.length),
    passed_witness_ids: counted.map((witness) => witness.verification_witness_id).sort(compareUnicode),
    failed_witness_ids: failed,
    inconclusive_witness_ids: inconclusive,
    ignored_non_independent_witness_ids: nonIndependent
      .map((witness) => witness.verification_witness_id)
      .sort(compareUnicode),
    ignored_duplicate_controller_or_key_witness_ids: duplicates
      .map((witness) => witness.verification_witness_id)
      .sort(compareUnicode),
    status,
  }) as RequirementAssessment;
}

export function aggregateCreationLifecycle(
  contractValue: CreationContract,
  workSpecValue: CreationWorkSpec,
  creationWitnessValue: CreationWitness | null,
  verificationWitnessValues: readonly VerificationWitness[],
): CreationLifecycle {
  const { contract, work_spec: workSpec } = assertWorkSpecMatchesContract(contractValue, workSpecValue);
  const safeVerificationValues = snapshotJson(verificationWitnessValues);
  if (!Array.isArray(safeVerificationValues)) {
    fail("invalid_input", "verification witnesses must be an explicit array", "verification_witnesses");
  }
  if (safeVerificationValues.length > MAX_VERIFIERS) {
    fail("invalid_input", `verification witnesses must not exceed ${String(MAX_VERIFIERS)} entries`, "verification_witnesses");
  }
  if (creationWitnessValue === null && safeVerificationValues.length > 0) {
    fail("contract_mismatch", "verification witnesses cannot precede a creation witness");
  }
  const creationWitness = creationWitnessValue === null
    ? null
    : assertCreationWitnessMatches(contract, workSpec, creationWitnessValue).creation_witness;
  const selectedRoute = creationWitness === null
    ? null
    : contract.outcome_routes.find((entry) => entry.outcome === creationWitness.outcome)!;
  const witnesses = safeVerificationValues.map((value) => validateVerificationWitness(value))
    .sort((left, right) => compareUnicode(left.verification_witness_id, right.verification_witness_id));
  assertStrictlySortedUnique(
    witnesses.map((witness) => witness.verification_witness_id),
    "verification_witnesses",
  );
  for (const witness of witnesses) {
    assertSame(witness.contract_id, contract.contract_id, "verification_witness.contract_id");
    if (creationWitness === null) fail("contract_mismatch", "verification witness lacks creation witness");
    assertSame(
      witness.creation_witness_id,
      creationWitness.creation_witness_id,
      "verification_witness.creation_witness_id",
    );
    const requirement = selectedRoute?.requirements.find((entry) => entry.kind === witness.kind);
    if (requirement === undefined) {
      fail(
        "contract_mismatch",
        "verification kind is not selected by the creation outcome route",
        "verification_witness.kind",
      );
    }
    assertSame(
      witness.policy_ref,
      requirement.policy_ref,
      "verification_witness.policy_ref",
      "verification witness must bind the selected requirement policy",
    );
  }
  const verificationSetRoot = domainSeparatedId(
    HASH_DOMAINS.verification_set,
    witnesses.map((witness) => witness.verification_witness_id),
  );

  let requirements: readonly RequirementAssessment[] = [];
  let state: CreationLifecycleCore["state"] = "awaiting_creation";
  const blockers: Blocker[] = [];
  if (creationWitness === null) {
    blockers.push("AWAITING_CREATION");
  } else {
    const route = selectedRoute!;
    requirements = route.requirements.map((requirement) => assessRequirement(requirement, witnesses, creationWitness));
    if (route.tok_posture === "offchain_only") {
      state = "honest_terminal";
      blockers.push("OUTCOME_OFFCHAIN_ONLY");
    } else {
      const contested = requirements.some((requirement) => requirement.status === "contested");
      const open = requirements.some((requirement) => requirement.status === "open");
      if (contract.authorities.publication_authority_ref === null) blockers.push("PUBLICATION_AUTHORITY_MISSING");
      if (creationWitness.result.confidential_material_present) blockers.push("CONFIDENTIAL_MATERIAL_PRESENT");
      if (open) blockers.push("VERIFICATION_OPEN");
      if (contested) blockers.push("VERIFICATION_CONTESTED");
      if (contested) state = "contested";
      else if (open) state = "verification_open";
      else if (blockers.length > 0) state = "projection_blocked";
      else state = "structurally_ready_for_tok_proposal";
    }
  }
  const ready = state === "structurally_ready_for_tok_proposal";
  const core = validateCreationLifecycleCore({
    _format: FORMATS.lifecycle,
    contract_id: contract.contract_id,
    work_spec_id: workSpec.work_spec_id,
    creation_witness_id: creationWitness?.creation_witness_id ?? null,
    outcome: creationWitness?.outcome ?? null,
    artifact_kind: creationWitness?.artifact_kind ?? null,
    verification_set_root: verificationSetRoot,
    requirements,
    state,
    blockers,
    accepted_new_posture: ready ? "BOUNDED_CANDIDATE_UNDER_PINNED_SCOPE" : "not_reached",
    handoff: {
      artifact_projection: ready ? "available" : "not_available",
      tok_claim_projection: ready ? "available" : "not_available",
      chain_maturity: "not_observed",
      settlement: "not_authorized",
    },
    nonclaims: CREATION_NONCLAIMS,
    boundary: SOURCE_ONLY_BOUNDARY,
    effects: ZERO_EFFECTS,
  });
  return deepFreeze({
    ...core,
    lifecycle_id: domainSeparatedId(HASH_DOMAINS.lifecycle, core),
  }) as CreationLifecycle;
}

export function validateCreationLifecycle(value: unknown): CreationLifecycle {
  const item = snapshotRecord(value);
  exactKeys(item, [...LIFECYCLE_CORE_KEYS, "lifecycle_id"], "$");
  const core = validateCreationLifecycleCore(withoutKeys(item, ["lifecycle_id"]));
  const id = sha256(item.lifecycle_id, "$.lifecycle_id");
  assertSame(id, domainSeparatedId(HASH_DOMAINS.lifecycle, core), "$.lifecycle_id", "lifecycle_id does not match canonical bytes");
  return deepFreeze({ ...core, lifecycle_id: id }) as CreationLifecycle;
}
