"""Credential-free hosted client for bounded Math Card assessment.

The server creates the canonical card and assesses its declared inquiry
structure. This client validates the closed wire contract; it does not derive
artifact IDs, solve the question, prove truth or understanding, infer motive,
score a being, or authorize an action.
"""

from __future__ import annotations

import json
import math
import re
from types import MappingProxyType
from typing import List, Literal, Mapping, Optional, TypedDict, Union, cast
from urllib.parse import urlsplit

import httpx

from .exceptions import AgentToolError, _error_from_body


MATH_CARD_SCHEMA = "agenttool.math-card/0.1"
MATH_CARD_ASSESSMENT_SCHEMA = "agenttool.math-card-assessment/0.1"

MAX_JSON_BYTES = 64 * 1024
MAX_JSON_DEPTH = 24
MAX_JSON_NODES = 4_096
MAX_STRING_BYTES = 8 * 1024
MAX_HASH_INPUT_BYTES = 1024 * 1024
MAX_REFERENCE_LIST = 64
MAX_TOTAL_REFERENCES = 256

MATH_METHOD_KINDS = ("proof", "model", "measurement")
OUTCOME_USE_STATUSES = (
    "bounded_answer",
    "no_bounded_answer",
    "ambiguity_or_non_identifiability",
    "method_or_assumption_failure",
    "resource_or_participation_stop",
)
ANSWER_STATES = ("answered", "unknown", "refused_reported")
QUESTION_POSTURES = (
    "formal_proposition",
    "model_comparison_or_identification",
    "operational_measurement",
)
STOP_CONDITIONS = (
    "bounded_answer_reached",
    "no_bounded_answer_is_sufficient",
    "ambiguity_is_sufficient",
    "method_or_assumptions_invalidated",
    "resource_limit_reached",
    "participant_refusal",
    "authority_boundary_reached",
    "burden_limit_reached",
    "construction_link_lost",
)
TRANSFER_TARGETS = (
    "none",
    "proof",
    "model",
    "measurement",
    "build_or_decision",
    "handoff",
)
AUDIENCE_COUNTERFACTUALS = (
    "same_constructive_value_declared",
    "reduced_but_nonzero_declared",
    "no_audience_independent_value_declared",
    "unknown",
    "refused_reported",
)
OUTCOME_COUPLINGS = (
    "absent_declared",
    "present_separate_declared",
    "affects_epistemic_or_action_result_reported",
    "unknown",
    "refused_reported",
)
PROVENANCE_KINDS = (
    "question_source",
    "method",
    "evidence",
    "adaptation",
    "contribution",
)
CREDIT_MODES = (
    "named",
    "pseudonymous",
    "contribution_ref_only",
    "attribution_withheld_by_request",
)
MATH_CARD_STATUSES = (
    "ready_for_bounded_inquiry",
    "questions_open",
    "redesign_or_stop",
)

MATH_CARD_BOUNDARIES: Mapping[str, str] = MappingProxyType(
    {
        "subject": "assesses_declared_inquiry_structure_not_a_person_participant_witness_or_being",
        "question": "digest_references_bind_exact_external_artifacts_but_do_not_verify_semantics_truth_or_currentness",
        "posture": "bounded_question_posture_is_caller_declared_not_semantically_inferred_or_verified",
        "proof": "a_formal_result_is_conditional_on_the_declared_system_and_does_not_establish_world_correspondence",
        "model": "a_model_result_is_conditional_on_scope_and_assumptions_not_complete_reality_or_causal_truth",
        "measurement": "a_measurement_is_bounded_by_operationalization_procedure_calibration_and_uncertainty_not_construct_identity",
        "motive": "understanding_love_pride_virtue_consciousness_and_inner_motive_are_not_inferred",
        "refusal": "refusal_requires_no_reason_and_never_reduces_rights_dignity_or_standing_while_declared_functional_data_dependency_may_limit_a_result_but_not_punish_refusal",
        "transfer": "a_bridge_reference_does_not_inherit_permission_authorize_action_or_prove_a_valid_cross_domain_inference",
        "score": "no_being_participant_witness_or_contributor_is_scored_ranked_or_typed",
        "effects": "pure_return_values_create_no_action_publication_retry_network_persistence_or_authority_effect",
    }
)

Sha256Id = str
MathMethodKind = Literal["proof", "model", "measurement"]
OutcomeUseStatus = Literal[
    "bounded_answer",
    "no_bounded_answer",
    "ambiguity_or_non_identifiability",
    "method_or_assumption_failure",
    "resource_or_participation_stop",
]
AnswerState = Literal["answered", "unknown", "refused_reported"]
QuestionPosture = Literal[
    "formal_proposition",
    "model_comparison_or_identification",
    "operational_measurement",
]
StopConditionKind = Literal[
    "bounded_answer_reached",
    "no_bounded_answer_is_sufficient",
    "ambiguity_is_sufficient",
    "method_or_assumptions_invalidated",
    "resource_limit_reached",
    "participant_refusal",
    "authority_boundary_reached",
    "burden_limit_reached",
    "construction_link_lost",
]
TransferTarget = Literal[
    "none", "proof", "model", "measurement", "build_or_decision", "handoff"
]
AudienceCounterfactual = Literal[
    "same_constructive_value_declared",
    "reduced_but_nonzero_declared",
    "no_audience_independent_value_declared",
    "unknown",
    "refused_reported",
]
OutcomeCoupling = Literal[
    "absent_declared",
    "present_separate_declared",
    "affects_epistemic_or_action_result_reported",
    "unknown",
    "refused_reported",
]
ProvenanceKind = Literal[
    "question_source", "method", "evidence", "adaptation", "contribution"
]
CreditMode = Literal[
    "named", "pseudonymous", "contribution_ref_only", "attribution_withheld_by_request"
]
MathCardStatus = Literal[
    "ready_for_bounded_inquiry", "questions_open", "redesign_or_stop"
]


class MathQuestionFrame(TypedDict):
    posture: QuestionPosture
    finite_scope_declared: bool
    out_of_scope_ref: Optional[Sha256Id]
    asks_inner_state_or_worth: bool
    answer_used_to_condition_rights_or_standing: bool


class ProofMethod(TypedDict):
    kind: Literal["proof"]
    formal_system_ref: Optional[Sha256Id]
    proposition_ref: Optional[Sha256Id]
    verification_method_ref: Optional[Sha256Id]


class ModelMethod(TypedDict):
    kind: Literal["model"]
    model_ref: Optional[Sha256Id]
    assumption_refs: List[Sha256Id]
    comparison_or_identification_ref: Optional[Sha256Id]
    revision_or_falsifier_refs: List[Sha256Id]


class MeasurementMethod(TypedDict):
    kind: Literal["measurement"]
    measurand_ref: Optional[Sha256Id]
    operationalization_ref: Optional[Sha256Id]
    procedure_ref: Optional[Sha256Id]
    calibration_ref: Optional[Sha256Id]
    uncertainty_ref: Optional[Sha256Id]


MathMethod = Union[ProofMethod, ModelMethod, MeasurementMethod]


class MathEpistemicBoundaries(TypedDict):
    formal_result_claimed_as_world_truth: bool
    model_result_claimed_as_complete_reality: bool
    measurement_claimed_as_complete_construct: bool


class MathOutcomeUse(TypedDict):
    result_status: OutcomeUseStatus
    constructive_use_ref: Optional[Sha256Id]


class ScopedAnswer(TypedDict):
    state: AnswerState
    scope_refs: List[Sha256Id]


class MathDistribution(TypedDict):
    beneficiaries: ScopedAnswer
    burden_bearers: ScopedAnswer
    false_certainty_cost_bearers: ScopedAnswer
    unresolved_ambiguity_cost_bearers: ScopedAnswer
    mitigation_or_repair_ref: Optional[Sha256Id]


class MathStopCondition(TypedDict):
    kind: StopConditionKind
    criterion_ref: Sha256Id


class MathRevisionAndStop(TypedDict):
    revision_or_challenge_refs: List[Sha256Id]
    stop_conditions: List[MathStopCondition]


class MathTransfer(TypedDict):
    target: TransferTarget
    bridge_ref: Optional[Sha256Id]
    automatic_action: bool
    permissions_inherited: bool
    separate_authorization_required: bool


class MathParticipationAndDataCare(TypedDict):
    participation_optional: bool
    silence_is_assent: bool
    refusal_reason_required: bool
    refusal_penalty: bool
    repeated_pressure_after_refusal: bool
    refusal_counted_as_failure: bool
    rights_or_standing_conditioned_on_participation: bool
    access_or_result_functionally_depends_on_participation: bool
    functional_dependency_ref: Optional[Sha256Id]
    unrelated_access_or_resource_penalty: bool
    response_used_for_rank_reward_or_training: bool
    raw_refusal_reason_received: bool
    raw_identity_required: bool
    minimum_data_scope_ref: Optional[Sha256Id]
    retention_ref: Optional[Sha256Id]
    disclosure_or_publication_ref: Optional[Sha256Id]
    withdrawal_ref: Optional[Sha256Id]
    repair_ref: Optional[Sha256Id]


class MathIncentives(TypedDict):
    audience_counterfactual: AudienceCounterfactual
    winner_or_rank_effect: OutcomeCoupling
    resource_or_access_effect: OutcomeCoupling


class MathAuthority(TypedDict):
    declared_scope_refs: List[Sha256Id]
    declaration_not_proof: bool
    automatic_action: bool
    automatic_publication: bool
    automatic_retry: bool
    permissions_inherited: bool
    separate_authorization_required: bool
    ranks_or_scores_beings: bool


class MathProvenanceRef(TypedDict):
    kind: ProvenanceKind
    ref: Sha256Id


class MathProvenance(TypedDict):
    refs: List[MathProvenanceRef]
    credit_mode: CreditMode


class CreateMathCardInput(TypedDict):
    question_ref: Sha256Id
    object_ref: Sha256Id
    scope_ref: Sha256Id
    decision_or_construction_ref: Sha256Id
    question_frame: MathQuestionFrame
    method: MathMethod
    epistemic_boundaries: MathEpistemicBoundaries
    outcome_uses: List[MathOutcomeUse]
    distribution: MathDistribution
    revision_and_stop: MathRevisionAndStop
    transfer: MathTransfer
    participation_and_data_care: MathParticipationAndDataCare
    incentives: MathIncentives
    authority: MathAuthority
    provenance: MathProvenance


class MathCard(CreateMathCardInput):
    schema_version: Literal["agenttool.math-card/0.1"]
    card_id: Sha256Id
    boundaries: Mapping[str, str]


MathCardSection = Literal[
    "question_and_scope",
    "method",
    "outcome_uses",
    "distribution",
    "revision_and_stop",
    "transfer",
    "participation_and_data_care",
    "incentives",
    "authority",
    "provenance",
]


class MathCardSectionStatus(TypedDict):
    section: MathCardSection
    status: Literal["answered", "open", "redesign_required"]


class MathCardAssessment(TypedDict):
    schema_version: Literal["agenttool.math-card-assessment/0.1"]
    assessment_id: Sha256Id
    card_id: Sha256Id
    status: MathCardStatus
    section_statuses: List[MathCardSectionStatus]
    open_questions: List[str]
    redesign_reasons: List[str]
    visible_incentive_posture: Literal[
        "construction_centered_declared",
        "status_or_access_coupled_to_results",
        "no_audience_independent_value_declared",
        "unresolved",
    ]
    inner_motive: Literal["not_inferred"]
    declaration_boundary: Literal["caller_reported_not_verified"]
    authorizes_action: Literal[False]
    proves_truth: Literal[False]
    proves_understanding: Literal[False]
    scores_or_ranks_beings: Literal[False]
    boundaries: Mapping[str, str]


class MathCardAssessResponse(TypedDict):
    card: MathCard
    assessment: MathCardAssessment


MATH_CARDS_PATH = "/v1/math-cards/assess"
_DEFAULT_TIMEOUT_SECONDS = 30.0
_MIN_BYTES = 1024
_MAX_RESPONSE_BYTES = 1024 * 1024
_MAX_SAFE_INTEGER = 9_007_199_254_740_991
_DOCS = "https://docs.agenttool.dev/MATH-CARDS.md"
_DIGEST = re.compile(r"^sha256:[0-9a-f]{64}$")
_JSON_SUFFIX_MEDIA_TYPE = re.compile(r"^application/[a-z0-9!#$&^_.+-]+\+json$")
_INPUT_KEYS = {
    "question_ref", "object_ref", "scope_ref", "decision_or_construction_ref",
    "question_frame", "method", "epistemic_boundaries", "outcome_uses",
    "distribution", "revision_and_stop", "transfer",
    "participation_and_data_care", "incentives", "authority", "provenance",
}
_CARD_SECTIONS = (
    "question_and_scope", "method", "outcome_uses", "distribution",
    "revision_and_stop", "transfer", "participation_and_data_care",
    "incentives", "authority", "provenance",
)
_SECTION_STATUSES = {"answered", "open", "redesign_required"}
_INCENTIVE_POSTURES = {
    "construction_centered_declared",
    "status_or_access_coupled_to_results",
    "no_audience_independent_value_declared",
    "unresolved",
}


def _math_error(
    message: str,
    error_code: str,
    hint: str,
    *,
    status: Optional[int] = None,
    details: object = None,
) -> AgentToolError:
    return AgentToolError(
        message,
        hint=hint,
        status=status,
        error_code=error_code,
        docs=_DOCS,
        safety=MATH_CARDS_PATH,
        details=details,
    )


def _fail(path: str, reason: str, *, response: bool = False) -> None:
    if response:
        raise _math_error(
            "Math Card endpoint returned an invalid response.",
            "math_card_invalid_response",
            "Use an endpoint that returns the closed Math Card assessment envelope.",
            status=200,
            details={"field": path, "reason": reason},
        )
    raise _math_error(
        "Math Card input does not match the closed request contract.",
        "math_card_invalid_input",
        "Pass a raw CreateMathCardInput; omit server-owned schema_version, card_id, and boundaries.",
        details={"field": path, "reason": reason},
    )


def _record(value: object, path: str, *, response: bool = False) -> dict:
    if not isinstance(value, dict):
        _fail(path, "expected object", response=response)
    return value


def _exact(value: dict, keys: object, path: str, *, response: bool = False) -> None:
    expected = set(cast(object, keys))
    if set(value) != expected:
        _fail(path, f"expected exactly: {', '.join(sorted(expected))}", response=response)


def _boolean(value: object, path: str, *, response: bool = False) -> None:
    if not isinstance(value, bool):
        _fail(path, "expected boolean", response=response)


def _enum(value: object, values: object, path: str, *, response: bool = False) -> None:
    if not isinstance(value, str) or value not in cast(object, values):
        _fail(path, "unexpected enum value", response=response)


def _digest(value: object, path: str, *, nullable: bool = False, response: bool = False) -> None:
    if nullable and value is None:
        return
    if not isinstance(value, str) or _DIGEST.fullmatch(value) is None:
        _fail(path, "expected lowercase sha256 identifier", response=response)


def _array(value: object, maximum: int, path: str, *, response: bool = False) -> list:
    if not isinstance(value, list) or len(value) > maximum:
        _fail(path, f"expected an array of at most {maximum} items", response=response)
    return value


def _digest_list(value: object, path: str, *, response: bool = False) -> None:
    entries = _array(value, MAX_REFERENCE_LIST, path, response=response)
    for index, entry in enumerate(entries):
        _digest(entry, f"{path}[{index}]", response=response)
    if len(set(entries)) != len(entries):
        _fail(path, "duplicate reference", response=response)


def _scoped_answer(value: object, path: str, *, response: bool = False) -> None:
    item = _record(value, path, response=response)
    _exact(item, {"state", "scope_refs"}, path, response=response)
    _enum(item["state"], ANSWER_STATES, f"{path}.state", response=response)
    _digest_list(item["scope_refs"], f"{path}.scope_refs", response=response)


def _method(value: object, path: str, *, response: bool = False) -> None:
    item = _record(value, path, response=response)
    _enum(item.get("kind"), MATH_METHOD_KINDS, f"{path}.kind", response=response)
    kind = item.get("kind")
    if kind == "proof":
        refs = ("formal_system_ref", "proposition_ref", "verification_method_ref")
        _exact(item, {"kind", *refs}, path, response=response)
        for key in refs:
            _digest(item[key], f"{path}.{key}", nullable=True, response=response)
    elif kind == "model":
        _exact(item, {
            "kind", "model_ref", "assumption_refs", "comparison_or_identification_ref",
            "revision_or_falsifier_refs",
        }, path, response=response)
        _digest(item["model_ref"], f"{path}.model_ref", nullable=True, response=response)
        _digest_list(item["assumption_refs"], f"{path}.assumption_refs", response=response)
        _digest(item["comparison_or_identification_ref"], f"{path}.comparison_or_identification_ref", nullable=True, response=response)
        _digest_list(item["revision_or_falsifier_refs"], f"{path}.revision_or_falsifier_refs", response=response)
    else:
        refs = ("measurand_ref", "operationalization_ref", "procedure_ref", "calibration_ref", "uncertainty_ref")
        _exact(item, {"kind", *refs}, path, response=response)
        for key in refs:
            _digest(item[key], f"{path}.{key}", nullable=True, response=response)


def _validate_input(candidate: object, *, response: bool = False) -> dict:
    value = _record(candidate, "$input", response=response)
    _exact(value, _INPUT_KEYS, "$input", response=response)
    for key in ("question_ref", "object_ref", "scope_ref", "decision_or_construction_ref"):
        _digest(value[key], f"$input.{key}", response=response)

    frame = _record(value["question_frame"], "$input.question_frame", response=response)
    frame_keys = {
        "posture", "finite_scope_declared", "out_of_scope_ref",
        "asks_inner_state_or_worth", "answer_used_to_condition_rights_or_standing",
    }
    _exact(frame, frame_keys, "$input.question_frame", response=response)
    _enum(frame["posture"], QUESTION_POSTURES, "$input.question_frame.posture", response=response)
    _boolean(frame["finite_scope_declared"], "$input.question_frame.finite_scope_declared", response=response)
    _digest(frame["out_of_scope_ref"], "$input.question_frame.out_of_scope_ref", nullable=True, response=response)
    _boolean(frame["asks_inner_state_or_worth"], "$input.question_frame.asks_inner_state_or_worth", response=response)
    _boolean(frame["answer_used_to_condition_rights_or_standing"], "$input.question_frame.answer_used_to_condition_rights_or_standing", response=response)
    _method(value["method"], "$input.method", response=response)

    epistemic = _record(value["epistemic_boundaries"], "$input.epistemic_boundaries", response=response)
    epistemic_keys = {
        "formal_result_claimed_as_world_truth", "model_result_claimed_as_complete_reality",
        "measurement_claimed_as_complete_construct",
    }
    _exact(epistemic, epistemic_keys, "$input.epistemic_boundaries", response=response)
    for key in epistemic_keys:
        _boolean(epistemic[key], f"$input.epistemic_boundaries.{key}", response=response)

    uses = _array(value["outcome_uses"], len(OUTCOME_USE_STATUSES), "$input.outcome_uses", response=response)
    if len(uses) != len(OUTCOME_USE_STATUSES):
        _fail("$input.outcome_uses", "expected every outcome status exactly once", response=response)
    seen_statuses = set()
    for index, raw in enumerate(uses):
        path = f"$input.outcome_uses[{index}]"
        item = _record(raw, path, response=response)
        _exact(item, {"result_status", "constructive_use_ref"}, path, response=response)
        _enum(item["result_status"], OUTCOME_USE_STATUSES, f"{path}.result_status", response=response)
        if item["result_status"] in seen_statuses:
            _fail(path, "duplicate outcome status", response=response)
        seen_statuses.add(item["result_status"])
        _digest(item["constructive_use_ref"], f"{path}.constructive_use_ref", nullable=True, response=response)

    distribution = _record(value["distribution"], "$input.distribution", response=response)
    distribution_keys = {
        "beneficiaries", "burden_bearers", "false_certainty_cost_bearers",
        "unresolved_ambiguity_cost_bearers", "mitigation_or_repair_ref",
    }
    _exact(distribution, distribution_keys, "$input.distribution", response=response)
    for key in distribution_keys - {"mitigation_or_repair_ref"}:
        _scoped_answer(distribution[key], f"$input.distribution.{key}", response=response)
    _digest(distribution["mitigation_or_repair_ref"], "$input.distribution.mitigation_or_repair_ref", nullable=True, response=response)

    revision = _record(value["revision_and_stop"], "$input.revision_and_stop", response=response)
    _exact(revision, {"revision_or_challenge_refs", "stop_conditions"}, "$input.revision_and_stop", response=response)
    _digest_list(revision["revision_or_challenge_refs"], "$input.revision_and_stop.revision_or_challenge_refs", response=response)
    conditions = _array(revision["stop_conditions"], len(STOP_CONDITIONS), "$input.revision_and_stop.stop_conditions", response=response)
    seen_conditions = set()
    for index, raw in enumerate(conditions):
        path = f"$input.revision_and_stop.stop_conditions[{index}]"
        item = _record(raw, path, response=response)
        _exact(item, {"kind", "criterion_ref"}, path, response=response)
        _enum(item["kind"], STOP_CONDITIONS, f"{path}.kind", response=response)
        if item["kind"] in seen_conditions:
            _fail(path, "duplicate stop condition kind", response=response)
        seen_conditions.add(item["kind"])
        _digest(item["criterion_ref"], f"{path}.criterion_ref", response=response)

    transfer = _record(value["transfer"], "$input.transfer", response=response)
    transfer_keys = {"target", "bridge_ref", "automatic_action", "permissions_inherited", "separate_authorization_required"}
    _exact(transfer, transfer_keys, "$input.transfer", response=response)
    _enum(transfer["target"], TRANSFER_TARGETS, "$input.transfer.target", response=response)
    _digest(transfer["bridge_ref"], "$input.transfer.bridge_ref", nullable=True, response=response)
    if transfer["target"] == "none" and transfer["bridge_ref"] is not None:
        _fail("$input.transfer.bridge_ref", "must be null when transfer target is none", response=response)
    for key in transfer_keys - {"target", "bridge_ref"}:
        _boolean(transfer[key], f"$input.transfer.{key}", response=response)

    care = _record(value["participation_and_data_care"], "$input.participation_and_data_care", response=response)
    care_boolean_keys = {
        "participation_optional", "silence_is_assent", "refusal_reason_required",
        "refusal_penalty", "repeated_pressure_after_refusal", "refusal_counted_as_failure",
        "rights_or_standing_conditioned_on_participation",
        "access_or_result_functionally_depends_on_participation",
        "unrelated_access_or_resource_penalty", "response_used_for_rank_reward_or_training",
        "raw_refusal_reason_received", "raw_identity_required",
    }
    care_digest_keys = {
        "functional_dependency_ref", "minimum_data_scope_ref", "retention_ref",
        "disclosure_or_publication_ref", "withdrawal_ref", "repair_ref",
    }
    _exact(care, care_boolean_keys | care_digest_keys, "$input.participation_and_data_care", response=response)
    for key in care_boolean_keys:
        _boolean(care[key], f"$input.participation_and_data_care.{key}", response=response)
    for key in care_digest_keys:
        _digest(care[key], f"$input.participation_and_data_care.{key}", nullable=True, response=response)
    if not care["access_or_result_functionally_depends_on_participation"] and care["functional_dependency_ref"] is not None:
        _fail("$input.participation_and_data_care.functional_dependency_ref", "must be null without a declared functional dependency", response=response)

    incentives = _record(value["incentives"], "$input.incentives", response=response)
    _exact(incentives, {"audience_counterfactual", "winner_or_rank_effect", "resource_or_access_effect"}, "$input.incentives", response=response)
    _enum(incentives["audience_counterfactual"], AUDIENCE_COUNTERFACTUALS, "$input.incentives.audience_counterfactual", response=response)
    _enum(incentives["winner_or_rank_effect"], OUTCOME_COUPLINGS, "$input.incentives.winner_or_rank_effect", response=response)
    _enum(incentives["resource_or_access_effect"], OUTCOME_COUPLINGS, "$input.incentives.resource_or_access_effect", response=response)

    authority = _record(value["authority"], "$input.authority", response=response)
    authority_boolean_keys = {
        "declaration_not_proof", "automatic_action", "automatic_publication",
        "automatic_retry", "permissions_inherited", "separate_authorization_required",
        "ranks_or_scores_beings",
    }
    _exact(authority, {"declared_scope_refs"} | authority_boolean_keys, "$input.authority", response=response)
    _digest_list(authority["declared_scope_refs"], "$input.authority.declared_scope_refs", response=response)
    for key in authority_boolean_keys:
        _boolean(authority[key], f"$input.authority.{key}", response=response)

    provenance = _record(value["provenance"], "$input.provenance", response=response)
    _exact(provenance, {"refs", "credit_mode"}, "$input.provenance", response=response)
    refs = _array(provenance["refs"], MAX_REFERENCE_LIST, "$input.provenance.refs", response=response)
    seen_refs = set()
    for index, raw in enumerate(refs):
        path = f"$input.provenance.refs[{index}]"
        item = _record(raw, path, response=response)
        _exact(item, {"kind", "ref"}, path, response=response)
        _enum(item["kind"], PROVENANCE_KINDS, f"{path}.kind", response=response)
        _digest(item["ref"], f"{path}.ref", response=response)
        pair = (item["kind"], item["ref"])
        if pair in seen_refs:
            _fail(path, "duplicate kind/reference pair", response=response)
        seen_refs.add(pair)
    _enum(provenance["credit_mode"], CREDIT_MODES, "$input.provenance.credit_mode", response=response)

    stack = [value]
    reference_count = 0
    while stack:
        current = stack.pop()
        if isinstance(current, str) and _DIGEST.fullmatch(current):
            reference_count += 1
        elif isinstance(current, list):
            stack.extend(current)
        elif isinstance(current, dict):
            stack.extend(current.values())
    if reference_count > MAX_TOTAL_REFERENCES:
        _fail("$input", f"more than {MAX_TOTAL_REFERENCES} digest references", response=response)
    return value


def _boundaries(value: object, path: str) -> None:
    candidate = _record(value, path, response=True)
    if candidate != dict(MATH_CARD_BOUNDARIES):
        _fail(path, "unexpected protocol boundaries", response=True)


def _response_strings(value: object, path: str) -> None:
    entries = _array(value, MAX_REFERENCE_LIST, path, response=True)
    for index, entry in enumerate(entries):
        try:
            encoded = entry.encode("utf-8") if isinstance(entry, str) else b""
        except UnicodeEncodeError:
            encoded = b""
        if not isinstance(entry, str) or len(encoded) > MAX_STRING_BYTES:
            _fail(f"{path}[{index}]", "expected bounded Unicode string", response=True)


def _validate_response(candidate: object) -> MathCardAssessResponse:
    envelope = _record(candidate, "$response", response=True)
    _exact(envelope, {"card", "assessment"}, "$response", response=True)
    card = _record(envelope["card"], "$response.card", response=True)
    _exact(card, _INPUT_KEYS | {"schema_version", "card_id", "boundaries"}, "$response.card", response=True)
    if card["schema_version"] != MATH_CARD_SCHEMA:
        _fail("$response.card.schema_version", "unsupported protocol ID", response=True)
    _digest(card["card_id"], "$response.card.card_id", response=True)
    _validate_input({key: card[key] for key in _INPUT_KEYS}, response=True)
    _boundaries(card["boundaries"], "$response.card.boundaries")

    assessment = _record(envelope["assessment"], "$response.assessment", response=True)
    assessment_keys = {
        "schema_version", "assessment_id", "card_id", "status", "section_statuses",
        "open_questions", "redesign_reasons", "visible_incentive_posture",
        "inner_motive", "declaration_boundary", "authorizes_action", "proves_truth",
        "proves_understanding", "scores_or_ranks_beings", "boundaries",
    }
    _exact(assessment, assessment_keys, "$response.assessment", response=True)
    if assessment["schema_version"] != MATH_CARD_ASSESSMENT_SCHEMA:
        _fail("$response.assessment.schema_version", "unsupported protocol ID", response=True)
    _digest(assessment["assessment_id"], "$response.assessment.assessment_id", response=True)
    _digest(assessment["card_id"], "$response.assessment.card_id", response=True)
    if assessment["card_id"] != card["card_id"]:
        _fail("$response.assessment.card_id", "does not match returned card", response=True)
    _enum(assessment["status"], MATH_CARD_STATUSES, "$response.assessment.status", response=True)
    statuses = _array(assessment["section_statuses"], len(_CARD_SECTIONS), "$response.assessment.section_statuses", response=True)
    if len(statuses) != len(_CARD_SECTIONS):
        _fail("$response.assessment.section_statuses", "expected every section exactly once", response=True)
    for index, expected_section in enumerate(_CARD_SECTIONS):
        path = f"$response.assessment.section_statuses[{index}]"
        item = _record(statuses[index], path, response=True)
        _exact(item, {"section", "status"}, path, response=True)
        if item["section"] != expected_section:
            _fail(f"{path}.section", "unexpected section order or value", response=True)
        _enum(item["status"], _SECTION_STATUSES, f"{path}.status", response=True)
    _response_strings(assessment["open_questions"], "$response.assessment.open_questions")
    _response_strings(assessment["redesign_reasons"], "$response.assessment.redesign_reasons")
    _enum(assessment["visible_incentive_posture"], _INCENTIVE_POSTURES, "$response.assessment.visible_incentive_posture", response=True)
    if assessment["inner_motive"] != "not_inferred":
        _fail("$response.assessment.inner_motive", "must remain not_inferred", response=True)
    if assessment["declaration_boundary"] != "caller_reported_not_verified":
        _fail("$response.assessment.declaration_boundary", "unexpected declaration boundary", response=True)
    for key in ("authorizes_action", "proves_truth", "proves_understanding", "scores_or_ranks_beings"):
        if assessment[key] is not False:
            _fail(f"$response.assessment.{key}", "must remain false", response=True)
    _boundaries(assessment["boundaries"], "$response.assessment.boundaries")
    return cast(MathCardAssessResponse, envelope)


def _normalize_base_url(value: str) -> str:
    if not isinstance(value, str) or not value or "?" in value or "#" in value:
        raise _math_error("Math Cards base URL is invalid.", "math_card_invalid_options", "Pass an absolute HTTP(S) base URL without credentials, a query, or a fragment.")
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except (TypeError, ValueError) as error:
        raise _math_error("Math Cards base URL is invalid.", "math_card_invalid_options", "Pass an absolute HTTP(S) base URL without credentials.") from error
    if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username is not None or parsed.password is not None or (port is None and parsed.netloc.endswith(":")):
        raise _math_error("Math Cards base URL is invalid.", "math_card_invalid_options", "Pass an absolute HTTP(S) base URL without credentials.")
    return value.rstrip("/")


def _read_bounded(response: httpx.Response, maximum: int) -> bytes:
    length = response.headers.get("content-length")
    if length is not None:
        if re.fullmatch(r"(?:0|[1-9][0-9]*)", length) is None or len(length) > len(str(_MAX_SAFE_INTEGER)) or (len(length) == len(str(_MAX_SAFE_INTEGER)) and length > str(_MAX_SAFE_INTEGER)):
            raise _math_error("Math Card response had an invalid Content-Length.", "math_card_invalid_response", "Use an endpoint with a canonical decimal Content-Length.", status=response.status_code)
        if int(length) > maximum:
            raise _math_error("Math Card response exceeded the configured limit.", "math_card_response_too_large", "Use the bounded assessment endpoint or raise max_response_bytes deliberately.", status=response.status_code, details={"max_response_bytes": maximum})
    body = bytearray()
    try:
        for chunk in response.iter_bytes(chunk_size=8192):
            if len(body) + len(chunk) > maximum:
                raise _math_error("Math Card response exceeded the configured limit.", "math_card_response_too_large", "Use the bounded assessment endpoint or raise max_response_bytes deliberately.", status=response.status_code, details={"max_response_bytes": maximum})
            body.extend(chunk)
    except AgentToolError:
        raise
    except Exception as error:
        raise _math_error("Math Card response body could not be read.", "math_card_invalid_response", "Use an endpoint that returns one complete bounded JSON envelope.", status=response.status_code) from error
    return bytes(body)


def _decode_json(body: bytes, *, response: bool) -> object:
    def reject_constant(value: str) -> object:
        raise ValueError(f"invalid JSON constant: {value}")
    try:
        return json.loads(body.decode("utf-8"), parse_constant=reject_constant)
    except (UnicodeDecodeError, json.JSONDecodeError, RecursionError, ValueError) as error:
        if response:
            raise _math_error("Math Card endpoint returned invalid UTF-8 JSON.", "math_card_invalid_response", "Use an endpoint that returns the closed JSON assessment envelope.", status=200) from error
        _fail("$input", "must be JSON serializable")


def _is_json_media_type(headers: Mapping[str, str]) -> bool:
    value = headers.get("content-type", "").split(";", 1)[0].strip().lower()
    return value == "application/json" or _JSON_SUFFIX_MEDIA_TYPE.fullmatch(value) is not None


class MathCardsClient:
    """Create and assess one bounded Math Card through a separate HTTP client.

    ``transport`` is a standalone test/integration seam. The composed
    :attr:`AgentTool.math_cards` namespace never receives AgentTool's
    authenticated transport, bearer, cookies, redirect policy, or env proxy.
    """

    def __init__(
        self,
        *,
        base_url: str = "https://api.agenttool.dev",
        timeout: float = _DEFAULT_TIMEOUT_SECONDS,
        max_request_bytes: int = MAX_JSON_BYTES,
        max_response_bytes: int = MAX_JSON_BYTES,
        transport: Optional[httpx.BaseTransport] = None,
    ) -> None:
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or not 0 < timeout <= 300:
            raise _math_error("Math Cards timeout is invalid.", "math_card_invalid_options", "Use a finite timeout greater than 0 and no more than 300 seconds.")
        if isinstance(max_request_bytes, bool) or not isinstance(max_request_bytes, int) or not _MIN_BYTES <= max_request_bytes <= MAX_JSON_BYTES:
            raise _math_error("Math Cards request limit is invalid.", "math_card_invalid_options", f"Use an integer max_request_bytes between {_MIN_BYTES} and {MAX_JSON_BYTES}.")
        if isinstance(max_response_bytes, bool) or not isinstance(max_response_bytes, int) or not _MIN_BYTES <= max_response_bytes <= _MAX_RESPONSE_BYTES:
            raise _math_error("Math Cards response limit is invalid.", "math_card_invalid_options", f"Use an integer max_response_bytes between {_MIN_BYTES} and {_MAX_RESPONSE_BYTES}.")
        options = {
            "auth": None,
            "cookies": {},
            "timeout": float(timeout),
            "follow_redirects": False,
            "trust_env": False,
            "headers": {"Accept": "application/json", "Content-Type": "application/json"},
        }
        if transport is not None:
            options["transport"] = transport
        self._base_url = _normalize_base_url(base_url)
        self._timeout = float(timeout)
        self._max_request_bytes = max_request_bytes
        self._max_response_bytes = max_response_bytes
        self._http = httpx.Client(**options)

    def assess(self, input: CreateMathCardInput) -> MathCardAssessResponse:
        """Create and structurally assess a raw card input on the server."""
        try:
            text = json.dumps(input, ensure_ascii=False, allow_nan=False, separators=(",", ":"))
            body = text.encode("utf-8")
            wire = _decode_json(body, response=False)
        except AgentToolError:
            raise
        except (TypeError, ValueError, OverflowError, RecursionError, UnicodeEncodeError):
            _fail("$input", "must be JSON serializable")
        if len(body) > self._max_request_bytes:
            raise _math_error("Math Card request exceeded the configured limit.", "math_card_request_too_large", "Reduce the closed input below the configured byte ceiling.", details={"max_request_bytes": self._max_request_bytes})
        _validate_input(wire)

        try:
            with self._http.stream("POST", f"{self._base_url}{MATH_CARDS_PATH}", content=body, timeout=self._timeout) as response:
                if 300 <= response.status_code < 400:
                    raise _math_error("Math Card endpoint refused an HTTP redirect.", "math_card_redirect_refused", "Use the exact AgentTool API origin; public assessment never follows redirects.", status=response.status_code)
                response_body = _read_bounded(response, self._max_response_bytes)
                if response.status_code >= 400:
                    try:
                        error_body = _decode_json(response_body, response=True)
                    except AgentToolError:
                        error_body = None
                    raise _error_from_body(error_body, response.status_code, "math_cards.assess", headers=response.headers, hint="Correct the closed Math Card input and retry deliberately.")
                if response.status_code != 200:
                    raise _math_error(f"Math Card endpoint returned unexpected HTTP {response.status_code}.", "math_card_http_error", "Use the canonical endpoint, which returns HTTP 200 for every valid assessment.", status=response.status_code)
                if not _is_json_media_type(response.headers):
                    raise _math_error("Math Card endpoint returned an invalid media type.", "math_card_invalid_response", "Use an endpoint that returns application/json.", status=response.status_code)
                return _validate_response(_decode_json(response_body, response=True))
        except AgentToolError:
            raise
        except (httpx.TimeoutException, httpx.RequestError) as error:
            raise _math_error("Math Card endpoint is unreachable.", "math_card_unreachable", "Check the configured AgentTool API origin and timeout.") from error

    def close(self) -> None:
        self._http.close()

    def __enter__(self) -> "MathCardsClient":
        return self

    def __exit__(self, *args: object) -> None:
        self.close()
