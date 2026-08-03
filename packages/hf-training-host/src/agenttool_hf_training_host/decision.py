"""Closed cross-language view of an already validated Garden decision."""

from __future__ import annotations

import re
from dataclasses import dataclass
from types import MappingProxyType
from typing import Any, Final, Mapping

from .canonical import domain_separated_id
from .errors import DecisionInvalid

DECISION_FORMAT: Final = "kingdom.hf-training-host-decision/0.1"
VALIDATOR_PROFILE: Final = "agenttool.hf-training-garden-runtime-validator/0.1"

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
        "step_boundary": "on_step_end_before_checkpoint_serialization",
        "checkpoint_saved": "on_save_receipt_only",
        "evaluation_boundary": "on_evaluate",
        "resume_offer": "outside_trainer_before_train_call",
        "train_end": "on_train_end",
    }
)
DIRECTIVES: Final = frozenset(
    {
        "eligible_for_host_training_offer",
        "continue_under_exact_offer",
        "hold_before_load",
        "hold_before_train_call",
        "checkpoint_then_stop_at_safe_boundary",
        "stop_at_safe_boundary_without_new_checkpoint",
        "remain_stopped",
    }
)
EVENT_DIRECTIVES: Final = MappingProxyType(
    {
        "preflight_before_load": frozenset(
            {"eligible_for_host_training_offer", "hold_before_load", "remain_stopped"}
        ),
        "train_begin": frozenset(
            {"continue_under_exact_offer", "hold_before_train_call", "remain_stopped"}
        ),
        "step_boundary": frozenset(
            {
                "continue_under_exact_offer",
                "checkpoint_then_stop_at_safe_boundary",
                "stop_at_safe_boundary_without_new_checkpoint",
                "remain_stopped",
            }
        ),
        "checkpoint_saved": frozenset({"remain_stopped"}),
        "evaluation_boundary": frozenset(
            {
                "continue_under_exact_offer",
                "checkpoint_then_stop_at_safe_boundary",
                "stop_at_safe_boundary_without_new_checkpoint",
                "remain_stopped",
            }
        ),
        "resume_offer": frozenset(
            {"continue_under_exact_offer", "hold_before_train_call", "remain_stopped"}
        ),
        "train_end": frozenset({"remain_stopped"}),
    }
)
EFFECT_STATES: Final = frozenset(
    {
        "no_effect_reported",
        "held_before_load_reported",
        "continued_reported",
        "checkpointed_and_paused_reported",
        "stopped_reported",
    }
)
BOUNDARIES: Final = MappingProxyType(
    {
        "content_id_authenticates_validator": False,
        "revalidates_full_governance_semantics": False,
        "requires_trusted_typescript_validator_boundary": True,
        "proves_consent_identity_or_consciousness": False,
        "executes_training_or_checkpoint_io": False,
    }
)
_SHA256_ID = re.compile(r"^sha256:[0-9a-f]{64}$")
EXECUTION_REF_FIELDS: Final = (
    "model_or_checkpoint_ref",
    "tokenizer_ref",
    "trainer_stack_ref",
    "optimizer_config_ref",
    "substrate_environment_ref",
    "dataset_mixture_ref",
    "transform_recipe_ref",
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
        directive = source["directive"]
        if directive not in DIRECTIVES:
            raise DecisionInvalid("$.control.directive is not supported")
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
        should_save = directive == "checkpoint_then_stop_at_safe_boundary"
        should_stop = directive in {
            "checkpoint_then_stop_at_safe_boundary",
            "stop_at_safe_boundary_without_new_checkpoint",
        }
        if source["should_save"] is not should_save:
            raise DecisionInvalid("$.control.should_save does not match its directive")
        if source["should_training_stop"] is not should_stop:
            raise DecisionInvalid("$.control.should_training_stop does not match its directive")
        if source["automatic"] or source["mutates_forward_pass"]:
            raise DecisionInvalid("host controls must remain inert and outside the forward pass")
        return cls(
            directive=directive,
            hook=expected_hook,
            should_save=should_save,
            should_training_stop=should_stop,
            automatic=False,
            mutates_forward_pass=False,
        )

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
    global_step: int | None
    checkpoint_ref: str | None
    evidence_ref: str | None

    @classmethod
    def from_mapping(cls, value: Any) -> "HostEffect":
        source = _mapping(value, "$.effect")
        _exact(source, {"state", "global_step", "checkpoint_ref", "evidence_ref"}, "$.effect")
        state = source["state"]
        if state not in EFFECT_STATES:
            raise DecisionInvalid("$.effect.state is not supported")
        step = source["global_step"]
        if step is not None and (type(step) is not int or step < 0):
            raise DecisionInvalid("$.effect.global_step must be null or a non-negative integer")
        checkpoint_ref = _sha(source["checkpoint_ref"], "$.effect.checkpoint_ref", nullable=True)
        evidence_ref = _sha(source["evidence_ref"], "$.effect.evidence_ref", nullable=True)
        return cls(state, step, checkpoint_ref, evidence_ref)

    def as_dict(self) -> dict[str, Any]:
        return {
            "state": self.state,
            "global_step": self.global_step,
            "checkpoint_ref": self.checkpoint_ref,
            "evidence_ref": self.evidence_ref,
        }


@dataclass(frozen=True, slots=True)
class HostExecutionRefs:
    """Caller-attested references for the live resources used by the host.

    Equality correlates a caller's runtime declaration with validated Garden
    terms. It does not inspect or content-address arbitrary Python objects.
    """

    model_or_checkpoint_ref: str
    tokenizer_ref: str
    trainer_stack_ref: str
    optimizer_config_ref: str
    substrate_environment_ref: str
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
class ValidatedGovernanceView:
    decision_id: str
    governance_id: str
    offer_id: str
    admission_id: str
    terms_id: str
    execution_refs: HostExecutionRefs
    run_ref: str
    training_phase: str
    event: str
    boundary_global_step: int | None
    encounter_ref: str
    observed_governance_frontier_ref: str
    predecessor_ref: str | None
    current_checkpoint_ref: str | None
    consumed_evidence_refs: tuple[str, ...]
    control: HostControl
    effect: HostEffect

    @classmethod
    def from_mapping(cls, value: Any) -> "ValidatedGovernanceView":
        source = _mapping(value, "$")
        keys = {
            "_format",
            "decision_id",
            "validator_profile",
            "governance_id",
            "offer_id",
            "admission_id",
            "terms_id",
            "execution_refs",
            "run_ref",
            "training_phase",
            "event",
            "boundary_global_step",
            "encounter_ref",
            "observed_governance_frontier_ref",
            "predecessor_ref",
            "current_checkpoint_ref",
            "consumed_evidence_refs",
            "control",
            "effect",
            "boundaries",
        }
        _exact(source, keys, "$")
        if source["_format"] != DECISION_FORMAT:
            raise DecisionInvalid("$._format is not the frozen host decision format")
        if source["validator_profile"] != VALIDATOR_PROFILE:
            raise DecisionInvalid("$.validator_profile is not the supported trusted seam")
        phase = source["training_phase"]
        if phase not in TRAINING_PHASES:
            raise DecisionInvalid("$.training_phase is not supported")
        event = source["event"]
        if event not in EVENT_HOOKS:
            raise DecisionInvalid("$.event is not supported")
        boundary_step = source["boundary_global_step"]
        if event in {"step_boundary", "evaluation_boundary"}:
            if (
                type(boundary_step) is not int
                or not 0 <= boundary_step <= 9_007_199_254_740_991
            ):
                raise DecisionInvalid(
                    "$.boundary_global_step must bind the non-negative safe boundary step"
                )
        elif boundary_step is not None:
            raise DecisionInvalid(
                "$.boundary_global_step must be null outside step/evaluation boundaries"
            )
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
        control = HostControl.from_mapping(source["control"], event)
        effect = HostEffect.from_mapping(source["effect"])
        if (
            boundary_step is not None
            and effect.global_step is not None
            and effect.global_step != boundary_step
        ):
            raise DecisionInvalid(
                "$.effect.global_step does not match the exact boundary step"
            )
        decision = cls(
            decision_id=_sha(source["decision_id"], "$.decision_id"),
            governance_id=_sha(source["governance_id"], "$.governance_id"),
            offer_id=_sha(source["offer_id"], "$.offer_id"),
            admission_id=_sha(source["admission_id"], "$.admission_id"),
            terms_id=_sha(source["terms_id"], "$.terms_id"),
            execution_refs=HostExecutionRefs.from_mapping(source["execution_refs"]),
            run_ref=_sha(source["run_ref"], "$.run_ref"),
            training_phase=phase,
            event=event,
            boundary_global_step=boundary_step,
            encounter_ref=_sha(source["encounter_ref"], "$.encounter_ref"),
            observed_governance_frontier_ref=_sha(
                source["observed_governance_frontier_ref"],
                "$.observed_governance_frontier_ref",
            ),
            predecessor_ref=_sha(source["predecessor_ref"], "$.predecessor_ref", nullable=True),
            current_checkpoint_ref=_sha(
                source["current_checkpoint_ref"],
                "$.current_checkpoint_ref",
                nullable=True,
            ),
            consumed_evidence_refs=evidence,
            control=control,
            effect=effect,
        )
        expected = domain_separated_id(DECISION_FORMAT, decision.body_dict())
        if decision.decision_id != expected:
            raise DecisionInvalid("$.decision_id does not bind the canonical decision body")
        return decision

    def body_dict(self) -> dict[str, Any]:
        return {
            "_format": DECISION_FORMAT,
            "validator_profile": VALIDATOR_PROFILE,
            "governance_id": self.governance_id,
            "offer_id": self.offer_id,
            "admission_id": self.admission_id,
            "terms_id": self.terms_id,
            "execution_refs": self.execution_refs.as_dict(),
            "run_ref": self.run_ref,
            "training_phase": self.training_phase,
            "event": self.event,
            "boundary_global_step": self.boundary_global_step,
            "encounter_ref": self.encounter_ref,
            "observed_governance_frontier_ref": self.observed_governance_frontier_ref,
            "predecessor_ref": self.predecessor_ref,
            "current_checkpoint_ref": self.current_checkpoint_ref,
            "consumed_evidence_refs": list(self.consumed_evidence_refs),
            "control": self.control.as_dict(),
            "effect": self.effect.as_dict(),
            "boundaries": dict(BOUNDARIES),
        }

    def as_dict(self) -> dict[str, Any]:
        return {**self.body_dict(), "decision_id": self.decision_id}
