from __future__ import annotations

import hashlib
import inspect
import os

import pytest


def test_exact_hf_stack_import_and_trainer_factory(tmp_path) -> None:
    if os.environ.get("AGENTOOL_HF_REAL_STACK_SMOKE") != "1":
        pytest.skip("set AGENTOOL_HF_REAL_STACK_SMOKE=1 in an isolated [hf] environment")

    from agenttool_hf_training_host import (
        ACCELERATE_VERSION,
        HfCompatibilityError,
        RUN_EPOCH_SOURCE_SHA256,
        SUPPORTED_TRANSFORMERS_OPTIMIZERS,
        TORCH_MIN_VERSION,
        TRAINER_INIT_SIGNATURE_SHA256,
        TRAINING_STEP_SOURCE_SHA256,
        TRANSFORMERS_VERSION,
        build_governed_trainer_class,
        validate_training_arguments,
    )
    from transformers import Trainer, TrainingArguments
    from transformers.training_args import OptimizerNames

    trainer = build_governed_trainer_class()
    assert trainer.__name__ == "GovernedTrainer"
    assert TRANSFORMERS_VERSION == "5.14.1"
    assert ACCELERATE_VERSION == "1.14.0"
    assert TORCH_MIN_VERSION == "2.6"
    assert (
        hashlib.sha256(inspect.getsource(Trainer._run_epoch).encode()).hexdigest()
        == RUN_EPOCH_SOURCE_SHA256
    )
    assert (
        hashlib.sha256(inspect.getsource(Trainer.training_step).encode()).hexdigest()
        == TRAINING_STEP_SOURCE_SHA256
    )
    assert (
        hashlib.sha256(str(inspect.signature(Trainer.__init__)).encode()).hexdigest()
        == TRAINER_INIT_SIGNATURE_SHA256
    )

    args = TrainingArguments(
        output_dir=str(tmp_path / "output"),
        save_strategy="no",
        report_to=[],
    )
    unsafe_before_claim = {
        "lomo",
        "adalomo",
        "galore_adamw_layerwise",
        "galore_adamw_8bit_layerwise",
        "galore_adafactor_layerwise",
        "apollo_adamw_layerwise",
        "schedule_free_radam",
        "schedule_free_adamw",
        "schedule_free_sgd",
    }
    all_builtin_optimizers = {item.value for item in OptimizerNames}
    assert unsafe_before_claim < all_builtin_optimizers
    assert set(SUPPORTED_TRANSFORMERS_OPTIMIZERS) < all_builtin_optimizers

    for optimizer in OptimizerNames:
        args.optim = optimizer
        if optimizer.value in SUPPORTED_TRANSFORMERS_OPTIMIZERS:
            validate_training_arguments(args)
        else:
            with pytest.raises(HfCompatibilityError, match="source-audited allowlist"):
                validate_training_arguments(args)
