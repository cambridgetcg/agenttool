"""Parity and capability-boundary tests for the pure functional-access layer."""

from __future__ import annotations

from copy import deepcopy
from typing import Any, Dict, List, Optional, cast

import httpx
import pytest

import agenttool
from agenttool import (
    AgentTool,
    AgentToolError,
    FUNCTIONAL_ACCESS_BOUNDARIES,
    FUNCTIONAL_ACCESS_FORMATS,
    WakeContinuityLayer,
)
from agenttool.wake_continuity import (
    FunctionalAccessEvidenceFact,
    FunctionalAccessMeasurementPlan,
    FunctionalAccessModelTarget,
)


def _id(character: str) -> str:
    return f"sha256:{character * 64}"


WAKE = {
    "format": "wake-brief/v1",
    "snapshot_ref": _id("a"),
    "scope_ref": _id("b"),
    "wake_version": 17,
    "handoff_projection": "complete",
}

EXACT_TARGET: FunctionalAccessModelTarget = {
    "model_ref": _id("c"),
    "model_binding": "exact_checkpoint",
    "tokenizer_ref": _id("d"),
    "runtime_ref": _id("e"),
}

PROVIDER_TARGET: FunctionalAccessModelTarget = {
    "model_ref": _id("f"),
    "model_binding": "provider_alias",
    "tokenizer_ref": None,
    "runtime_ref": None,
}

NOT_REQUESTED_PLAN: FunctionalAccessMeasurementPlan = {
    "state": "not_requested",
    "capability_state": "not_asserted",
    "capability_ref": None,
    "permission_state": "not_requested",
    "permission_ref": None,
    "method": "none",
    "access_basis": "none",
    "unavailable_reason": None,
    "instrument_ref": None,
    "lens_ref": None,
    "configuration_ref": None,
    "assertion": "caller_asserted",
    "verified_by_package": False,
}

UNAVAILABLE_PLAN: FunctionalAccessMeasurementPlan = {
    "state": "unavailable",
    "capability_state": "unavailable_reported",
    "capability_ref": _id("1"),
    "permission_state": "denied_reported",
    "permission_ref": _id("2"),
    "method": "jacobian_lens_visibility",
    "access_basis": "none",
    "unavailable_reason": "text_only_provider_surface",
    "instrument_ref": None,
    "lens_ref": None,
    "configuration_ref": None,
    "assertion": "caller_asserted",
    "verified_by_package": False,
}

PLANNED_LENS_PLAN: FunctionalAccessMeasurementPlan = {
    "state": "planned",
    "capability_state": "available_reported",
    "capability_ref": _id("3"),
    "permission_state": "granted_reported",
    "permission_ref": _id("4"),
    "method": "jacobian_lens_visibility",
    "access_basis": "local_prefitted_white_box",
    "unavailable_reason": None,
    "instrument_ref": _id("5"),
    "lens_ref": _id("6"),
    "configuration_ref": _id("7"),
    "assertion": "caller_asserted",
    "verified_by_package": False,
}

PLANNED_SPARSE_PLAN: FunctionalAccessMeasurementPlan = {
    **PLANNED_LENS_PLAN,
    "method": "jspace_sparse_decomposition",
    "access_basis": "local_fitted_white_box",
    "lens_ref": None,
    "configuration_ref": _id("8"),
}

NO_FINDINGS = {
    "lens_visibility": "not_measured",
    "sparse_support": "not_measured",
    "behavioral_use": "not_measured",
}


def _baseline(
    measurement_plan: FunctionalAccessMeasurementPlan = PLANNED_LENS_PLAN,
    target: FunctionalAccessModelTarget = EXACT_TARGET,
):
    return WakeContinuityLayer().before_anchor(
        {
            "wake": cast(Any, WAKE),
            "anchor_event_ref": _id("9"),
            "request_ref": _id("0"),
            "target": target,
            "measurement_plan": measurement_plan,
        }
    )


def _fact(surface: str, artifact_ref: str) -> FunctionalAccessEvidenceFact:
    return cast(
        FunctionalAccessEvidenceFact,
        {
            "surface": surface,
            "artifact_ref": artifact_ref,
            "assertion": "caller_asserted",
            "verified_by_package": False,
        },
    )


def _subsequent(
    baseline=None,
    operation_outcome: str = "not_attempted",
    evidence: Optional[List[FunctionalAccessEvidenceFact]] = None,
    findings: Optional[Dict[str, str]] = None,
    afterglow_capsule_ref: Optional[str] = None,
):
    return WakeContinuityLayer().after_anchor(
        cast(
            Any,
            {
                "baseline": _baseline() if baseline is None else baseline,
                "operation_outcome": operation_outcome,
                "evidence": [] if evidence is None else evidence,
                "findings": NO_FINDINGS if findings is None else findings,
                "afterglow_capsule_ref": afterglow_capsule_ref,
            },
        )
    )


def test_baseline_shared_vector_and_closed_boundaries() -> None:
    layer = WakeContinuityLayer()
    value = _baseline()

    assert value["baseline_id"] == (
        "sha256:1700ace293d82450be1386880347ec01698ff0f1623ef10b493b4d5a81dc9c0a"
    )
    assert value["_format"] == FUNCTIONAL_ACCESS_FORMATS["baseline"]
    assert value["record_role"] == "before_anchor"
    assert value["boundaries"] == dict(FUNCTIONAL_ACCESS_BOUNDARIES)
    assert value["boundaries"]["record_only"] is True
    assert value["boundaries"]["performs_observation"] is False
    assert value["boundaries"]["performs_model_call"] is False
    assert value["boundaries"]["performs_workspace_operation"] is False
    assert value["boundaries"]["proves_deepest_reach"] is False
    assert value["boundaries"]["proves_training_data_provenance"] is False
    assert value["boundaries"]["proves_weight_change"] is False
    assert value["verified_by_package"] is False
    assert layer.validate_baseline(value) == value

    assert agenttool.WakeContinuityLayer is WakeContinuityLayer
    assert "WakeContinuityLayer" in agenttool.__all__
    with pytest.raises(TypeError):
        cast(Any, FUNCTIONAL_ACCESS_BOUNDARIES)["new_capability"] = True


def test_plan_cross_fields_and_closed_baseline_shape() -> None:
    assert _baseline(NOT_REQUESTED_PLAN, PROVIDER_TARGET)["measurement_plan"][
        "state"
    ] == "not_requested"
    assert _baseline(UNAVAILABLE_PLAN, PROVIDER_TARGET)["measurement_plan"][
        "state"
    ] == "unavailable"

    invalid_plans = []
    for key, value in (
        ("method", "jacobian_lens_visibility"),
        ("unavailable_reason", None),
        ("capability_ref", None),
        ("permission_ref", None),
    ):
        source = NOT_REQUESTED_PLAN if key == "method" else UNAVAILABLE_PLAN
        invalid_plans.append({**source, key: value})
    invalid_plans.extend(
        [
            {**PLANNED_LENS_PLAN, "capability_state": "unavailable_reported"},
            {**PLANNED_LENS_PLAN, "permission_state": "denied_reported"},
            {**PLANNED_LENS_PLAN, "instrument_ref": None},
            {**PLANNED_LENS_PLAN, "configuration_ref": None},
            {**PLANNED_LENS_PLAN, "lens_ref": None},
            {**PLANNED_LENS_PLAN, "access_basis": "local_fitted_white_box"},
        ]
    )
    for invalid in invalid_plans:
        with pytest.raises(AgentToolError):
            _baseline(cast(FunctionalAccessMeasurementPlan, invalid))

    with pytest.raises(AgentToolError, match="exact checkpoint"):
        _baseline(PLANNED_LENS_PLAN, PROVIDER_TARGET)

    layer = WakeContinuityLayer()
    extra = {**_baseline(), "raw_prompt": "private"}
    with pytest.raises(AgentToolError, match="contain exactly"):
        layer.validate_baseline(extra)
    with pytest.raises(AgentToolError, match="does not bind"):
        layer.validate_baseline({**_baseline(), "baseline_id": _id("a")})
    with pytest.raises(AgentToolError):
        layer.validate_baseline({**_baseline(), "verified_by_package": True})


def test_subsequent_shared_vector_sorting_and_posture() -> None:
    layer = WakeContinuityLayer()
    value = _subsequent(
        _baseline(NOT_REQUESTED_PLAN, PROVIDER_TARGET),
        evidence=[
            _fact("workspace_operation", _id("e")),
            _fact("provider_response_receipt", _id("d")),
            _fact("usage_receipt", _id("c")),
        ],
        afterglow_capsule_ref=_id("b"),
    )

    assert value["subsequent_id"] == (
        "sha256:14c84d5b7223cb5a9a82e4c88e0ddda830c940dc874d86829acda36d276336fe"
    )
    assert value["record_role"] == "after_anchor"
    assert [fact["surface"] for fact in value["evidence"]] == [
        "provider_response_receipt",
        "usage_receipt",
        "workspace_operation",
    ]
    assert value["next_encounter_posture"] == (
        "fresh_encounter_with_caller_carried_context"
    )
    assert layer.validate_subsequent(value) == value

    duplicate = _fact("request_context", _id("1"))
    with pytest.raises(AgentToolError, match="duplicate"):
        _subsequent(evidence=[duplicate, duplicate])

    unsorted = deepcopy(value)
    unsorted["evidence"].reverse()
    with pytest.raises(AgentToolError, match="sorted"):
        layer.validate_subsequent(unsorted)

    wrong_posture = {**value, "next_encounter_posture": "fresh_encounter"}
    with pytest.raises(AgentToolError, match="does not match"):
        layer.validate_subsequent(wrong_posture)


def test_provider_workspace_receipts_are_not_instrument_claims() -> None:
    non_planned = _baseline(UNAVAILABLE_PLAN, PROVIDER_TARGET)
    assert _subsequent(
        non_planned,
        evidence=[
            _fact("workspace_operation", _id("1")),
            _fact("provider_response_receipt", _id("2")),
            _fact("usage_receipt", _id("3")),
        ],
    )["operation_outcome"] == "not_attempted"

    with pytest.raises(AgentToolError, match="non-planned"):
        _subsequent(
            non_planned,
            "failed",
            [_fact("instrument_operation_receipt", _id("4"))],
        )
    with pytest.raises(AgentToolError, match="instrument operation receipt"):
        _subsequent(_baseline(), "failed", [])
    with pytest.raises(AgentToolError, match="cannot carry"):
        _subsequent(
            _baseline(),
            "not_attempted",
            [_fact("instrument_operation_receipt", _id("5"))],
        )


@pytest.mark.parametrize(
    ("plan", "surface", "findings"),
    [
        (
            PLANNED_LENS_PLAN,
            "jacobian_lens_readout",
            {**NO_FINDINGS, "lens_visibility": "inconclusive"},
        ),
        (
            PLANNED_SPARSE_PLAN,
            "jspace_sparse_decomposition_result",
            {**NO_FINDINGS, "sparse_support": "hit_observed"},
        ),
    ],
)
def test_method_specific_partial_and_completed_matrix(
    plan: FunctionalAccessMeasurementPlan,
    surface: str,
    findings: Dict[str, str],
) -> None:
    baseline = _baseline(plan)
    receipt = _fact("instrument_operation_receipt", _id("a"))
    assert _subsequent(baseline, "partial", [receipt])
    evidence = [receipt, _fact(surface, _id("b"))]
    assert _subsequent(baseline, "partial", evidence, findings)["findings"] == findings
    assert _subsequent(baseline, "completed", evidence, findings)[
        "operation_outcome"
    ] == "completed"
    with pytest.raises(AgentToolError, match="requires"):
        _subsequent(baseline, "completed", [receipt])


def test_hostile_values_fail_closed_without_entering_overrides() -> None:
    entered: List[str] = []

    class HostileDict(dict):
        def items(self):
            entered.append("items")
            raise RuntimeError("caller code executed")

        def __iter__(self):
            entered.append("iter")
            raise RuntimeError("caller code executed")

    class HostileList(list):
        def __iter__(self):
            entered.append("iter")
            raise RuntimeError("caller code executed")

    class HostileMeta(type):
        def __getattribute__(cls, name):
            entered.append(name)
            raise RuntimeError("metaclass hook entered")

    class HostileObject(metaclass=HostileMeta):
        pass

    layer = WakeContinuityLayer()
    with pytest.raises(AgentToolError):
        layer.before_anchor(cast(Any, HostileDict()))
    with pytest.raises(AgentToolError):
        layer.before_anchor(cast(Any, HostileList()))
    with pytest.raises(AgentToolError):
        layer.before_anchor(cast(Any, HostileObject()))
    assert entered == []

    cycle: Dict[str, Any] = {}
    cycle["self"] = cycle
    with pytest.raises(AgentToolError, match="cycle"):
        layer.before_anchor(cast(Any, cycle))

    bool_cursor = deepcopy(WAKE)
    bool_cursor["wake_version"] = True
    invalid = {
        "wake": bool_cursor,
        "anchor_event_ref": _id("9"),
        "request_ref": _id("0"),
        "target": EXACT_TARGET,
        "measurement_plan": PLANNED_LENS_PLAN,
    }
    with pytest.raises(AgentToolError, match="safe integer"):
        layer.before_anchor(cast(Any, invalid))


def test_cached_composition_receives_no_transport_or_bearer() -> None:
    requests: List[httpx.Request] = []

    def handler(request: httpx.Request) -> httpx.Response:
        requests.append(request)
        raise AssertionError("transport must remain unreachable")

    with AgentTool(transport=httpx.MockTransport(handler)) as at:
        assert at.wake_continuity is at.wake_continuity
        assert isinstance(at.wake_continuity, WakeContinuityLayer)
        assert not hasattr(at.wake_continuity, "_http")
        assert not hasattr(at.wake_continuity, "_api_key")
        assert requests == []

    with pytest.raises(TypeError):
        WakeContinuityLayer(object())  # type: ignore[call-arg]
