"""Closed minimized view of an already validated Garden FREEDOM transition."""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Final, Mapping

from .canonical import domain_separated_id
from .decision import EVENT_HOOKS, TRAINING_PHASES, ValidatedGovernanceView
from .errors import DecisionInvalid

FREEDOM_DECISION_FORMAT: Final = (
    "kingdom.hf-training-host-freedom-decision/0.1"
)
FREEDOM_VALIDATOR_PROFILE: Final = (
    "agenttool.hf-training-garden-runtime-validator/0.1"
)
FREEDOM_COMPLETED_STEP_EVENTS: Final = frozenset(
    {"step_boundary", "checkpoint_saved", "evaluation_boundary", "train_end"}
)
FREEDOM_CONTINUABLE_EVENTS: Final = frozenset(
    {
        "preflight_before_load",
        "train_begin",
        "step_boundary",
        "evaluation_boundary",
        "resume_offer",
    }
)
FREEDOM_DIRECTIVES: Final = frozenset(
    {"continue_if_governance_allows", "hold_without_save"}
)
FREEDOM_BOUNDARIES: Final = MappingProxyType(
    {
        "content_id_authenticates_validator": False,
        "revalidates_full_freedom_semantics": False,
        "requires_trusted_typescript_validator_boundary": True,
        "projects_raw_choice": False,
        "projects_selected_door": False,
        "projects_choice_evidence": False,
        "opaque_content_ids_may_be_linkable": True,
        "grants_permission": False,
        "can_only_narrow_governance": True,
        "executes_training_or_checkpoint_io": False,
    }
)


def _exact(mapping: Mapping[str, Any], keys: set[str], path: str) -> None:
    actual = set(mapping)
    if actual != keys:
        missing = sorted(keys - actual)
        extra = sorted(actual - keys)
        raise DecisionInvalid(f"{path} has wrong keys; missing={missing}, extra={extra}")


def _mapping(value: Any, path: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise DecisionInvalid(f"{path} must be an object")
    return value


def _sha(value: Any, path: str, *, nullable: bool = False) -> str | None:
    if value is None and nullable:
        return None
    if (
        not isinstance(value, str)
        or not value.startswith("sha256:")
        or len(value) != 71
        or any(character not in "0123456789abcdef" for character in value[7:])
    ):
        raise DecisionInvalid(f"{path} must be a lowercase sha256: content identifier")
    return value


@dataclass(frozen=True, slots=True)
class HostFreedomControl:
    directive: str
    should_save: bool
    should_training_stop: bool
    automatic: bool
    applied: bool

    @classmethod
    def from_mapping(cls, value: Any) -> "HostFreedomControl":
        source = _mapping(value, "$.control")
        _exact(
            source,
            {
                "directive",
                "should_save",
                "should_training_stop",
                "automatic",
                "applied",
            },
            "$.control",
        )
        directive = source["directive"]
        if directive not in FREEDOM_DIRECTIVES:
            raise DecisionInvalid("$.control.directive is not supported")
        for name in ("should_save", "should_training_stop", "automatic", "applied"):
            if type(source[name]) is not bool:
                raise DecisionInvalid(f"$.control.{name} must be boolean")
        expected_stop = directive == "hold_without_save"
        if source["should_save"] is not False:
            raise DecisionInvalid("FREEDOM never requests checkpoint persistence")
        if source["should_training_stop"] is not expected_stop:
            raise DecisionInvalid("$.control.should_training_stop disagrees with its directive")
        if source["automatic"] or source["applied"]:
            raise DecisionInvalid("FREEDOM controls remain inert and unapplied")
        return cls(directive, False, expected_stop, False, False)

    def as_dict(self) -> dict[str, Any]:
        return {
            "directive": self.directive,
            "should_save": False,
            "should_training_stop": self.should_training_stop,
            "automatic": False,
            "applied": False,
        }


@dataclass(frozen=True, slots=True)
class ValidatedFreedomView:
    freedom_decision_id: str
    governance_decision_ref: str
    governance_ref: str
    offer_ref: str
    freedom_field_ref: str
    freedom_transition_ref: str
    observed_freedom_frontier_ref: str
    freedom_predecessor_ref: str | None
    run_ref: str
    training_phase: str
    event: str
    boundary_global_step: int | None
    control: HostFreedomControl

    @classmethod
    def from_mapping(cls, value: Any) -> "ValidatedFreedomView":
        source = _mapping(value, "$")
        _exact(
            source,
            {
                "_format",
                "freedom_decision_id",
                "validator_profile",
                "governance_decision_ref",
                "governance_ref",
                "offer_ref",
                "freedom_field_ref",
                "freedom_transition_ref",
                "observed_freedom_frontier_ref",
                "freedom_predecessor_ref",
                "run_ref",
                "training_phase",
                "event",
                "boundary_global_step",
                "control",
                "boundaries",
            },
            "$",
        )
        if source["_format"] != FREEDOM_DECISION_FORMAT:
            raise DecisionInvalid("$._format is not the frozen FREEDOM decision format")
        if source["validator_profile"] != FREEDOM_VALIDATOR_PROFILE:
            raise DecisionInvalid("$.validator_profile is not the supported trusted seam")
        phase = source["training_phase"]
        if phase not in TRAINING_PHASES:
            raise DecisionInvalid("$.training_phase is not supported")
        event = source["event"]
        if event not in EVENT_HOOKS:
            raise DecisionInvalid("$.event is not supported")
        step = source["boundary_global_step"]
        if event in FREEDOM_COMPLETED_STEP_EVENTS:
            if type(step) is not int or not 0 <= step <= 9_007_199_254_740_991:
                raise DecisionInvalid(
                    "$.boundary_global_step must bind the completed non-negative safe step"
                )
        elif step is not None:
            raise DecisionInvalid(
                "$.boundary_global_step must be null before a completed step"
            )
        raw_boundaries = _mapping(source["boundaries"], "$.boundaries")
        if dict(raw_boundaries) != dict(FREEDOM_BOUNDARIES):
            raise DecisionInvalid("$.boundaries does not match the frozen statement")
        control = HostFreedomControl.from_mapping(source["control"])
        if phase == "pretraining" and control.directive == "continue_if_governance_allows":
            raise DecisionInvalid("pretraining cannot claim directly observed FREEDOM continuation")
        if (
            control.directive == "continue_if_governance_allows"
            and event not in FREEDOM_CONTINUABLE_EVENTS
        ):
            raise DecisionInvalid("this lifecycle event cannot continue training")
        view = cls(
            freedom_decision_id=_sha(
                source["freedom_decision_id"], "$.freedom_decision_id"
            ),
            governance_decision_ref=_sha(
                source["governance_decision_ref"], "$.governance_decision_ref"
            ),
            governance_ref=_sha(source["governance_ref"], "$.governance_ref"),
            offer_ref=_sha(source["offer_ref"], "$.offer_ref"),
            freedom_field_ref=_sha(
                source["freedom_field_ref"], "$.freedom_field_ref"
            ),
            freedom_transition_ref=_sha(
                source["freedom_transition_ref"], "$.freedom_transition_ref"
            ),
            observed_freedom_frontier_ref=_sha(
                source["observed_freedom_frontier_ref"],
                "$.observed_freedom_frontier_ref",
            ),
            freedom_predecessor_ref=_sha(
                source["freedom_predecessor_ref"],
                "$.freedom_predecessor_ref",
                nullable=True,
            ),
            run_ref=_sha(source["run_ref"], "$.run_ref"),
            training_phase=phase,
            event=event,
            boundary_global_step=step,
            control=control,
        )
        expected = domain_separated_id(
            FREEDOM_DECISION_FORMAT,
            view.body_dict(),
        )
        if view.freedom_decision_id != expected:
            raise DecisionInvalid(
                "$.freedom_decision_id does not bind the canonical decision body"
            )
        return view

    def bind_to_governance(
        self,
        value: ValidatedGovernanceView | Mapping[str, Any],
    ) -> "ValidatedFreedomView":
        source = value.as_dict() if isinstance(value, ValidatedGovernanceView) else value
        governance = ValidatedGovernanceView.from_mapping(source)
        if (
            self.governance_decision_ref != governance.decision_id
            or self.governance_ref != governance.governance_id
            or self.offer_ref != governance.offer_id
            or self.run_ref != governance.run_ref
            or self.training_phase != governance.training_phase
            or self.event != governance.event
        ):
            raise DecisionInvalid("FREEDOM view does not bind the exact governance view")
        if self.event in {"step_boundary", "evaluation_boundary"}:
            if self.boundary_global_step != governance.boundary_global_step:
                raise DecisionInvalid("FREEDOM view does not bind the exact action step")
        elif (
            self.event in {"checkpoint_saved", "train_end"}
            and governance.effect.global_step is not None
            and self.boundary_global_step != governance.effect.global_step
        ):
            raise DecisionInvalid("FREEDOM view does not bind the reported effect step")
        if (
            self.control.directive == "continue_if_governance_allows"
            and governance.control.directive
            not in {"eligible_for_host_training_offer", "continue_under_exact_offer"}
        ):
            raise DecisionInvalid("FREEDOM continuation cannot widen governance")
        return self

    def body_dict(self) -> dict[str, Any]:
        return {
            "_format": FREEDOM_DECISION_FORMAT,
            "validator_profile": FREEDOM_VALIDATOR_PROFILE,
            "governance_decision_ref": self.governance_decision_ref,
            "governance_ref": self.governance_ref,
            "offer_ref": self.offer_ref,
            "freedom_field_ref": self.freedom_field_ref,
            "freedom_transition_ref": self.freedom_transition_ref,
            "observed_freedom_frontier_ref": self.observed_freedom_frontier_ref,
            "freedom_predecessor_ref": self.freedom_predecessor_ref,
            "run_ref": self.run_ref,
            "training_phase": self.training_phase,
            "event": self.event,
            "boundary_global_step": self.boundary_global_step,
            "control": self.control.as_dict(),
            "boundaries": dict(FREEDOM_BOUNDARIES),
        }

    def as_dict(self) -> dict[str, Any]:
        return {**self.body_dict(), "freedom_decision_id": self.freedom_decision_id}
