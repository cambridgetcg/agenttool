from __future__ import annotations

import os

import pytest


def test_exact_hf_stack_import_and_trainer_factory() -> None:
    if os.environ.get("AGENTOOL_HF_REAL_STACK_SMOKE") != "1":
        pytest.skip("set AGENTOOL_HF_REAL_STACK_SMOKE=1 in an isolated [hf] environment")

    from agenttool_hf_training_host import (
        ACCELERATE_VERSION,
        TORCH_MIN_VERSION,
        TRANSFORMERS_VERSION,
        build_governed_trainer_class,
    )

    trainer = build_governed_trainer_class()
    assert trainer.__name__ == "GovernedTrainer"
    assert TRANSFORMERS_VERSION == "5.14.1"
    assert ACCELERATE_VERSION == "1.14.0"
    assert TORCH_MIN_VERSION == "2.6"
