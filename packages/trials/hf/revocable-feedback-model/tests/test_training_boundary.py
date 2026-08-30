from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path
from types import ModuleType, SimpleNamespace
from typing import Any, cast
from unittest.mock import patch

from test_bundle import minimal_safetensors_bytes, write_minimal_tokenizer
from xenia_revocable_feedback_model.core import (
    AUTHORIZATION_ID,
    DATASET_HASH_MANIFEST_ID,
    DATASET_REVISION,
    EXPECTED_DATASET_ADMISSION_ID,
    EXPECTED_RUNTIME_VERSIONS,
    GOVERNANCE_STATUS,
    RECIPE_ID,
    RUN_RECEIPT_SCHEMA,
    TRAINING_MANIFEST_ID,
    DatasetBundle,
    TrainingBundleError,
    inspect_model_export,
    read_json,
    write_canonical_json,
)
from xenia_revocable_feedback_model.train import train_bounded_model


class _UntouchedBundle:
    @property
    def train_rows(self) -> object:
        raise AssertionError("a rejected admission must not inspect dataset rows")


class _FakeTokenizer:
    pad_token_id = 0
    eos_token_id = 2

    def save_pretrained(self, path: Path, **_: object) -> None:
        write_minimal_tokenizer(path)


class _FakeModel:
    def save_pretrained(self, path: Path, **_: object) -> None:
        path.mkdir(parents=True, exist_ok=True)
        write_canonical_json(
            path / "config.json",
            {
                "model_type": "llama",
                "vocab_size": 6,
                "bos_token_id": 1,
                "eos_token_id": 2,
                "pad_token_id": 2,
            },
        )
        (path / "model.safetensors").write_bytes(minimal_safetensors_bytes())


class _FakeTrainer:
    def __init__(self, **_: object) -> None:
        self.state = SimpleNamespace(global_step=8)

    def train(self, **_: object) -> object:
        return SimpleNamespace(metrics={"train_loss": 1.25})


class TrainingBoundaryTests(unittest.TestCase):
    def test_wrong_admission_fails_before_runtime_output_env_import_or_bundle_use(self) -> None:
        wrong_but_well_formed = "sha256:" + "9" * 64
        for output_exists in (False, True):
            with self.subTest(output_exists=output_exists), tempfile.TemporaryDirectory() as temporary:
                output = Path(temporary) / "run"
                sentinel = output / "sentinel"
                if output_exists:
                    output.mkdir()
                    sentinel.write_text("unchanged", encoding="utf-8")
                with (
                    patch.dict(
                        os.environ,
                        {"PYTORCH_ENABLE_MPS_FALLBACK": "sentinel"},
                        clear=False,
                    ),
                    patch(
                        "xenia_revocable_feedback_model.train.verify_runtime_versions"
                    ) as runtime,
                    patch(
                        "xenia_revocable_feedback_model.train.ensure_empty_output"
                    ) as ensure_output,
                ):
                    with self.assertRaises(TrainingBundleError):
                        train_bounded_model(
                            cast(Any, _UntouchedBundle()),
                            output_dir=output,
                            dataset_admission_id=wrong_but_well_formed,
                            confirmation=GOVERNANCE_STATUS,
                            device="cpu",
                        )
                    runtime.assert_not_called()
                    ensure_output.assert_not_called()
                    self.assertEqual(
                        os.environ["PYTORCH_ENABLE_MPS_FALLBACK"],
                        "sentinel",
                    )
                if output_exists:
                    self.assertEqual(sentinel.read_text(encoding="utf-8"), "unchanged")
                else:
                    self.assertFalse(output.exists())

    def test_receipt_binds_export_only_after_model_and_tokenizer_are_saved(self) -> None:
        numpy_module = ModuleType("numpy")
        numpy_module.random = SimpleNamespace(seed=lambda _: None)  # type: ignore[attr-defined]
        torch_module = ModuleType("torch")
        torch_module.backends = SimpleNamespace(  # type: ignore[attr-defined]
            mps=SimpleNamespace(is_available=lambda: False)
        )
        torch_module.float32 = object()  # type: ignore[attr-defined]
        torch_module.long = object()  # type: ignore[attr-defined]
        torch_module.manual_seed = lambda _: None  # type: ignore[attr-defined]
        torch_module.use_deterministic_algorithms = lambda _: None  # type: ignore[attr-defined]
        torch_module.tensor = lambda value, **_: value  # type: ignore[attr-defined]

        tokenizer = _FakeTokenizer()
        model = _FakeModel()
        transformers_module = ModuleType("transformers")
        transformers_module.AutoTokenizer = SimpleNamespace(  # type: ignore[attr-defined]
            from_pretrained=lambda *_, **__: tokenizer
        )
        transformers_module.AutoModelForCausalLM = SimpleNamespace(  # type: ignore[attr-defined]
            from_pretrained=lambda *_, **__: model
        )
        transformers_module.TrainingArguments = (  # type: ignore[attr-defined]
            lambda **_: SimpleNamespace()
        )
        transformers_module.Trainer = _FakeTrainer  # type: ignore[attr-defined]

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            bundle = DatasetBundle(
                root=root,
                revision=DATASET_REVISION,
                hash_manifest_id=DATASET_HASH_MANIFEST_ID,
                authorization_id=AUTHORIZATION_ID,
                recipe_id=RECIPE_ID,
                training_manifest_id=TRAINING_MANIFEST_ID,
                train_rows=(),
                validation_rows=(),
                public_regression_rows=(),
            )
            runtime = {"python": "3.12.12", **EXPECTED_RUNTIME_VERSIONS}
            output = root / "run"
            with (
                patch.dict(
                    sys.modules,
                    {
                        "numpy": numpy_module,
                        "torch": torch_module,
                        "transformers": transformers_module,
                    },
                ),
                patch.dict(os.environ, {}, clear=False),
                patch(
                    "xenia_revocable_feedback_model.train.verify_runtime_versions",
                    return_value=runtime,
                ),
            ):
                receipt = train_bounded_model(
                    bundle,
                    output_dir=output,
                    dataset_admission_id=EXPECTED_DATASET_ADMISSION_ID,
                    confirmation=GOVERNANCE_STATUS,
                    device="cpu",
                )

            inspected = inspect_model_export(output / "model-export")
            self.assertEqual(receipt["schema"], RUN_RECEIPT_SCHEMA)
            self.assertEqual(receipt["model_export_id"], inspected.model_export_id)
            self.assertEqual(
                read_json(output / "run-receipt.json")["model_export_id"],
                inspected.model_export_id,
            )


if __name__ == "__main__":
    unittest.main()
