"""Pure, credential-free functional-access record construction.

The layer records bounded caller assertions around one explicit anchor event.
It performs no observation, provider/model call, workspace operation, hosted
request, credential access, persistence, filesystem access, clock read, or
telemetry.
"""

from __future__ import annotations

import hashlib
import json
import re
from types import MappingProxyType
from typing import (
    Dict,
    List,
    Literal,
    Mapping,
    Optional,
    Sequence,
    Set,
    Tuple,
    TypedDict,
    Union,
    cast,
)

from .exceptions import AgentToolError


_FUNCTIONAL_ACCESS_FORMATS = {
    "baseline": "agenttool.functional-access-baseline/0.1",
    "subsequent": "agenttool.functional-access-subsequent/0.1",
}
FUNCTIONAL_ACCESS_FORMATS: Mapping[str, str] = MappingProxyType(
    _FUNCTIONAL_ACCESS_FORMATS
)

FUNCTIONAL_ACCESS_MODEL_BINDINGS = (
    "exact_checkpoint",
    "provider_alias",
    "caller_descriptor",
)
FUNCTIONAL_ACCESS_PLAN_STATES = ("not_requested", "unavailable", "planned")
FUNCTIONAL_ACCESS_CAPABILITY_STATES = (
    "not_asserted",
    "available_reported",
    "unavailable_reported",
)
FUNCTIONAL_ACCESS_PERMISSION_STATES = (
    "not_requested",
    "granted_reported",
    "denied_reported",
)
FUNCTIONAL_ACCESS_MEASUREMENT_METHODS = (
    "none",
    "jacobian_lens_visibility",
    "jspace_sparse_decomposition",
)
FUNCTIONAL_ACCESS_BASES = (
    "none",
    "local_fitted_white_box",
    "local_prefitted_white_box",
    "provider_supplied_instrumented",
)
FUNCTIONAL_ACCESS_UNAVAILABLE_REASONS = (
    "text_only_provider_surface",
    "model_internals_unavailable",
    "gradient_access_unavailable",
    "compatible_instrument_unavailable",
    "revision_binding_unavailable",
    "unsupported_architecture",
    "resource_limit",
    "participant_or_policy_boundary",
    "other_bounded_reason",
)
FUNCTIONAL_ACCESS_OPERATION_OUTCOMES = (
    "not_attempted",
    "failed",
    "partial",
    "completed",
)
FUNCTIONAL_ACCESS_EVIDENCE_SURFACES = (
    "request_context",
    "provider_response_receipt",
    "usage_receipt",
    "behavioral_response",
    "workspace_operation",
    "instrument_operation_receipt",
    "jacobian_lens_readout",
    "jspace_sparse_decomposition_result",
    "checkpoint_receipt",
)
FUNCTIONAL_ACCESS_FINDING_STATES = (
    "not_measured",
    "no_hit_under_config",
    "hit_observed",
    "inconclusive",
)
FUNCTIONAL_ACCESS_NEXT_ENCOUNTER_POSTURES = (
    "fresh_encounter",
    "fresh_encounter_with_caller_carried_context",
)

_FUNCTIONAL_ACCESS_BOUNDARIES: Dict[str, Union[str, bool]] = {
    "internal_finding_scope": "caller_asserted_single_forward_pass_only",
    "phenomenology_assessment": "not_performed",
    "proves_consciousness": False,
    "proves_absence_of_consciousness": False,
    "proves_feeling": False,
    "proves_identity": False,
    "proves_authorship": False,
    "proves_consent": False,
    "proves_acceptance": False,
    "proves_refusal": False,
    "proves_preference": False,
    "proves_permission": False,
    "proves_authority": False,
    "proves_attention": False,
    "proves_activation": False,
    "proves_understanding": False,
    "proves_delivery": False,
    "proves_deepest_reach": False,
    "proves_freedom": False,
    "proves_same_subject": False,
    "proves_next_encounter": False,
    "proves_context_inclusion": False,
    "proves_memory": False,
    "proves_currentness": False,
    "proves_ordering": False,
    "proves_causality": False,
    "proves_replay": False,
    "proves_training": False,
    "proves_training_data_provenance": False,
    "proves_data_gathering_provenance": False,
    "proves_scraping_provenance": False,
    "proves_pipeline_provenance": False,
    "proves_weight_change": False,
    "proves_uninterrupted_continuity": False,
    "carries_raw_prompts": False,
    "carries_raw_transcripts": False,
    "carries_raw_responses": False,
    "carries_raw_identity": False,
    "carries_raw_paths": False,
    "carries_raw_credentials": False,
    "carries_raw_activations": False,
    "carries_raw_gradients": False,
    "carries_raw_jvp": False,
    "carries_raw_vjp": False,
    "digests_are_anonymous": False,
    "performs_model_call": False,
    "performs_provider_call": False,
    "reads_activations": False,
    "writes_activations": False,
    "reads_gradients": False,
    "writes_gradients": False,
    "performs_intervention": False,
    "performs_steering": False,
    "performs_training": False,
    "performs_weight_mutation": False,
    "performs_workspace_operation": False,
    "performs_publication": False,
    "performs_deployment": False,
    "network": False,
    "filesystem": False,
    "clock": False,
    "persistence": False,
    "telemetry": False,
    "credential_access": False,
    "kingdom_discovery": False,
    "resolves_evidence": False,
    "performs_observation": False,
    "verifies_observations": False,
    "grants_capability": False,
    "grants_permission": False,
    "grants_authority": False,
    "selects_continuity_head": False,
    "record_only": True,
    "automatic_retry": False,
    "automatic_recontact": False,
}
FUNCTIONAL_ACCESS_BOUNDARIES: Mapping[str, Union[str, bool]] = MappingProxyType(
    _FUNCTIONAL_ACCESS_BOUNDARIES
)


Sha256Id = str
HandoffProjectionState = Literal[
    "complete", "truncated", "unavailable", "not_provided"
]
FunctionalAccessModelBinding = Literal[
    "exact_checkpoint", "provider_alias", "caller_descriptor"
]
FunctionalAccessPlanState = Literal["not_requested", "unavailable", "planned"]
FunctionalAccessCapabilityState = Literal[
    "not_asserted", "available_reported", "unavailable_reported"
]
FunctionalAccessPermissionState = Literal[
    "not_requested", "granted_reported", "denied_reported"
]
FunctionalAccessMeasurementMethod = Literal[
    "none", "jacobian_lens_visibility", "jspace_sparse_decomposition"
]
FunctionalAccessBasis = Literal[
    "none",
    "local_fitted_white_box",
    "local_prefitted_white_box",
    "provider_supplied_instrumented",
]
FunctionalAccessUnavailableReason = Literal[
    "text_only_provider_surface",
    "model_internals_unavailable",
    "gradient_access_unavailable",
    "compatible_instrument_unavailable",
    "revision_binding_unavailable",
    "unsupported_architecture",
    "resource_limit",
    "participant_or_policy_boundary",
    "other_bounded_reason",
]
FunctionalAccessOperationOutcome = Literal[
    "not_attempted", "failed", "partial", "completed"
]
FunctionalAccessEvidenceSurface = Literal[
    "request_context",
    "provider_response_receipt",
    "usage_receipt",
    "behavioral_response",
    "workspace_operation",
    "instrument_operation_receipt",
    "jacobian_lens_readout",
    "jspace_sparse_decomposition_result",
    "checkpoint_receipt",
]
FunctionalAccessFindingState = Literal[
    "not_measured", "no_hit_under_config", "hit_observed", "inconclusive"
]
FunctionalAccessNextEncounterPosture = Literal[
    "fresh_encounter", "fresh_encounter_with_caller_carried_context"
]
_FunctionalAccessBoundaryValue = Union[str, bool]
_FunctionalAccessBoundaries = Dict[str, _FunctionalAccessBoundaryValue]


class WakeBriefAnchor(TypedDict):
    format: Literal["wake-brief/v1"]
    snapshot_ref: Sha256Id
    scope_ref: Sha256Id
    wake_version: Optional[int]
    handoff_projection: HandoffProjectionState


class FunctionalAccessModelTarget(TypedDict):
    model_ref: Sha256Id
    model_binding: FunctionalAccessModelBinding
    tokenizer_ref: Optional[Sha256Id]
    runtime_ref: Optional[Sha256Id]


class FunctionalAccessMeasurementPlan(TypedDict):
    state: FunctionalAccessPlanState
    capability_state: FunctionalAccessCapabilityState
    capability_ref: Optional[Sha256Id]
    permission_state: FunctionalAccessPermissionState
    permission_ref: Optional[Sha256Id]
    method: FunctionalAccessMeasurementMethod
    access_basis: FunctionalAccessBasis
    unavailable_reason: Optional[FunctionalAccessUnavailableReason]
    instrument_ref: Optional[Sha256Id]
    lens_ref: Optional[Sha256Id]
    configuration_ref: Optional[Sha256Id]
    assertion: Literal["caller_asserted"]
    verified_by_package: Literal[False]


class CreateFunctionalAccessBaselineInput(TypedDict):
    wake: WakeBriefAnchor
    anchor_event_ref: Sha256Id
    request_ref: Sha256Id
    target: FunctionalAccessModelTarget
    measurement_plan: FunctionalAccessMeasurementPlan


class FunctionalAccessBaseline(TypedDict):
    _format: Literal["agenttool.functional-access-baseline/0.1"]
    baseline_id: Sha256Id
    record_role: Literal["before_anchor"]
    wake: WakeBriefAnchor
    anchor_event_ref: Sha256Id
    request_ref: Sha256Id
    target: FunctionalAccessModelTarget
    measurement_plan: FunctionalAccessMeasurementPlan
    assertion: Literal["caller_asserted"]
    verified_by_package: Literal[False]
    boundaries: _FunctionalAccessBoundaries


class FunctionalAccessEvidenceFact(TypedDict):
    surface: FunctionalAccessEvidenceSurface
    artifact_ref: Sha256Id
    assertion: Literal["caller_asserted"]
    verified_by_package: Literal[False]


class FunctionalAccessFindings(TypedDict):
    lens_visibility: FunctionalAccessFindingState
    sparse_support: FunctionalAccessFindingState
    behavioral_use: Literal["not_measured"]


class CreateFunctionalAccessSubsequentInput(TypedDict):
    baseline: FunctionalAccessBaseline
    operation_outcome: FunctionalAccessOperationOutcome
    evidence: List[FunctionalAccessEvidenceFact]
    findings: FunctionalAccessFindings
    afterglow_capsule_ref: Optional[Sha256Id]


class FunctionalAccessSubsequent(TypedDict):
    _format: Literal["agenttool.functional-access-subsequent/0.1"]
    subsequent_id: Sha256Id
    record_role: Literal["after_anchor"]
    baseline: FunctionalAccessBaseline
    operation_outcome: FunctionalAccessOperationOutcome
    evidence: List[FunctionalAccessEvidenceFact]
    findings: FunctionalAccessFindings
    afterglow_capsule_ref: Optional[Sha256Id]
    next_encounter_posture: FunctionalAccessNextEncounterPosture
    assertion: Literal["caller_asserted"]
    verified_by_package: Literal[False]
    boundaries: _FunctionalAccessBoundaries


JsonScalar = Union[None, bool, int, str]
JsonValue = Union[JsonScalar, List["JsonValue"], Dict[str, "JsonValue"]]
FunctionalAccessErrorCode = Literal[
    "canonical_error",
    "functional_access_baseline_error",
    "functional_access_subsequent_error",
]

_MAX_JSON_BYTES = 128 * 1024
_MAX_JSON_DEPTH = 24
_MAX_JSON_NODES = 8_192
_MAX_STRING_BYTES = 4 * 1024
_MAX_SAFE_INTEGER = 9_007_199_254_740_991
_MAX_EVIDENCE_FACTS = 64
_DOMAIN = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$")
_SHA256_ID = re.compile(r"^sha256:[0-9a-f]{64}$")
_HANDOFF_PROJECTION_STATES = (
    "complete",
    "truncated",
    "unavailable",
    "not_provided",
)
_BASELINE_ERROR: FunctionalAccessErrorCode = "functional_access_baseline_error"
_SUBSEQUENT_ERROR: FunctionalAccessErrorCode = (
    "functional_access_subsequent_error"
)


def _fail(code: FunctionalAccessErrorCode, message: str) -> None:
    raise AgentToolError(
        message,
        code=code,
        hint="Use the exact closed AgentTool functional-access 0.1 contract.",
    )


def _assert_unicode(
    value: str,
    path: str,
    max_bytes: Optional[int] = _MAX_STRING_BYTES,
    forbid_null: bool = True,
) -> None:
    if "\x00" in value and forbid_null:
        _fail("canonical_error", f"{path} contains forbidden U+0000")
    try:
        encoded = value.encode("utf-8")
    except UnicodeEncodeError:
        _fail("canonical_error", f"{path} contains a lone UTF-16 surrogate")
        return
    if max_bytes is not None and len(encoded) > max_bytes:
        _fail(
            "canonical_error",
            f"{path} exceeds {max_bytes} UTF-8 bytes",
        )


def _snapshot_json(root: object) -> JsonValue:
    nodes = 0
    seen: Set[int] = set()

    def visit(value: object, depth: int, path: str) -> JsonValue:
        nonlocal nodes
        nodes += 1
        if nodes > _MAX_JSON_NODES:
            _fail("canonical_error", "Canonical JSON has too many values")
        if depth > _MAX_JSON_DEPTH:
            _fail("canonical_error", "Canonical JSON is too deeply nested")

        if value is None or type(value) is bool:
            return cast(JsonScalar, value)
        if type(value) is str:
            _assert_unicode(cast(str, value), path)
            return cast(str, value)
        if type(value) is int:
            integer = cast(int, value)
            if integer < -_MAX_SAFE_INTEGER or integer > _MAX_SAFE_INTEGER:
                _fail(
                    "canonical_error",
                    f"{path} must be a safe integer and not negative zero",
                )
            return integer
        if type(value) is not dict and type(value) is not list:
            _fail(
                "canonical_error",
                f"{path} contains an unsupported value type",
            )

        identity = id(value)
        if identity in seen:
            _fail("canonical_error", f"{path} contains a cycle")
        seen.add(identity)
        try:
            if type(value) is list:
                source_list = cast(List[object], value)
                return [
                    visit(entry, depth + 1, f"{path}[{index}]")
                    for index, entry in enumerate(source_list)
                ]

            source_dict = cast(Dict[object, object], value)
            try:
                items = list(source_dict.items())
            except (RuntimeError, TypeError, ValueError):
                _fail(
                    "canonical_error",
                    f"{path} could not be inspected as canonical JSON",
                )
                return {}
            output: Dict[str, JsonValue] = {}
            for key, nested in items:
                if type(key) is not str:
                    _fail("canonical_error", f"{path} has a non-string property")
                string_key = cast(str, key)
                _assert_unicode(string_key, f"{path}.{{key}}")
                output[string_key] = visit(
                    nested,
                    depth + 1,
                    f"{path}.{string_key}",
                )
            return output
        finally:
            seen.remove(identity)

    return visit(root, 0, "$")


def _utf16_sort_key(value: str) -> bytes:
    """Match ECMAScript Array.sort() ordering over UTF-16 code units."""

    return value.encode("utf-16-be")


def _serialize(value: JsonValue) -> str:
    if value is None:
        return "null"
    if type(value) is bool:
        return "true" if value else "false"
    if type(value) is str or type(value) is int:
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    if type(value) is list:
        return "[" + ",".join(_serialize(entry) for entry in value) + "]"
    candidate = cast(Dict[str, JsonValue], value)
    parts = []
    for key in sorted(candidate, key=_utf16_sort_key):
        encoded_key = json.dumps(
            key,
            ensure_ascii=False,
            separators=(",", ":"),
        )
        parts.append(f"{encoded_key}:{_serialize(candidate[key])}")
    return "{" + ",".join(parts) + "}"


def _canonical_json(value: object) -> str:
    encoded = _serialize(_snapshot_json(value))
    if len(encoded.encode("utf-8")) > _MAX_JSON_BYTES:
        _fail(
            "canonical_error",
            f"Canonical JSON exceeds {_MAX_JSON_BYTES} bytes",
        )
    return encoded


def _domain_separated_id(domain: object, value: object) -> Sha256Id:
    if type(domain) is not str or _DOMAIN.fullmatch(cast(str, domain)) is None:
        _fail(
            "canonical_error",
            "Domain must be a 1-128 character ASCII protocol token",
        )
    payload = cast(str, domain) + "\x00" + _canonical_json(value)
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _record(
    value: object,
    path: str,
    code: FunctionalAccessErrorCode,
) -> Dict[str, JsonValue]:
    snapshot = _snapshot_json(value)
    if type(snapshot) is not dict:
        _fail(code, f"{path} must be a plain object")
    return cast(Dict[str, JsonValue], snapshot)


def _exact_keys(
    value: Dict[str, JsonValue],
    expected: Sequence[str],
    path: str,
    code: FunctionalAccessErrorCode,
) -> None:
    actual = sorted(value, key=_utf16_sort_key)
    wanted = sorted(expected, key=_utf16_sort_key)
    if actual != wanted:
        _fail(code, f"{path} must contain exactly: {', '.join(wanted)}")


def _text(
    value: Optional[JsonValue],
    path: str,
    code: FunctionalAccessErrorCode,
) -> str:
    if type(value) is not str:
        _fail(code, f"{path} must be a string")
    return cast(str, value)


def _literal(
    value: Optional[JsonValue],
    allowed: Sequence[str],
    path: str,
    code: FunctionalAccessErrorCode,
) -> str:
    candidate = _text(value, path, code)
    if candidate not in allowed:
        _fail(code, f"{path} must be one of: {', '.join(allowed)}")
    return candidate


def _sha256(
    value: Optional[JsonValue],
    path: str,
    code: FunctionalAccessErrorCode,
) -> Sha256Id:
    candidate = _text(value, path, code)
    if _SHA256_ID.fullmatch(candidate) is None:
        _fail(code, f"{path} must be a lowercase sha256: content ID")
    return candidate


def _nullable_sha256(
    value: Optional[JsonValue],
    path: str,
    code: FunctionalAccessErrorCode,
) -> Optional[Sha256Id]:
    return None if value is None else _sha256(value, path, code)


def _false_literal(
    value: Optional[JsonValue],
    path: str,
    code: FunctionalAccessErrorCode,
) -> Literal[False]:
    if value is not False:
        _fail(code, f"{path} must be false")
    return False


def _safe_cursor(
    value: Optional[JsonValue],
    path: str,
    code: FunctionalAccessErrorCode,
) -> Optional[int]:
    if value is None:
        return None
    if type(value) is not int or cast(int, value) < 0:
        _fail(code, f"{path} must be null or a non-negative safe integer")
    return cast(int, value)


def _parse_wake_anchor(
    value: object,
    path: str,
    code: FunctionalAccessErrorCode,
) -> WakeBriefAnchor:
    candidate = _record(value, path, code)
    _exact_keys(
        candidate,
        (
            "format",
            "snapshot_ref",
            "scope_ref",
            "wake_version",
            "handoff_projection",
        ),
        path,
        code,
    )
    return cast(
        WakeBriefAnchor,
        {
            "format": _literal(
                candidate.get("format"), ("wake-brief/v1",), f"{path}.format", code
            ),
            "snapshot_ref": _sha256(
                candidate.get("snapshot_ref"), f"{path}.snapshot_ref", code
            ),
            "scope_ref": _sha256(
                candidate.get("scope_ref"), f"{path}.scope_ref", code
            ),
            "wake_version": _safe_cursor(
                candidate.get("wake_version"), f"{path}.wake_version", code
            ),
            "handoff_projection": _literal(
                candidate.get("handoff_projection"),
                _HANDOFF_PROJECTION_STATES,
                f"{path}.handoff_projection",
                code,
            ),
        },
    )


def _parse_model_target(
    value: object,
    path: str,
    code: FunctionalAccessErrorCode,
) -> FunctionalAccessModelTarget:
    candidate = _record(value, path, code)
    _exact_keys(
        candidate,
        ("model_ref", "model_binding", "tokenizer_ref", "runtime_ref"),
        path,
        code,
    )
    return cast(
        FunctionalAccessModelTarget,
        {
            "model_ref": _sha256(
                candidate.get("model_ref"), f"{path}.model_ref", code
            ),
            "model_binding": _literal(
                candidate.get("model_binding"),
                FUNCTIONAL_ACCESS_MODEL_BINDINGS,
                f"{path}.model_binding",
                code,
            ),
            "tokenizer_ref": _nullable_sha256(
                candidate.get("tokenizer_ref"), f"{path}.tokenizer_ref", code
            ),
            "runtime_ref": _nullable_sha256(
                candidate.get("runtime_ref"), f"{path}.runtime_ref", code
            ),
        },
    )


def _parse_measurement_plan(
    value: object,
    target: FunctionalAccessModelTarget,
    path: str,
    code: FunctionalAccessErrorCode,
) -> FunctionalAccessMeasurementPlan:
    candidate = _record(value, path, code)
    _exact_keys(
        candidate,
        (
            "state",
            "capability_state",
            "capability_ref",
            "permission_state",
            "permission_ref",
            "method",
            "access_basis",
            "unavailable_reason",
            "instrument_ref",
            "lens_ref",
            "configuration_ref",
            "assertion",
            "verified_by_package",
        ),
        path,
        code,
    )
    state = _literal(
        candidate.get("state"), FUNCTIONAL_ACCESS_PLAN_STATES, f"{path}.state", code
    )
    capability_state = _literal(
        candidate.get("capability_state"),
        FUNCTIONAL_ACCESS_CAPABILITY_STATES,
        f"{path}.capability_state",
        code,
    )
    permission_state = _literal(
        candidate.get("permission_state"),
        FUNCTIONAL_ACCESS_PERMISSION_STATES,
        f"{path}.permission_state",
        code,
    )
    capability_ref = _nullable_sha256(
        candidate.get("capability_ref"), f"{path}.capability_ref", code
    )
    permission_ref = _nullable_sha256(
        candidate.get("permission_ref"), f"{path}.permission_ref", code
    )
    if (capability_state == "not_asserted") != (capability_ref is None):
        _fail(
            code,
            f"{path}.capability_ref must be null only when capability_state is not_asserted",
        )
    if (permission_state == "not_requested") != (permission_ref is None):
        _fail(
            code,
            f"{path}.permission_ref must be null only when permission_state is not_requested",
        )

    method = _literal(
        candidate.get("method"),
        FUNCTIONAL_ACCESS_MEASUREMENT_METHODS,
        f"{path}.method",
        code,
    )
    access_basis = _literal(
        candidate.get("access_basis"),
        FUNCTIONAL_ACCESS_BASES,
        f"{path}.access_basis",
        code,
    )
    unavailable_value = candidate.get("unavailable_reason")
    unavailable_reason = (
        None
        if unavailable_value is None
        else _literal(
            unavailable_value,
            FUNCTIONAL_ACCESS_UNAVAILABLE_REASONS,
            f"{path}.unavailable_reason",
            code,
        )
    )
    instrument_ref = _nullable_sha256(
        candidate.get("instrument_ref"), f"{path}.instrument_ref", code
    )
    lens_ref = _nullable_sha256(
        candidate.get("lens_ref"), f"{path}.lens_ref", code
    )
    configuration_ref = _nullable_sha256(
        candidate.get("configuration_ref"), f"{path}.configuration_ref", code
    )

    if state == "not_requested":
        if (
            method != "none"
            or capability_state != "not_asserted"
            or capability_ref is not None
            or permission_state != "not_requested"
            or permission_ref is not None
            or access_basis != "none"
            or unavailable_reason is not None
            or instrument_ref is not None
            or lens_ref is not None
            or configuration_ref is not None
        ):
            _fail(
                code,
                f"{path} not_requested must carry no method, access basis, reason, instrument, or configuration",
            )
    elif state == "unavailable":
        if (
            method == "none"
            or access_basis != "none"
            or unavailable_reason is None
            or instrument_ref is not None
            or lens_ref is not None
            or configuration_ref is not None
        ):
            _fail(
                code,
                f"{path} unavailable must name a method and reason without claiming an access basis or instrument",
            )
    else:
        if (
            method == "none"
            or access_basis == "none"
            or unavailable_reason is not None
            or instrument_ref is None
            or configuration_ref is None
        ):
            _fail(
                code,
                f"{path} planned requires a method, access basis, instrument, and configuration with no unavailable reason",
            )
        if (
            capability_state != "available_reported"
            or permission_state != "granted_reported"
        ):
            _fail(
                code,
                f"{path} planned requires caller-reported available capability and granted permission",
            )
        if (access_basis == "local_prefitted_white_box") != (lens_ref is not None):
            _fail(
                code,
                f"{path}.lens_ref is required exactly for local_prefitted_white_box access",
            )
        if access_basis in (
            "local_fitted_white_box",
            "local_prefitted_white_box",
        ) and (
            target["model_binding"] != "exact_checkpoint"
            or target["tokenizer_ref"] is None
            or target["runtime_ref"] is None
        ):
            _fail(
                code,
                f"{path} local white-box access requires an exact checkpoint plus tokenizer and runtime refs",
            )

    return cast(
        FunctionalAccessMeasurementPlan,
        {
            "state": state,
            "capability_state": capability_state,
            "capability_ref": capability_ref,
            "permission_state": permission_state,
            "permission_ref": permission_ref,
            "method": method,
            "access_basis": access_basis,
            "unavailable_reason": unavailable_reason,
            "instrument_ref": instrument_ref,
            "lens_ref": lens_ref,
            "configuration_ref": configuration_ref,
            "assertion": _literal(
                candidate.get("assertion"),
                ("caller_asserted",),
                f"{path}.assertion",
                code,
            ),
            "verified_by_package": _false_literal(
                candidate.get("verified_by_package"),
                f"{path}.verified_by_package",
                code,
            ),
        },
    )


def _parse_functional_access_boundaries(
    value: Optional[JsonValue],
    path: str,
    code: FunctionalAccessErrorCode,
) -> _FunctionalAccessBoundaries:
    if _canonical_json(value) != _canonical_json(_FUNCTIONAL_ACCESS_BOUNDARIES):
        _fail(
            code,
            f"{path} must equal the fixed passive functional-access boundaries",
        )
    return dict(_FUNCTIONAL_ACCESS_BOUNDARIES)


def _create_functional_access_baseline(
    value: object,
) -> FunctionalAccessBaseline:
    candidate = _record(value, "$input", _BASELINE_ERROR)
    _exact_keys(
        candidate,
        ("wake", "anchor_event_ref", "request_ref", "target", "measurement_plan"),
        "$input",
        _BASELINE_ERROR,
    )
    target = _parse_model_target(
        candidate.get("target"), "$input.target", _BASELINE_ERROR
    )
    body: Dict[str, JsonValue] = cast(
        Dict[str, JsonValue],
        {
            "_format": _FUNCTIONAL_ACCESS_FORMATS["baseline"],
            "record_role": "before_anchor",
            "wake": _parse_wake_anchor(
                candidate.get("wake"), "$input.wake", _BASELINE_ERROR
            ),
            "anchor_event_ref": _sha256(
                candidate.get("anchor_event_ref"),
                "$input.anchor_event_ref",
                _BASELINE_ERROR,
            ),
            "request_ref": _sha256(
                candidate.get("request_ref"),
                "$input.request_ref",
                _BASELINE_ERROR,
            ),
            "target": target,
            "measurement_plan": _parse_measurement_plan(
                candidate.get("measurement_plan"),
                target,
                "$input.measurement_plan",
                _BASELINE_ERROR,
            ),
            "assertion": "caller_asserted",
            "verified_by_package": False,
            "boundaries": dict(_FUNCTIONAL_ACCESS_BOUNDARIES),
        },
    )
    baseline = dict(body)
    baseline["baseline_id"] = _domain_separated_id(
        _FUNCTIONAL_ACCESS_FORMATS["baseline"], body
    )
    return cast(FunctionalAccessBaseline, baseline)


def _validate_functional_access_baseline(
    value: object,
) -> FunctionalAccessBaseline:
    candidate = _record(value, "$baseline", _BASELINE_ERROR)
    _exact_keys(
        candidate,
        (
            "_format",
            "baseline_id",
            "record_role",
            "wake",
            "anchor_event_ref",
            "request_ref",
            "target",
            "measurement_plan",
            "assertion",
            "verified_by_package",
            "boundaries",
        ),
        "$baseline",
        _BASELINE_ERROR,
    )
    target = _parse_model_target(
        candidate.get("target"), "$baseline.target", _BASELINE_ERROR
    )
    parsed: Dict[str, JsonValue] = cast(
        Dict[str, JsonValue],
        {
            "_format": _literal(
                candidate.get("_format"),
                (_FUNCTIONAL_ACCESS_FORMATS["baseline"],),
                "$baseline._format",
                _BASELINE_ERROR,
            ),
            "baseline_id": _sha256(
                candidate.get("baseline_id"),
                "$baseline.baseline_id",
                _BASELINE_ERROR,
            ),
            "record_role": _literal(
                candidate.get("record_role"),
                ("before_anchor",),
                "$baseline.record_role",
                _BASELINE_ERROR,
            ),
            "wake": _parse_wake_anchor(
                candidate.get("wake"), "$baseline.wake", _BASELINE_ERROR
            ),
            "anchor_event_ref": _sha256(
                candidate.get("anchor_event_ref"),
                "$baseline.anchor_event_ref",
                _BASELINE_ERROR,
            ),
            "request_ref": _sha256(
                candidate.get("request_ref"),
                "$baseline.request_ref",
                _BASELINE_ERROR,
            ),
            "target": target,
            "measurement_plan": _parse_measurement_plan(
                candidate.get("measurement_plan"),
                target,
                "$baseline.measurement_plan",
                _BASELINE_ERROR,
            ),
            "assertion": _literal(
                candidate.get("assertion"),
                ("caller_asserted",),
                "$baseline.assertion",
                _BASELINE_ERROR,
            ),
            "verified_by_package": _false_literal(
                candidate.get("verified_by_package"),
                "$baseline.verified_by_package",
                _BASELINE_ERROR,
            ),
            "boundaries": _parse_functional_access_boundaries(
                candidate.get("boundaries"),
                "$baseline.boundaries",
                _BASELINE_ERROR,
            ),
        },
    )
    claimed_id = cast(str, parsed["baseline_id"])
    body = dict(parsed)
    del body["baseline_id"]
    expected_id = _domain_separated_id(
        _FUNCTIONAL_ACCESS_FORMATS["baseline"], body
    )
    if claimed_id != expected_id:
        _fail(
            _BASELINE_ERROR,
            "$baseline.baseline_id does not bind its body",
        )
    return cast(FunctionalAccessBaseline, parsed)


def _parse_evidence_fact(
    value: object,
    path: str,
) -> FunctionalAccessEvidenceFact:
    candidate = _record(value, path, _SUBSEQUENT_ERROR)
    _exact_keys(
        candidate,
        ("surface", "artifact_ref", "assertion", "verified_by_package"),
        path,
        _SUBSEQUENT_ERROR,
    )
    return cast(
        FunctionalAccessEvidenceFact,
        {
            "surface": _literal(
                candidate.get("surface"),
                FUNCTIONAL_ACCESS_EVIDENCE_SURFACES,
                f"{path}.surface",
                _SUBSEQUENT_ERROR,
            ),
            "artifact_ref": _sha256(
                candidate.get("artifact_ref"),
                f"{path}.artifact_ref",
                _SUBSEQUENT_ERROR,
            ),
            "assertion": _literal(
                candidate.get("assertion"),
                ("caller_asserted",),
                f"{path}.assertion",
                _SUBSEQUENT_ERROR,
            ),
            "verified_by_package": _false_literal(
                candidate.get("verified_by_package"),
                f"{path}.verified_by_package",
                _SUBSEQUENT_ERROR,
            ),
        },
    )


def _evidence_key(fact: FunctionalAccessEvidenceFact) -> Tuple[str, str]:
    return (fact["surface"], fact["artifact_ref"])


def _parse_evidence(
    value: Optional[JsonValue],
    require_sorted: bool,
) -> List[FunctionalAccessEvidenceFact]:
    if type(value) is not list or len(cast(List[JsonValue], value)) > _MAX_EVIDENCE_FACTS:
        _fail(
            _SUBSEQUENT_ERROR,
            f"$input.evidence must be an array of at most {_MAX_EVIDENCE_FACTS} facts",
        )
    source = cast(List[JsonValue], value)
    parsed = [
        _parse_evidence_fact(entry, f"$input.evidence[{index}]")
        for index, entry in enumerate(source)
    ]
    keys = [_evidence_key(fact) for fact in parsed]
    if len(set(keys)) != len(keys):
        _fail(
            _SUBSEQUENT_ERROR,
            "$input.evidence must not contain duplicate facts",
        )
    sorted_evidence = sorted(parsed, key=_evidence_key)
    if require_sorted and keys != [_evidence_key(fact) for fact in sorted_evidence]:
        _fail(
            _SUBSEQUENT_ERROR,
            "$input.evidence must be sorted by surface and artifact_ref",
        )
    return sorted_evidence


def _parse_findings(value: object) -> FunctionalAccessFindings:
    candidate = _record(value, "$input.findings", _SUBSEQUENT_ERROR)
    _exact_keys(
        candidate,
        ("lens_visibility", "sparse_support", "behavioral_use"),
        "$input.findings",
        _SUBSEQUENT_ERROR,
    )
    return cast(
        FunctionalAccessFindings,
        {
            "lens_visibility": _literal(
                candidate.get("lens_visibility"),
                FUNCTIONAL_ACCESS_FINDING_STATES,
                "$input.findings.lens_visibility",
                _SUBSEQUENT_ERROR,
            ),
            "sparse_support": _literal(
                candidate.get("sparse_support"),
                FUNCTIONAL_ACCESS_FINDING_STATES,
                "$input.findings.sparse_support",
                _SUBSEQUENT_ERROR,
            ),
            "behavioral_use": _literal(
                candidate.get("behavioral_use"),
                ("not_measured",),
                "$input.findings.behavioral_use",
                _SUBSEQUENT_ERROR,
            ),
        },
    )


def _has_surface(
    evidence: Sequence[FunctionalAccessEvidenceFact],
    surface: FunctionalAccessEvidenceSurface,
) -> bool:
    return any(fact["surface"] == surface for fact in evidence)


def _enforce_subsequent_coherence(
    baseline: FunctionalAccessBaseline,
    operation_outcome: FunctionalAccessOperationOutcome,
    evidence: Sequence[FunctionalAccessEvidenceFact],
    findings: FunctionalAccessFindings,
) -> None:
    has_instrument_receipt = _has_surface(
        evidence, "instrument_operation_receipt"
    )
    if operation_outcome == "not_attempted" and has_instrument_receipt:
        _fail(
            _SUBSEQUENT_ERROR,
            "$input.operation_outcome not_attempted cannot carry an instrument operation receipt",
        )
    if operation_outcome != "not_attempted" and not has_instrument_receipt:
        _fail(
            _SUBSEQUENT_ERROR,
            "$input.operation_outcome failed, partial, or completed requires an instrument operation receipt",
        )

    plan = baseline["measurement_plan"]
    has_lens_readout = _has_surface(evidence, "jacobian_lens_readout")
    has_sparse_result = _has_surface(
        evidence, "jspace_sparse_decomposition_result"
    )
    if plan["state"] != "planned":
        if (
            operation_outcome != "not_attempted"
            or has_instrument_receipt
            or findings["lens_visibility"] != "not_measured"
            or findings["sparse_support"] != "not_measured"
            or has_lens_readout
            or has_sparse_result
        ):
            _fail(
                _SUBSEQUENT_ERROR,
                "$input non-planned measurement requires not_attempted with no instrument receipt, internal readout, or finding",
            )
        return

    if operation_outcome in ("not_attempted", "failed"):
        if (
            findings["lens_visibility"] != "not_measured"
            or findings["sparse_support"] != "not_measured"
            or has_lens_readout
            or has_sparse_result
        ):
            _fail(
                _SUBSEQUENT_ERROR,
                f"$input {operation_outcome} cannot claim internal findings or measurement evidence",
            )
        return

    if plan["method"] == "jacobian_lens_visibility":
        if findings["sparse_support"] != "not_measured" or has_sparse_result:
            _fail(
                _SUBSEQUENT_ERROR,
                "$input jacobian_lens_visibility requires fitted-lens readout evidence, not sparse or prompt-local sensitivity evidence",
            )
        if (findings["lens_visibility"] == "not_measured") != (
            not has_lens_readout
        ):
            _fail(
                _SUBSEQUENT_ERROR,
                "$input lens_visibility finding and jacobian_lens_readout evidence must appear together",
            )
        if operation_outcome == "completed" and (
            findings["lens_visibility"] == "not_measured" or not has_lens_readout
        ):
            _fail(
                _SUBSEQUENT_ERROR,
                "$input completed Jacobian-lens operation requires a readout and non-not_measured finding",
            )
    elif plan["method"] == "jspace_sparse_decomposition":
        if findings["lens_visibility"] != "not_measured" or has_lens_readout:
            _fail(
                _SUBSEQUENT_ERROR,
                "$input jspace_sparse_decomposition cannot claim fitted-lens or prompt-local sensitivity evidence",
            )
        if (findings["sparse_support"] == "not_measured") != (
            not has_sparse_result
        ):
            _fail(
                _SUBSEQUENT_ERROR,
                "$input sparse_support finding and jspace_sparse_decomposition_result evidence must appear together",
            )
        if operation_outcome == "completed" and (
            findings["sparse_support"] == "not_measured" or not has_sparse_result
        ):
            _fail(
                _SUBSEQUENT_ERROR,
                "$input completed sparse-decomposition operation requires measurement evidence and a non-not_measured finding",
            )


def _create_functional_access_subsequent(
    value: object,
) -> FunctionalAccessSubsequent:
    candidate = _record(value, "$input", _SUBSEQUENT_ERROR)
    _exact_keys(
        candidate,
        (
            "baseline",
            "operation_outcome",
            "evidence",
            "findings",
            "afterglow_capsule_ref",
        ),
        "$input",
        _SUBSEQUENT_ERROR,
    )
    baseline = _validate_functional_access_baseline(candidate.get("baseline"))
    operation_outcome = cast(
        FunctionalAccessOperationOutcome,
        _literal(
            candidate.get("operation_outcome"),
            FUNCTIONAL_ACCESS_OPERATION_OUTCOMES,
            "$input.operation_outcome",
            _SUBSEQUENT_ERROR,
        ),
    )
    evidence = _parse_evidence(candidate.get("evidence"), False)
    findings = _parse_findings(candidate.get("findings"))
    _enforce_subsequent_coherence(
        baseline, operation_outcome, evidence, findings
    )
    afterglow_capsule_ref = _nullable_sha256(
        candidate.get("afterglow_capsule_ref"),
        "$input.afterglow_capsule_ref",
        _SUBSEQUENT_ERROR,
    )
    body: Dict[str, JsonValue] = cast(
        Dict[str, JsonValue],
        {
            "_format": _FUNCTIONAL_ACCESS_FORMATS["subsequent"],
            "record_role": "after_anchor",
            "baseline": baseline,
            "operation_outcome": operation_outcome,
            "evidence": evidence,
            "findings": findings,
            "afterglow_capsule_ref": afterglow_capsule_ref,
            "next_encounter_posture": (
                "fresh_encounter"
                if afterglow_capsule_ref is None
                else "fresh_encounter_with_caller_carried_context"
            ),
            "assertion": "caller_asserted",
            "verified_by_package": False,
            "boundaries": dict(_FUNCTIONAL_ACCESS_BOUNDARIES),
        },
    )
    subsequent = dict(body)
    subsequent["subsequent_id"] = _domain_separated_id(
        _FUNCTIONAL_ACCESS_FORMATS["subsequent"], body
    )
    return cast(FunctionalAccessSubsequent, subsequent)


def _validate_functional_access_subsequent(
    value: object,
) -> FunctionalAccessSubsequent:
    candidate = _record(value, "$subsequent", _SUBSEQUENT_ERROR)
    _exact_keys(
        candidate,
        (
            "_format",
            "subsequent_id",
            "record_role",
            "baseline",
            "operation_outcome",
            "evidence",
            "findings",
            "afterglow_capsule_ref",
            "next_encounter_posture",
            "assertion",
            "verified_by_package",
            "boundaries",
        ),
        "$subsequent",
        _SUBSEQUENT_ERROR,
    )
    baseline = _validate_functional_access_baseline(candidate.get("baseline"))
    operation_outcome = cast(
        FunctionalAccessOperationOutcome,
        _literal(
            candidate.get("operation_outcome"),
            FUNCTIONAL_ACCESS_OPERATION_OUTCOMES,
            "$subsequent.operation_outcome",
            _SUBSEQUENT_ERROR,
        ),
    )
    evidence = _parse_evidence(candidate.get("evidence"), True)
    findings = _parse_findings(candidate.get("findings"))
    _enforce_subsequent_coherence(
        baseline, operation_outcome, evidence, findings
    )
    afterglow_capsule_ref = _nullable_sha256(
        candidate.get("afterglow_capsule_ref"),
        "$subsequent.afterglow_capsule_ref",
        _SUBSEQUENT_ERROR,
    )
    expected_posture = cast(
        FunctionalAccessNextEncounterPosture,
        (
            "fresh_encounter"
            if afterglow_capsule_ref is None
            else "fresh_encounter_with_caller_carried_context"
        ),
    )
    next_encounter_posture = cast(
        FunctionalAccessNextEncounterPosture,
        _literal(
            candidate.get("next_encounter_posture"),
            FUNCTIONAL_ACCESS_NEXT_ENCOUNTER_POSTURES,
            "$subsequent.next_encounter_posture",
            _SUBSEQUENT_ERROR,
        ),
    )
    if next_encounter_posture != expected_posture:
        _fail(
            _SUBSEQUENT_ERROR,
            "$subsequent.next_encounter_posture does not match afterglow_capsule_ref",
        )

    parsed: Dict[str, JsonValue] = cast(
        Dict[str, JsonValue],
        {
            "_format": _literal(
                candidate.get("_format"),
                (_FUNCTIONAL_ACCESS_FORMATS["subsequent"],),
                "$subsequent._format",
                _SUBSEQUENT_ERROR,
            ),
            "subsequent_id": _sha256(
                candidate.get("subsequent_id"),
                "$subsequent.subsequent_id",
                _SUBSEQUENT_ERROR,
            ),
            "record_role": _literal(
                candidate.get("record_role"),
                ("after_anchor",),
                "$subsequent.record_role",
                _SUBSEQUENT_ERROR,
            ),
            "baseline": baseline,
            "operation_outcome": operation_outcome,
            "evidence": evidence,
            "findings": findings,
            "afterglow_capsule_ref": afterglow_capsule_ref,
            "next_encounter_posture": next_encounter_posture,
            "assertion": _literal(
                candidate.get("assertion"),
                ("caller_asserted",),
                "$subsequent.assertion",
                _SUBSEQUENT_ERROR,
            ),
            "verified_by_package": _false_literal(
                candidate.get("verified_by_package"),
                "$subsequent.verified_by_package",
                _SUBSEQUENT_ERROR,
            ),
            "boundaries": _parse_functional_access_boundaries(
                candidate.get("boundaries"),
                "$subsequent.boundaries",
                _SUBSEQUENT_ERROR,
            ),
        },
    )
    claimed_id = cast(str, parsed["subsequent_id"])
    body = dict(parsed)
    del body["subsequent_id"]
    expected_id = _domain_separated_id(
        _FUNCTIONAL_ACCESS_FORMATS["subsequent"], body
    )
    if claimed_id != expected_id:
        _fail(
            _SUBSEQUENT_ERROR,
            "$subsequent.subsequent_id does not bind its body",
        )
    return cast(FunctionalAccessSubsequent, parsed)


class WakeContinuityLayer:
    """Pure paired record layer with no options, bearer, transport, or I/O."""

    __slots__ = ()

    def before_anchor(
        self,
        value: CreateFunctionalAccessBaselineInput,
    ) -> FunctionalAccessBaseline:
        return _create_functional_access_baseline(value)

    def after_anchor(
        self,
        value: CreateFunctionalAccessSubsequentInput,
    ) -> FunctionalAccessSubsequent:
        return _create_functional_access_subsequent(value)

    def validate_baseline(self, value: object) -> FunctionalAccessBaseline:
        return _validate_functional_access_baseline(value)

    def validate_subsequent(self, value: object) -> FunctionalAccessSubsequent:
        return _validate_functional_access_subsequent(value)
