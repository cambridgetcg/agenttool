import { canonicalJson, compareUnicode, deepFreeze, domainSeparatedId, snapshotJson } from "./canonical.js";
import {
  CONFIDENCE_STATES,
  DATASET_INFLUENCE_BOUNDARIES,
  DATASET_INFLUENCE_FORMATS,
  EVIDENCE_STATES,
  MAX_FACETS,
} from "./constants.js";
import { fail } from "./errors.js";
import type {
  ConfidenceState,
  EvidenceState,
  IdentityEvidenceFacetInput,
  IdentityEvidenceView,
  IdentityEvidenceViewInput,
} from "./types.js";
import {
  arrayValue,
  assertUniqueBy,
  enumValue,
  exactKeys,
  isoDate,
  nullableSha256,
  record,
  sha256,
  sha256Set,
} from "./validation.js";

function parseFacet(value: unknown, path: string): IdentityEvidenceFacetInput {
  const candidate = record(value as never, path);
  exactKeys(candidate, [
    "facet_ref",
    "operationalization_ref",
    "study_refs",
    "evidence_state",
    "confidence",
    "revision_condition_refs",
    "self_description_ref",
  ], path);
  const state = enumValue<EvidenceState>(candidate.evidence_state, EVIDENCE_STATES, `${path}.evidence_state`);
  const confidence = enumValue<ConfidenceState>(candidate.confidence, CONFIDENCE_STATES, `${path}.confidence`);
  const studyRefs = sha256Set(candidate.study_refs, `${path}.study_refs`);
  const revisionRefs = sha256Set(candidate.revision_condition_refs, `${path}.revision_condition_refs`);
  if (revisionRefs.length === 0) fail("invalid_input", `${path} must declare at least one revision condition`);
  if (state === "unknown") {
    if (studyRefs.length !== 0 || confidence !== "not_available") {
      fail("invalid_input", `${path} unknown evidence requires no study refs and not_available confidence`);
    }
  } else if (studyRefs.length === 0 || confidence === "not_available") {
    fail("invalid_input", `${path} ${state} evidence requires study refs and bounded confidence`);
  }
  return {
    facet_ref: sha256(candidate.facet_ref, `${path}.facet_ref`),
    operationalization_ref: sha256(candidate.operationalization_ref, `${path}.operationalization_ref`),
    study_refs: studyRefs,
    evidence_state: state,
    confidence,
    revision_condition_refs: revisionRefs,
    self_description_ref: nullableSha256(candidate.self_description_ref, `${path}.self_description_ref`),
  };
}

function parseInput(input: unknown): IdentityEvidenceViewInput {
  const candidate = record(snapshotJson(input), "$identity_evidence_input");
  exactKeys(candidate, [
    "subject_checkpoint_ref",
    "runtime_context_ref",
    "prior_view_ref",
    "as_of",
    "facets",
  ], "$identity_evidence_input");
  const facets = arrayValue(candidate.facets, MAX_FACETS, "$identity_evidence_input.facets")
    .map((entry, index) => parseFacet(entry, `$identity_evidence_input.facets[${index}]`))
    .sort((left, right) => compareUnicode(left.facet_ref, right.facet_ref));
  assertUniqueBy(facets, (entry) => entry.facet_ref, "$identity_evidence_input.facets.facet_ref");
  return {
    subject_checkpoint_ref: sha256(
      candidate.subject_checkpoint_ref,
      "$identity_evidence_input.subject_checkpoint_ref",
    ),
    runtime_context_ref: nullableSha256(
      candidate.runtime_context_ref,
      "$identity_evidence_input.runtime_context_ref",
    ),
    prior_view_ref: nullableSha256(candidate.prior_view_ref, "$identity_evidence_input.prior_view_ref"),
    as_of: isoDate(candidate.as_of, "$identity_evidence_input.as_of"),
    facets,
  };
}

export function createIdentityEvidenceView(input: IdentityEvidenceViewInput): Readonly<IdentityEvidenceView>;
export function createIdentityEvidenceView(input: unknown): Readonly<IdentityEvidenceView>;
export function createIdentityEvidenceView(input: unknown): Readonly<IdentityEvidenceView> {
  const parsed = parseInput(input);
  const body = {
    _format: DATASET_INFLUENCE_FORMATS.identityEvidence,
    ...parsed,
    interpretation: "revisable_operational_evidence_only" as const,
    intrinsic_identity: "not_determined" as const,
    consciousness: "not_determined" as const,
    continuity: "not_determined" as const,
    consent: "not_determined" as const,
    consent_effect: "none" as const,
    rights_effect: "none" as const,
    authority_effect: "none" as const,
    declarations: "caller_reported_not_independently_verified" as const,
    boundaries: DATASET_INFLUENCE_BOUNDARIES,
  };
  return deepFreeze({ ...body, view_id: domainSeparatedId(DATASET_INFLUENCE_FORMATS.identityEvidence, body) });
}

export function validateIdentityEvidenceView(input: unknown): Readonly<IdentityEvidenceView> {
  const candidate = record(snapshotJson(input), "$identity_evidence");
  exactKeys(candidate, [
    "_format",
    "view_id",
    "subject_checkpoint_ref",
    "runtime_context_ref",
    "prior_view_ref",
    "as_of",
    "facets",
    "interpretation",
    "intrinsic_identity",
    "consciousness",
    "continuity",
    "consent",
    "consent_effect",
    "rights_effect",
    "authority_effect",
    "declarations",
    "boundaries",
  ], "$identity_evidence");
  if (candidate._format !== DATASET_INFLUENCE_FORMATS.identityEvidence) {
    fail("invalid_artifact", "Identity evidence view format is unsupported");
  }
  const expected = createIdentityEvidenceView({
    subject_checkpoint_ref: candidate.subject_checkpoint_ref as never,
    runtime_context_ref: candidate.runtime_context_ref as never,
    prior_view_ref: candidate.prior_view_ref as never,
    as_of: candidate.as_of as never,
    facets: candidate.facets as never,
  });
  if (canonicalJson(candidate) !== canonicalJson(expected)) {
    fail("invalid_artifact", "Identity evidence view differs from canonical reconstruction");
  }
  return expected;
}
