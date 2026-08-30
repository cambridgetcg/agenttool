from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path
from typing import Any, Callable

from test_bundle import perfect_scorecard, run_receipt
from xenia_revocable_feedback_model.core import TrainingBundleError, write_canonical_json
from xenia_revocable_feedback_model.release import (
    build_release,
    default_bundle_paths,
    validate_run_receipt,
)


class RunReceiptValidationTests(unittest.TestCase):
    def test_accepts_exact_bindings_with_bounded_observations(self) -> None:
        receipt = run_receipt()
        validate_run_receipt(receipt)

        receipt["resolved_device"] = "mps"
        receipt["observed_training_loss"] = "2.75e-7"
        validate_run_receipt(receipt)

    def test_rejects_altered_recipe_governance_and_effect_bindings(self) -> None:
        mutators: dict[str, Callable[[dict[str, Any]], None]] = {
            "schema": lambda value: value.__setitem__("schema", "forged/0.1"),
            "extra top-level field": lambda value: value.__setitem__(
                "garden_governed", True
            ),
            "missing top-level field": lambda value: value.pop(
                "operator_acknowledgement"
            ),
            "governance status": lambda value: value.__setitem__(
                "governance_status", "garden_governed"
            ),
            "disclosure": lambda value: value.__setitem__("disclosure", "forged"),
            "operator acknowledgement": lambda value: value.__setitem__(
                "operator_acknowledgement", "forged"
            ),
            "base model": lambda value: value["base"].__setitem__(
                "model_id", "forged/model"
            ),
            "base revision": lambda value: value["base"].__setitem__(
                "revision", "0" * 40
            ),
            "base extra field": lambda value: value["base"].__setitem__(
                "mutable_head", True
            ),
            "dataset ID": lambda value: value["dataset"].__setitem__(
                "id", "forged/dataset"
            ),
            "dataset revision": lambda value: value["dataset"].__setitem__(
                "revision", "0" * 40
            ),
            "dataset hash manifest": lambda value: value["dataset"].__setitem__(
                "hash_manifest_id", "sha256:" + "0" * 64
            ),
            "dataset authorization": lambda value: value["dataset"].__setitem__(
                "authorization_id", "sha256:" + "1" * 64
            ),
            "dataset recipe": lambda value: value["dataset"].__setitem__(
                "recipe_id", "sha256:" + "2" * 64
            ),
            "dataset training manifest": lambda value: value["dataset"].__setitem__(
                "training_manifest_id", "sha256:" + "3" * 64
            ),
            "dataset extra field": lambda value: value["dataset"].__setitem__(
                "training_authorized", True
            ),
            "Garden admission": lambda value: value["garden"].__setitem__(
                "dataset_admission_id", "sha256:" + "4" * 64
            ),
            "Garden admission effect": lambda value: value["garden"].__setitem__(
                "dataset_admission_effect", "run_authority"
            ),
            "Garden training decision": lambda value: value["garden"].__setitem__(
                "training_governance_decision_id", "sha256:" + "5" * 64
            ),
            "Host optimizer permit": lambda value: value["garden"].__setitem__(
                "host_one_use_optimizer_permit_id", "sha256:" + "6" * 64
            ),
            "substrate report": lambda value: value["garden"].__setitem__(
                "training_substrate_report", "assent_inferred"
            ),
            "Garden extra field": lambda value: value["garden"].__setitem__(
                "consent", True
            ),
            "fixed plan": lambda value: value["plan"].__setitem__("max_steps", 9),
            "fixed plan extra field": lambda value: value["plan"].__setitem__(
                "reward_model", True
            ),
            "optimizer steps": lambda value: value.__setitem__(
                "observed_optimizer_steps", 7
            ),
            "raw prompts": lambda value: value.__setitem__(
                "raw_prompts_retained", True
            ),
            "raw generations": lambda value: value.__setitem__(
                "raw_generations_retained", True
            ),
            "optimizer state": lambda value: value.__setitem__(
                "optimizer_state_retained", True
            ),
            "trainer state": lambda value: value.__setitem__(
                "trainer_state_retained", True
            ),
            "publication effect": lambda value: value.__setitem__("publishes", True),
        }
        for name, mutate in mutators.items():
            with self.subTest(name=name):
                forged = copy.deepcopy(run_receipt())
                mutate(forged)
                with self.assertRaises(TrainingBundleError):
                    validate_run_receipt(forged)

    def test_rejects_malformed_observations(self) -> None:
        mutators: dict[str, Callable[[dict[str, Any]], None]] = {
            "device": lambda value: value.__setitem__("resolved_device", "auto"),
            "runtime missing": lambda value: value["runtime"].pop("torch"),
            "runtime extra": lambda value: value["runtime"].__setitem__(
                "platform", "macos"
            ),
            "runtime incompatible": lambda value: value["runtime"].__setitem__(
                "torch", "2.13.1"
            ),
            "runtime unsafe value": lambda value: value["runtime"].__setitem__(
                "torch", "2.13.0 /tmp"
            ),
            "loss non-string": lambda value: value.__setitem__(
                "observed_training_loss", 1.25
            ),
            "loss negative": lambda value: value.__setitem__(
                "observed_training_loss", "-1"
            ),
            "loss NaN": lambda value: value.__setitem__(
                "observed_training_loss", "NaN"
            ),
            "loss infinity": lambda value: value.__setitem__(
                "observed_training_loss", "Infinity"
            ),
            "loss blank": lambda value: value.__setitem__(
                "observed_training_loss", " "
            ),
            "loss oversized": lambda value: value.__setitem__(
                "observed_training_loss", "1" * 65
            ),
        }
        for name, mutate in mutators.items():
            with self.subTest(name=name):
                forged = copy.deepcopy(run_receipt())
                mutate(forged)
                with self.assertRaises(TrainingBundleError):
                    validate_run_receipt(forged)

    def test_build_release_rejects_forged_receipt_before_write(self) -> None:
        template, notice, license_path = default_bundle_paths()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run = root / "run"
            forged = run_receipt()
            forged["dataset"]["authorization_id"] = "sha256:" + "7" * 64
            write_canonical_json(run / "run-receipt.json", forged)
            scorecard = root / "scorecard.json"
            write_canonical_json(scorecard, perfect_scorecard())
            output = root / "release"
            with self.assertRaises(TrainingBundleError):
                build_release(
                    run_dir=run,
                    scorecard_path=scorecard,
                    output_dir=output,
                    template_path=template,
                    notice_path=notice,
                    license_path=license_path,
                )
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
