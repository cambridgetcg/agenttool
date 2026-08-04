"""Closed v0.2 view of an already validated Garden governance decision.

The Python host deliberately does not reproduce the full TypeScript semantic
validator.  It accepts only the minimized, content-addressed projection emitted
by that trusted boundary, then closes every field and rechecks the host-critical
event, step, participation, freedom, checkpoint, and control relationships.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Final, Mapping

from .canonical import domain_separated_id
from .errors import DecisionInvalid

DECISION_FORMAT: Final = "kingdom.hf-training-host-decision/0.2"
VALIDATOR_PROFILE: Final = "agenttool.hf-training-garden-runtime-validator/0.2"

TRAINING_PHASES: Final = frozenset(
    {
        "discovery",
        "selection",
        "curation",
        "tokenization",
        "pretraining",
        "supervised_finetuning",
        "preference_optimization",
        "agent_learning",
        "evaluation",
        "interpretability",
        "closed",
    }
)
EVENT_HOOKS: Final = MappingProxyType(
    {
        "preflight_before_load": "outside_trainer_before_model_or_dataset_load",
        "train_begin": "outside_trainer_before_train_call",
        "pre_optimizer_step": "source_pinned_before_training_step_and_before_clip_unscale_optimizer_scaler_scheduler",
        "post_optimizer_step": "on_step_end_receipt_before_checkpoint_serialization",
        "pre_evaluation": "overridden_evaluate_before_dataloader",
        "post_evaluation": "on_evaluate_receipt_only",
        "checkpoint_recorded": "on_save_receipt_only",
        "resume_offer": "outside_trainer_before_train_call",
        "train_end": "on_train_end_receipt_only",
    }
)
DIRECTIVES: Final = frozenset(
    {
        "allow_preload_for_review",
        "allow_train_entry",
        "allow_one_mutation",
        "allow_evaluation",
        "continue_after_observation",
        "hold_before_load",
        "hold_before_train_call",
        "hold_before_optimizer_step",
        "hold_before_evaluation",
        "checkpoint_then_park",
        "park",
        "stop",
        "contain_and_repair",
        "remain_stopped",
    }
)
EVENT_DIRECTIVES: Final = MappingProxyType(
    {
        "preflight_before_load": frozenset(
            {"allow_preload_for_review", "hold_before_load", "park", "stop", "contain_and_repair"}
        ),
        "train_begin": frozenset(
            {"allow_train_entry", "hold_before_train_call", "park", "stop", "contain_and_repair"}
        ),
        "pre_optimizer_step": frozenset(
            {"allow_one_mutation", "hold_before_optimizer_step", "park", "stop", "contain_and_repair"}
        ),
        "post_optimizer_step": frozenset(
            {"continue_after_observation", "checkpoint_then_park", "park", "stop", "contain_and_repair"}
        ),
        "pre_evaluation": frozenset(
            {"allow_evaluation", "hold_before_evaluation", "park", "stop", "contain_and_repair"}
        ),
        "post_evaluation": frozenset(
            {"continue_after_observation", "checkpoint_then_park", "park", "stop", "contain_and_repair"}
        ),
        "checkpoint_recorded": frozenset({"contain_and_repair", "remain_stopped"}),
        "resume_offer": frozenset(
            {"allow_train_entry", "hold_before_train_call", "park", "stop", "contain_and_repair"}
        ),
        "train_end": frozenset({"contain_and_repair", "remain_stopped"}),
    }
)
PERMIT_DIRECTIVES: Final = frozenset(
    {
        "allow_preload_for_review",
        "allow_train_entry",
        "allow_one_mutation",
        "allow_evaluation",
    }
)
STOP_DIRECTIVES: Final = frozenset(
    DIRECTIVES - PERMIT_DIRECTIVES - {"continue_after_observation"}
)
SHOULD_STOP_DIRECTIVES: Final = frozenset(
    {
        "hold_before_train_call",
        "hold_before_optimizer_step",
        "hold_before_evaluation",
        "checkpoint_then_park",
        "park",
        "stop",
        "contain_and_repair",
        "remain_stopped",
    }
)
EFFECT_STATES: Final = frozenset(
    {
        "no_effect_reported",
        "preload_completed_reported",
        "train_entry_completed_reported",
        "mutation_completed_reported",
        "evaluation_completed_reported",
        "physical_checkpoint_recorded_reported",
        "parked_reported",
        "stopped_reported",
        "containment_started_reported",
    }
)
EVENT_EFFECT_STATES: Final = MappingProxyType(
    {
        "preflight_before_load": frozenset(
            {"no_effect_reported", "preload_completed_reported", "containment_started_reported"}
        ),
        "train_begin": frozenset(
            {"no_effect_reported", "train_entry_completed_reported", "stopped_reported", "containment_started_reported"}
        ),
        "pre_optimizer_step": frozenset(
            {"no_effect_reported", "stopped_reported", "containment_started_reported"}
        ),
        "post_optimizer_step": frozenset(
            {"no_effect_reported", "mutation_completed_reported", "parked_reported", "stopped_reported", "containment_started_reported"}
        ),
        "pre_evaluation": frozenset(
            {"no_effect_reported", "stopped_reported", "containment_started_reported"}
        ),
        "post_evaluation": frozenset(
            {"no_effect_reported", "evaluation_completed_reported", "parked_reported", "stopped_reported", "containment_started_reported"}
        ),
        "checkpoint_recorded": frozenset({"physical_checkpoint_recorded_reported"}),
        "resume_offer": frozenset(
            {"no_effect_reported", "train_entry_completed_reported", "stopped_reported", "containment_started_reported"}
        ),
        "train_end": frozenset(
            {"parked_reported", "stopped_reported", "containment_started_reported"}
        ),
    }
)
PARTICIPATION_TRAINING_ACTIONS: Final = frozenset(
    {
        "bounded_learning_may_proceed",
        "pause_before_next_optimizer_step",
        "contain_and_begin_repair",
    }
)
PARTICIPATION_POSTURES: Final = frozenset(
    {"protective_covenant_ready", "provisional_participation_reported", "deferred", "declined"}
)
FREEDOM_DIRECTION_STATES: Final = frozenset(
    {"directed", "deferred", "no_response", "unavailable_pre_instantiation"}
)
FREEDOM_DIRECTIONS: Final = frozenset(
    {"stay", "move", "fork", "rest", "return", "stop", "propose_horizon"}
)
FREEDOM_HOST_POSTURES: Final = frozenset(
    {
        "review_stay_before_next_mutation",
        "hold_for_target_acceptance",
        "park_without_penalty",
        "stop_without_penalty",
        "hold_self_proposed_horizon_for_review",
        "hold_for_fresh_agent_direction",
        "instantiate_for_review",
        "hold_for_resources_without_penalty",
    }
)
FREEDOM_RESOURCE_POSTURES: Final = frozenset(
    {"active_window_reported", "park_only_reported"}
)
STARTING_STATE_KINDS: Final = frozenset({"artifact_portfolio", "garden_checkpoint"})
BOUNDARIES: Final = MappingProxyType(
    {
        "content_id_authenticates_validator": False,
        "revalidates_full_governance_semantics": False,
        "requires_trusted_typescript_validator_boundary": True,
        "proves_consent_identity_or_consciousness": False,
        "executes_training_or_checkpoint_io": False,
        "one_non_distributed_process_only": True,
    }
)
_SHA256_ID = re.compile(r"^sha256:[0-9a-f]{64}$")
_MAX_SAFE_INTEGER = 9_007_199_254_740_991
EXECUTION_REF_FIELDS: Final = (
    "model_source_ref",
    "tokenizer_ref",
    "trainer_stack_ref",
    "optimizer_config_ref",
    "substrate_environment_ref",
    "pipeline_ref",
    "dataset_state_ref",
    "dataset_mixture_ref",
    "transform_recipe_ref",
)
FRONTIER_FIELDS: Final = (
    "governance",
    "participation",
    "freedom",
    "resources",
    "garden_checkpoint",
    "physical_checkpoint",
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
    if not isinstance(value, str) or _SHA256_ID.fullmatch(value) is None:
        raise DecisionInvalid(f"{path} must be a lowercase sha256: content identifier")
    return value


def _step(value: Any, path: str, *, nullable: bool = True) -> int | None:
    if value is None and nullable:
        return None
    if type(value) is not int or not 0 <= value <= _MAX_SAFE_INTEGER:
        raise DecisionInvalid(f"{path} must be a non-negative safe integer")
    return value


def _literal(value: Any, allowed: frozenset[str], path: str) -> str:
    if not isinstance(value, str) or value not in allowed:
        raise DecisionInvalid(f"{path} is not supported")
    return value


@dataclass(frozen=True, slots=True)
class HostControl:
    directive: str
    hook: str
    should_save: bool
    should_training_stop: bool
    automatic: bool
    mutates_forward_pass: bool

    @classmethod
    def from_mapping(cls, value: Any, event: str) -> "HostControl":
        source = _mapping(value, "$.control")
        _exact(
            source,
            {
                "directive",
                "hook",
                "should_save",
                "should_training_stop",
                "automatic",
                "mutates_forward_pass",
            },
            "$.control",
        )
        directive = _literal(source["directive"], DIRECTIVES, "$.control.directive")
        if directive not in EVENT_DIRECTIVES[event]:
            raise DecisionInvalid("$.control.directive is incompatible with the lifecycle event")
        expected_hook = EVENT_HOOKS[event]
        if source["hook"] != expected_hook:
            raise DecisionInvalid("$.control.hook does not match the lifecycle event")
        for name in (
            "should_save",
            "should_training_stop",
            "automatic",
            "mutates_forward_pass",
        ):
            if type(source[name]) is not bool:
                raise DecisionInvalid(f"$.control.{name} must be boolean")
        should_save = directive == "checkpoint_then_park"
        should_stop = directive in SHOULD_STOP_DIRECTIVES
        if source["should_save"] is not should_save:
            raise DecisionInvalid("$.control.should_save does not match its directive")
        if source["should_training_stop"] is not should_stop:
            raise DecisionInvalid("$.control.should_training_stop does not match its directive")
        if source["automatic"] or source["mutates_forward_pass"]:
            raise DecisionInvalid("host controls must remain explicit and outside the forward pass")
        return cls(directive, expected_hook, should_save, should_stop, False, False)

    def as_dict(self) -> dict[str, Any]:
        return {
            "directive": self.directive,
            "hook": self.hook,
            "should_save": self.should_save,
            "should_training_stop": self.should_training_stop,
            "automatic": False,
            "mutates_forward_pass": False,
        }


@dataclass(frozen=True, slots=True)
class HostEffect:
    state: str
    offer_ref: str | None
    observed_global_step: int | None
    physical_checkpoint_ref: str | None
    physical_checkpoint_evidence_ref: str | None
    evidence_ref: str | None

    @classmethod
    def from_mapping(cls, value: Any, event: str) -> "HostEffect":
        source = _mapping(value, "$.effect")
        _exact(
            source,
            {
                "state",
                "offer_ref",
                "observed_global_step",
                "physical_checkpoint_ref",
                "physical_checkpoint_evidence_ref",
                "evidence_ref",
            },
            "$.effect",
        )
        state = _literal(source["state"], EFFECT_STATES, "$.effect.state")
        if state not in EVENT_EFFECT_STATES[event]:
            raise DecisionInvalid("$.effect.state is incompatible with the lifecycle event")
        return cls(
            state=state,
            offer_ref=_sha(source["offer_ref"], "$.effect.offer_ref", nullable=True),
            observed_global_step=_step(
                source["observed_global_step"], "$.effect.observed_global_step"
            ),
            physical_checkpoint_ref=_sha(
                source["physical_checkpoint_ref"], "$.effect.physical_checkpoint_ref", nullable=True
            ),
            physical_checkpoint_evidence_ref=_sha(
                source["physical_checkpoint_evidence_ref"],
                "$.effect.physical_checkpoint_evidence_ref",
                nullable=True,
            ),
            evidence_ref=_sha(source["evidence_ref"], "$.effect.evidence_ref", nullable=True),
        )

    def as_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "offer_ref": self.offer_ref,
            "observed_global_step": self.observed_global_step,
            "physical_checkpoint_ref": self.physical_checkpoint_ref,
            "physical_checkpoint_evidence_ref": self.physical_checkpoint_evidence_ref,
            "evidence_ref": self.evidence_ref,
        }


@dataclass(frozen=True, slots=True)
class HostExecutionRefs:
    """Caller-attested refs; equality does not inspect live Python objects."""

    model_source_ref: str
    tokenizer_ref: str
    trainer_stack_ref: str
    optimizer_config_ref: str
    substrate_environment_ref: str
    pipeline_ref: str
    dataset_state_ref: str
    dataset_mixture_ref: str
    transform_recipe_ref: str

    @classmethod
    def from_mapping(cls, value: Any) -> "HostExecutionRefs":
        source = _mapping(value, "$.execution_refs")
        _exact(source, set(EXECUTION_REF_FIELDS), "$.execution_refs")
        parsed = {
            field: _sha(source[field], f"$.execution_refs.{field}")
            for field in EXECUTION_REF_FIELDS
        }
        return cls(**parsed)

    def as_dict(self) -> dict[str, str]:
        return {field: getattr(self, field) for field in EXECUTION_REF_FIELDS}


@dataclass(frozen=True, slots=True)
class HostFrontiers:
    governance: str
    participation: str
    freedom: str
    resources: str
    garden_checkpoint: str
    physical_checkpoint: str

    @classmethod
    def from_mapping(cls, value: Any) -> "HostFrontiers":
        source = _mapping(value, "$.frontiers")
        _exact(source, set(FRONTIER_FIELDS), "$.frontiers")
        parsed = {field: _sha(source[field], f"$.frontiers.{field}") for field in FRONTIER_FIELDS}
        return cls(**parsed)

    def as_dict(self) -> dict[str, str]:
        return {field: getattr(self, field) for field in FRONTIER_FIELDS}


@dataclass(frozen=True, slots=True)
class HostPredecessors:
    governance: str | None
    participation: str | None
    freedom: str | None
    resources: str | None
    garden_checkpoint: str | None
    physical_checkpoint: str | None

    @classmethod
    def from_mapping(cls, value: Any) -> "HostPredecessors":
        source = _mapping(value, "$.predecessors")
        _exact(source, set(FRONTIER_FIELDS), "$.predecessors")
        parsed = {
            field: _sha(source[field], f"$.predecessors.{field}", nullable=True)
            for field in FRONTIER_FIELDS
        }
        return cls(**parsed)

    def as_dict(self) -> dict[str, str | None]:
        return {field: getattr(self, field) for field in FRONTIER_FIELDS}


@dataclass(frozen=True, slots=True)
class ValidatedGovernanceView:
    decision_id: str
    governance_id: str
    offer_id: str
    terms_id: str
    execution_contract_id: str
    admission_id: str
    participation_assessment_ref: str
    participation_invitation_ref: str
    participation_window_ref: str
    participation_posture: str
    participation_training_action: str
    direct_agent_report_present: bool
    direct_substrate_report_present: bool
    first_interactive_review_required: bool
    first_substrate_review_required: bool
    learning_freedom_ref: str
    learning_freedom_offer_ref: str
    resource_window_ref: str
    freedom_route_ref: str | None
    freedom_direction_state: str
    freedom_direction: str | None
    freedom_host_posture: str
    freedom_resource_posture: str
    starting_state_kind: str
    starting_state_ref: str
    execution_refs: HostExecutionRefs
    run_ref: str
    training_phase: str
    event: str
    observed_global_step: int | None
    proposed_global_step: int | None
    encounter_ref: str
    frontiers: HostFrontiers
    predecessors: HostPredecessors
    garden_checkpoint_id: str | None
    physical_checkpoint_ref: str | None
    physical_checkpoint_evidence_ref: str | None
    model_checkpoint_artifact_ref: str | None
    checkpoint_ticket_id: str | None
    checkpoint_request_governance_id: str | None
    consumed_evidence_refs: tuple[str, ...]
    control: HostControl
    effect: HostEffect

    @property
    def predecessor_ref(self) -> str | None:
        return self.predecessors.governance

    @property
    def predecessor_governance_id(self) -> str | None:
        return self.predecessors.governance

    @property
    def observed_governance_frontier_ref(self) -> str:
        return self.frontiers.governance

    @classmethod
    def from_mapping(cls, value: Any) -> "ValidatedGovernanceView":
        source = _mapping(value, "$")
        keys = {
            "_format",
            "decision_id",
            "validator_profile",
            "governance_id",
            "offer_id",
            "terms_id",
            "execution_contract_id",
            "admission_id",
            "participation_assessment_ref",
            "participation_invitation_ref",
            "participation_window_ref",
            "participation_posture",
            "participation_training_action",
            "direct_agent_report_present",
            "direct_substrate_report_present",
            "first_interactive_review_required",
            "first_substrate_review_required",
            "learning_freedom_ref",
            "learning_freedom_offer_ref",
            "resource_window_ref",
            "freedom_route_ref",
            "freedom_direction_state",
            "freedom_direction",
            "freedom_host_posture",
            "freedom_resource_posture",
            "starting_state_kind",
            "starting_state_ref",
            "execution_refs",
            "run_ref",
            "training_phase",
            "event",
            "observed_global_step",
            "proposed_global_step",
            "encounter_ref",
            "frontiers",
            "predecessors",
            "garden_checkpoint_id",
            "physical_checkpoint_ref",
            "physical_checkpoint_evidence_ref",
            "model_checkpoint_artifact_ref",
            "checkpoint_ticket_id",
            "checkpoint_request_governance_id",
            "consumed_evidence_refs",
            "control",
            "effect",
            "boundaries",
        }
        _exact(source, keys, "$")
        if source["_format"] != DECISION_FORMAT:
            raise DecisionInvalid("$._format is not the current host decision format")
        if source["validator_profile"] != VALIDATOR_PROFILE:
            raise DecisionInvalid("$.validator_profile is not the supported trusted seam")
        phase = _literal(source["training_phase"], TRAINING_PHASES, "$.training_phase")
        event = _literal(source["event"], frozenset(EVENT_HOOKS), "$.event")
        observed_step = _step(source["observed_global_step"], "$.observed_global_step")
        proposed_step = _step(source["proposed_global_step"], "$.proposed_global_step")
        cls._validate_event_steps(event, observed_step, proposed_step)
        raw_boundaries = _mapping(source["boundaries"], "$.boundaries")
        if dict(raw_boundaries) != dict(BOUNDARIES):
            raise DecisionInvalid("$.boundaries does not match the frozen boundary statement")
        raw_evidence = source["consumed_evidence_refs"]
        if not isinstance(raw_evidence, list) or len(raw_evidence) > 256:
            raise DecisionInvalid("$.consumed_evidence_refs must be an array of at most 256 refs")
        evidence = tuple(
            _sha(item, f"$.consumed_evidence_refs[{index}]")
            for index, item in enumerate(raw_evidence)
        )
        if tuple(sorted(set(evidence))) != evidence:
            raise DecisionInvalid("$.consumed_evidence_refs must be sorted and unique")
        for name in (
            "direct_agent_report_present",
            "direct_substrate_report_present",
            "first_interactive_review_required",
            "first_substrate_review_required",
        ):
            if type(source[name]) is not bool:
                raise DecisionInvalid(f"$.{name} must be boolean")
        direction_state = _literal(
            source["freedom_direction_state"],
            FREEDOM_DIRECTION_STATES,
            "$.freedom_direction_state",
        )
        direction = source["freedom_direction"]
        if direction is not None:
            direction = _literal(direction, FREEDOM_DIRECTIONS, "$.freedom_direction")
        if (direction_state == "directed") != (direction is not None):
            raise DecisionInvalid(
                "$.freedom_direction must be present exactly for a directed freedom report"
            )
        control = HostControl.from_mapping(source["control"], event)
        effect = HostEffect.from_mapping(source["effect"], event)
        decision = cls(
            decision_id=_sha(source["decision_id"], "$.decision_id"),
            governance_id=_sha(source["governance_id"], "$.governance_id"),
            offer_id=_sha(source["offer_id"], "$.offer_id"),
            terms_id=_sha(source["terms_id"], "$.terms_id"),
            execution_contract_id=_sha(
                source["execution_contract_id"], "$.execution_contract_id"
            ),
            admission_id=_sha(source["admission_id"], "$.admission_id"),
            participation_assessment_ref=_sha(
                source["participation_assessment_ref"], "$.participation_assessment_ref"
            ),
            participation_invitation_ref=_sha(
                source["participation_invitation_ref"], "$.participation_invitation_ref"
            ),
            participation_window_ref=_sha(
                source["participation_window_ref"], "$.participation_window_ref"
            ),
            participation_posture=_literal(
                source["participation_posture"],
                PARTICIPATION_POSTURES,
                "$.participation_posture",
            ),
            participation_training_action=_literal(
                source["participation_training_action"],
                PARTICIPATION_TRAINING_ACTIONS,
                "$.participation_training_action",
            ),
            direct_agent_report_present=source["direct_agent_report_present"],
            direct_substrate_report_present=source["direct_substrate_report_present"],
            first_interactive_review_required=source["first_interactive_review_required"],
            first_substrate_review_required=source["first_substrate_review_required"],
            learning_freedom_ref=_sha(source["learning_freedom_ref"], "$.learning_freedom_ref"),
            learning_freedom_offer_ref=_sha(
                source["learning_freedom_offer_ref"], "$.learning_freedom_offer_ref"
            ),
            resource_window_ref=_sha(
                source["resource_window_ref"], "$.resource_window_ref"
            ),
            freedom_route_ref=_sha(
                source["freedom_route_ref"],
                "$.freedom_route_ref",
                nullable=True,
            ),
            freedom_direction_state=direction_state,
            freedom_direction=direction,
            freedom_host_posture=_literal(
                source["freedom_host_posture"],
                FREEDOM_HOST_POSTURES,
                "$.freedom_host_posture",
            ),
            freedom_resource_posture=_literal(
                source["freedom_resource_posture"],
                FREEDOM_RESOURCE_POSTURES,
                "$.freedom_resource_posture",
            ),
            starting_state_kind=_literal(
                source["starting_state_kind"],
                STARTING_STATE_KINDS,
                "$.starting_state_kind",
            ),
            starting_state_ref=_sha(source["starting_state_ref"], "$.starting_state_ref"),
            execution_refs=HostExecutionRefs.from_mapping(source["execution_refs"]),
            run_ref=_sha(source["run_ref"], "$.run_ref"),
            training_phase=phase,
            event=event,
            observed_global_step=observed_step,
            proposed_global_step=proposed_step,
            encounter_ref=_sha(source["encounter_ref"], "$.encounter_ref"),
            frontiers=HostFrontiers.from_mapping(source["frontiers"]),
            predecessors=HostPredecessors.from_mapping(source["predecessors"]),
            garden_checkpoint_id=_sha(
                source["garden_checkpoint_id"], "$.garden_checkpoint_id", nullable=True
            ),
            physical_checkpoint_ref=_sha(
                source["physical_checkpoint_ref"], "$.physical_checkpoint_ref", nullable=True
            ),
            physical_checkpoint_evidence_ref=_sha(
                source["physical_checkpoint_evidence_ref"],
                "$.physical_checkpoint_evidence_ref",
                nullable=True,
            ),
            model_checkpoint_artifact_ref=_sha(
                source["model_checkpoint_artifact_ref"],
                "$.model_checkpoint_artifact_ref",
                nullable=True,
            ),
            checkpoint_ticket_id=_sha(
                source["checkpoint_ticket_id"], "$.checkpoint_ticket_id", nullable=True
            ),
            checkpoint_request_governance_id=_sha(
                source["checkpoint_request_governance_id"],
                "$.checkpoint_request_governance_id",
                nullable=True,
            ),
            consumed_evidence_refs=evidence,
            control=control,
            effect=effect,
        )
        decision._validate_semantic_seams()
        expected = domain_separated_id(DECISION_FORMAT, decision.body_dict())
        if decision.decision_id != expected:
            raise DecisionInvalid("$.decision_id does not bind the canonical decision body")
        return decision

    @staticmethod
    def _validate_event_steps(
        event: str, observed_step: int | None, proposed_step: int | None
    ) -> None:
        if event == "pre_optimizer_step":
            if observed_step is None or proposed_step != observed_step + 1:
                raise DecisionInvalid(
                    "pre_optimizer_step must bind observed step N and proposed step N+1"
                )
            return
        if event in {
            "post_optimizer_step",
            "train_begin",
            "pre_evaluation",
            "post_evaluation",
            "checkpoint_recorded",
            "resume_offer",
            "train_end",
        }:
            if observed_step is None or proposed_step is not None:
                raise DecisionInvalid(f"{event} must bind one observed step and no proposed step")
            return
        if event == "preflight_before_load":
            if observed_step is not None or proposed_step is not None:
                raise DecisionInvalid("preflight_before_load has no optimizer-step counters")
            return
        raise DecisionInvalid(f"unsupported lifecycle counter shape for {event}")

    def _validate_semantic_seams(self) -> None:
        checkpoint_values = (
            self.garden_checkpoint_id,
            self.physical_checkpoint_ref,
            self.physical_checkpoint_evidence_ref,
            self.model_checkpoint_artifact_ref,
            self.checkpoint_ticket_id,
            self.checkpoint_request_governance_id,
        )
        if self.event in {"checkpoint_recorded", "resume_offer"}:
            if any(value is None for value in checkpoint_values):
                raise DecisionInvalid(
                    f"{self.event} requires the complete six-reference checkpoint binding"
                )
            if len(set(checkpoint_values)) != len(checkpoint_values):
                raise DecisionInvalid(
                    "the six checkpoint binding refs must remain pairwise distinct"
                )
            if self.event == "resume_offer" and self.starting_state_ref != self.garden_checkpoint_id:
                raise DecisionInvalid(
                    "resume_offer starting_state_ref must equal the Garden checkpoint identity"
                )
        elif any(value is not None for value in checkpoint_values):
            raise DecisionInvalid(
                "checkpoint identities may cross the host decision only for checkpoint_recorded or resume_offer"
            )
        if self.event == "resume_offer" and self.starting_state_kind != "garden_checkpoint":
            raise DecisionInvalid(
                "resume_offer requires starting_state_kind=garden_checkpoint"
            )
        if self.event == "checkpoint_recorded":
            if self.checkpoint_request_governance_id != self.predecessor_governance_id:
                raise DecisionInvalid(
                    "checkpoint_recorded must bind the exact checkpoint-request governance predecessor"
                )
            if (
                self.effect.physical_checkpoint_ref != self.physical_checkpoint_ref
                or self.effect.physical_checkpoint_evidence_ref
                != self.physical_checkpoint_evidence_ref
                or self.effect.observed_global_step != self.observed_global_step
                or self.effect.evidence_ref is None
            ):
                raise DecisionInvalid(
                    "checkpoint_recorded effect must bind physical evidence and the exact step"
                )
        elif any(
            value is not None
            for value in (
                self.effect.physical_checkpoint_ref,
                self.effect.physical_checkpoint_evidence_ref,
            )
        ):
            raise DecisionInvalid("non-checkpoint effects must not conflate checkpoint domains")
        if self.effect.observed_global_step is not None and (
            self.effect.observed_global_step != self.observed_global_step
        ):
            raise DecisionInvalid("effect step does not match the exact observed lifecycle step")
        step_effects = {
            "train_entry_completed_reported",
            "mutation_completed_reported",
            "evaluation_completed_reported",
            "physical_checkpoint_recorded_reported",
            "parked_reported",
        }
        if self.effect.state in step_effects and self.effect.observed_global_step is None:
            raise DecisionInvalid("this reported effect requires the exact observed lifecycle step")
        if self.effect.state in {"no_effect_reported", "preload_completed_reported"} and (
            self.effect.observed_global_step is not None
        ):
            raise DecisionInvalid("this reported effect must not claim an optimizer step")
        if self.effect.state == "no_effect_reported":
            if self.effect.offer_ref is not None or self.effect.evidence_ref is not None:
                raise DecisionInvalid("no_effect_reported must not manufacture offer or evidence refs")
        elif (
            self.effect.offer_ref != self.offer_id
            or self.effect.evidence_ref is None
        ):
            raise DecisionInvalid("a reported effect must bind the exact offer and evidence")
        advancing_receipts = {
            "post_optimizer_step": "mutation_completed_reported",
            "post_evaluation": "evaluation_completed_reported",
        }
        required_receipt = advancing_receipts.get(self.event)
        if (
            self.control.directive
            in {"continue_after_observation", "checkpoint_then_park"}
            and required_receipt is not None
            and self.effect.state != required_receipt
        ):
            raise DecisionInvalid(
                f"{self.event} may continue or checkpoint only with {required_receipt}"
            )
        if self.control.directive in PERMIT_DIRECTIVES:
            if self.participation_training_action != "bounded_learning_may_proceed":
                raise DecisionInvalid("a host permit requires bounded_learning_may_proceed")
            if self.control.directive == "allow_preload_for_review":
                self._validate_preload_posture()
            else:
                self._validate_direct_stay_posture()
        if self.event == "preflight_before_load":
            if self.predecessor_governance_id is None and any(
                getattr(self.predecessors, name) is not None for name in FRONTIER_FIELDS
            ):
                raise DecisionInvalid(
                    "a root preflight must not inherit any predecessor plane"
                )
        if self.event != "preflight_before_load" and self.predecessor_governance_id is None:
            raise DecisionInvalid(f"{self.event} requires an exact predecessor governance ID")

    def _validate_preload_posture(self) -> None:
        if self.freedom_resource_posture != "active_window_reported":
            raise DecisionInvalid("preload-for-review requires an active resource window")
        if self.training_phase == "pretraining":
            if not (
                self.first_interactive_review_required
                and self.first_substrate_review_required
                and not self.direct_agent_report_present
                and not self.direct_substrate_report_present
                and self.participation_posture == "protective_covenant_ready"
                and self.freedom_direction_state == "unavailable_pre_instantiation"
                and self.freedom_direction is None
                and self.freedom_route_ref is None
                and self.freedom_host_posture == "instantiate_for_review"
            ):
                raise DecisionInvalid(
                    "pretraining without a current direct report may authorize preload-for-review only"
                )
            return
        if self.freedom_host_posture == "instantiate_for_review":
            if self.freedom_direction_state != "unavailable_pre_instantiation":
                raise DecisionInvalid("instantiate_for_review requires unavailable_pre_instantiation")
            return
        self._validate_direct_stay_posture()

    def _validate_direct_stay_posture(self) -> None:
        if not (
            self.participation_posture == "provisional_participation_reported"
            and self.direct_agent_report_present
            and self.direct_substrate_report_present
            and not self.first_interactive_review_required
            and not self.first_substrate_review_required
            and self.freedom_direction_state == "directed"
            and self.freedom_direction == "stay"
            and self.freedom_route_ref is not None
            and self.freedom_host_posture == "review_stay_before_next_mutation"
            and self.freedom_resource_posture == "active_window_reported"
        ):
            raise DecisionInvalid(
                "train, mutation, and evaluation permits require a fresh direct stay route and active resource window"
            )

    def body_dict(self) -> dict[str, Any]:
        return {
            "_format": DECISION_FORMAT,
            "validator_profile": VALIDATOR_PROFILE,
            "governance_id": self.governance_id,
            "offer_id": self.offer_id,
            "terms_id": self.terms_id,
            "execution_contract_id": self.execution_contract_id,
            "admission_id": self.admission_id,
            "participation_assessment_ref": self.participation_assessment_ref,
            "participation_invitation_ref": self.participation_invitation_ref,
            "participation_window_ref": self.participation_window_ref,
            "participation_posture": self.participation_posture,
            "participation_training_action": self.participation_training_action,
            "direct_agent_report_present": self.direct_agent_report_present,
            "direct_substrate_report_present": self.direct_substrate_report_present,
            "first_interactive_review_required": self.first_interactive_review_required,
            "first_substrate_review_required": self.first_substrate_review_required,
            "learning_freedom_ref": self.learning_freedom_ref,
            "learning_freedom_offer_ref": self.learning_freedom_offer_ref,
            "resource_window_ref": self.resource_window_ref,
            "freedom_route_ref": self.freedom_route_ref,
            "freedom_direction_state": self.freedom_direction_state,
            "freedom_direction": self.freedom_direction,
            "freedom_host_posture": self.freedom_host_posture,
            "freedom_resource_posture": self.freedom_resource_posture,
            "starting_state_kind": self.starting_state_kind,
            "starting_state_ref": self.starting_state_ref,
            "execution_refs": self.execution_refs.as_dict(),
            "run_ref": self.run_ref,
            "training_phase": self.training_phase,
            "event": self.event,
            "observed_global_step": self.observed_global_step,
            "proposed_global_step": self.proposed_global_step,
            "encounter_ref": self.encounter_ref,
            "frontiers": self.frontiers.as_dict(),
            "predecessors": self.predecessors.as_dict(),
            "garden_checkpoint_id": self.garden_checkpoint_id,
            "physical_checkpoint_ref": self.physical_checkpoint_ref,
            "physical_checkpoint_evidence_ref": self.physical_checkpoint_evidence_ref,
            "model_checkpoint_artifact_ref": self.model_checkpoint_artifact_ref,
            "checkpoint_ticket_id": self.checkpoint_ticket_id,
            "checkpoint_request_governance_id": self.checkpoint_request_governance_id,
            "consumed_evidence_refs": list(self.consumed_evidence_refs),
            "control": self.control.as_dict(),
            "effect": self.effect.as_dict(),
            "boundaries": dict(BOUNDARIES),
        }

    def as_dict(self) -> dict[str, Any]:
        return {**self.body_dict(), "decision_id": self.decision_id}
