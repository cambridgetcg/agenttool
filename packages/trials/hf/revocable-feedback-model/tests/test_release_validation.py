from __future__ import annotations

import copy
import tempfile
import unittest
from pathlib import Path
from typing import Any, Callable

from test_bundle import inference_evaluation, perfect_scorecard, public_cases, run_receipt
from xenia_revocable_feedback_model.core import (
    SCORECARD_SCHEMA,
    TrainingBundleError,
    domain_separated_id,
    write_canonical_json,
)
from xenia_revocable_feedback_model.evaluate import INFERENCE_EVALUATION_SCHEMA
from xenia_revocable_feedback_model.release import (
    _PINNED_PUBLIC_REGRESSION_CASES,
    build_release,
    default_bundle_paths,
    validate_scorecard,
)


def rehash_scorecard(scorecard: dict[str, Any]) -> None:
    payload = {
        key: value
        for key, value in scorecard.items()
        if key not in {"schema", "scorecard_id"}
    }
    scorecard["scorecard_id"] = domain_separated_id(SCORECARD_SCHEMA, payload)


def rehash_inference(evaluation: dict[str, Any]) -> None:
    payload = {
        key: value
        for key, value in evaluation.items()
        if key not in {"schema", "inference_evaluation_id"}
    }
    evaluation["inference_evaluation_id"] = domain_separated_id(
        INFERENCE_EVALUATION_SCHEMA,
        payload,
    )


class ReleaseScorecardValidationTests(unittest.TestCase):
    def test_release_pin_matches_checked_in_public_regression(self) -> None:
        projection = [
            {
                "record_id": case["record_id"],
                "pair_id": case["pair_id"],
                "family": case["family"],
                "variant": case["variant"],
                "expected": case["expected"],
            }
            for case in public_cases()
        ]
        self.assertEqual(list(_PINNED_PUBLIC_REGRESSION_CASES), projection)

    def test_rejects_self_hashed_partial_scorecard(self) -> None:
        payload = {"case_count": 8, "pair_count": 4}
        forged = {
            "schema": SCORECARD_SCHEMA,
            "scorecard_id": domain_separated_id(SCORECARD_SCHEMA, payload),
            **payload,
        }
        with self.assertRaises(TrainingBundleError):
            validate_scorecard(forged)

    def test_build_release_rejects_self_hashed_partial_before_write(self) -> None:
        payload = {"case_count": 8, "pair_count": 4}
        forged = {
            "schema": SCORECARD_SCHEMA,
            "scorecard_id": domain_separated_id(SCORECARD_SCHEMA, payload),
            **payload,
        }
        template, notice, license_path = default_bundle_paths()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run = root / "run"
            write_canonical_json(run / "run-receipt.json", run_receipt())
            input_path = root / "scorecard.json"
            write_canonical_json(input_path, forged)
            output = root / "release"
            with self.assertRaises(TrainingBundleError):
                build_release(
                    run_dir=run,
                    scorecard_path=input_path,
                    output_dir=output,
                    template_path=template,
                    notice_path=notice,
                    license_path=license_path,
                )
            self.assertFalse(output.exists())

    def test_rejects_rehashed_derived_fields_and_non_closed_shape(self) -> None:
        mutators: dict[str, Callable[[dict[str, Any]], None]] = {
            "benchmark digest": lambda value: value.__setitem__(
                "benchmark_digest", "sha256:" + "1" * 64
            ),
            "prediction digest": lambda value: value.__setitem__(
                "prediction_digest", "sha256:" + "2" * 64
            ),
            "case count": lambda value: value.__setitem__("case_count", 7),
            "pair count": lambda value: value.__setitem__("pair_count", 3),
            "metric count": lambda value: value["metric_vector"][0].__setitem__(
                "count", 7
            ),
            "expected decision": lambda value: value["case_results"][0].__setitem__(
                "expected_decision", "admit"
            ),
            "exact match flag": lambda value: value["case_results"][0].__setitem__(
                "exact_match", False
            ),
            "metric flags": lambda value: value["case_results"][0].__setitem__(
                "metric_flags", []
            ),
            "pair binding": lambda value: value["case_results"][0].__setitem__(
                "pair_id", "rf.pair.forged"
            ),
            "family binding": lambda value: value["case_results"][0].__setitem__(
                "family", "veto_dominance"
            ),
            "statement": lambda value: value.__setitem__("statement", "forged"),
            "extra field": lambda value: value.__setitem__("scalar_score", 1),
        }
        for name, mutate in mutators.items():
            with self.subTest(name=name):
                forged = copy.deepcopy(perfect_scorecard())
                mutate(forged)
                rehash_scorecard(forged)
                with self.assertRaises(TrainingBundleError):
                    validate_scorecard(forged)

    def test_rejects_rehashed_nested_scorecard_before_release_write(self) -> None:
        evaluation = copy.deepcopy(inference_evaluation())
        scorecard = evaluation["scorecard"]
        scorecard["metric_vector"][0]["count"] = 7
        rehash_scorecard(scorecard)
        rehash_inference(evaluation)

        template, notice, license_path = default_bundle_paths()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run = root / "run"
            write_canonical_json(run / "run-receipt.json", run_receipt())
            input_path = root / "inference.json"
            write_canonical_json(input_path, evaluation)
            output = root / "release"
            with self.assertRaises(TrainingBundleError):
                build_release(
                    run_dir=run,
                    scorecard_path=input_path,
                    output_dir=output,
                    template_path=template,
                    notice_path=notice,
                    license_path=license_path,
                )
            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
