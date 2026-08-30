from __future__ import annotations

import copy
import json
import os
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from typing import Any, Callable
from unittest.mock import patch

from test_bundle import (
    inference_evaluation,
    perfect_scorecard,
    public_cases,
    run_receipt,
    write_minimal_model_export,
)
from xenia_revocable_feedback_model.core import (
    SCORECARD_SCHEMA,
    TrainingBundleError,
    domain_separated_id,
    ensure_empty_output,
    write_canonical_json,
)
from xenia_revocable_feedback_model.evaluate import (
    INFERENCE_EVALUATION_SCHEMA,
    validate_inference_evaluation,
)
from xenia_revocable_feedback_model.release import (
    _PINNED_PUBLIC_REGRESSION_CASES,
    _manifest_entries,
    build_release,
    default_bundle_paths,
    validate_scorecard,
    verify_release,
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


def rehash_release_manifest(root: Path) -> None:
    payload = {"manifest_excludes_itself": True, "files": _manifest_entries(root)}
    write_canonical_json(
        root / "hash-manifest.json",
        {
            "schema": "agenttool-sanitized-model-release-manifest/0.1",
            "manifest_id": domain_separated_id(
                "agenttool-sanitized-model-release-manifest/0.1",
                payload,
            ),
            **payload,
        },
    )


def build_fixture(root: Path, *, inference: bool = True) -> tuple[Path, str]:
    template, notice, license_path = default_bundle_paths()
    run = root / "run"
    model_export_id = write_minimal_model_export(run / "model-export")
    write_canonical_json(run / "run-receipt.json", run_receipt())
    evaluation_path = root / "evaluation.json"
    write_canonical_json(
        evaluation_path,
        inference_evaluation(model_export_id) if inference else perfect_scorecard(),
    )
    release = root / "release"
    build_release(
        run_dir=run,
        scorecard_path=evaluation_path,
        output_dir=release,
        template_path=template,
        notice_path=notice,
        license_path=license_path,
    )
    return release, model_export_id


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
            write_minimal_model_export(run / "model-export")
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


class ReleaseArtifactBindingTests(unittest.TestCase):
    def test_inference_shape_rejects_rehashed_extra_and_missing_claims(self) -> None:
        evaluation = inference_evaluation()
        evaluation["garden_governed"] = True
        rehash_inference(evaluation)
        with self.assertRaises(TrainingBundleError):
            validate_inference_evaluation(evaluation)

        missing = inference_evaluation()
        missing.pop("model_export_id")
        rehash_inference(missing)
        with self.assertRaises(TrainingBundleError):
            validate_inference_evaluation(missing)

    def test_build_rejects_rehashed_extra_claim_before_output(self) -> None:
        template, notice, license_path = default_bundle_paths()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run = root / "run"
            model_export_id = write_minimal_model_export(run / "model-export")
            write_canonical_json(run / "run-receipt.json", run_receipt())
            evaluation = inference_evaluation(model_export_id)
            evaluation["consent"] = True
            rehash_inference(evaluation)
            evaluation_path = root / "evaluation.json"
            write_canonical_json(evaluation_path, evaluation)
            output = root / "release"
            with self.assertRaises(TrainingBundleError):
                build_release(
                    run_dir=run,
                    scorecard_path=evaluation_path,
                    output_dir=output,
                    template_path=template,
                    notice_path=notice,
                    license_path=license_path,
                )
            self.assertFalse(output.exists())

    def test_build_never_accepts_the_legacy_inference_shape(self) -> None:
        template, notice, license_path = default_bundle_paths()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run = root / "run"
            model_export_id = write_minimal_model_export(run / "model-export")
            write_canonical_json(run / "run-receipt.json", run_receipt())
            legacy = inference_evaluation(model_export_id)
            legacy.pop("model_export_id")
            rehash_inference(legacy)
            evaluation_path = root / "legacy-inference.json"
            write_canonical_json(evaluation_path, legacy)
            output = root / "release"
            with self.assertRaises(TrainingBundleError):
                build_release(
                    run_dir=run,
                    scorecard_path=evaluation_path,
                    output_dir=output,
                    template_path=template,
                    notice_path=notice,
                    license_path=license_path,
                )
            self.assertFalse(output.exists())

    def test_verify_legacy_omission_requires_every_exact_triple_member(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            release, model_export_id = build_fixture(Path(temporary))
            inference_path = release / "evaluation" / "inference-receipt.json"
            inference = json.loads(inference_path.read_text(encoding="utf-8"))
            inference.pop("model_export_id")
            rehash_inference(inference)
            write_canonical_json(inference_path, inference)
            rehash_release_manifest(release)
            manifest = json.loads(
                (release / "hash-manifest.json").read_text(encoding="utf-8")
            )
            exact = {
                "LEGACY_PUBLISHED_RELEASE_MANIFEST_ID": manifest["manifest_id"],
                "LEGACY_PUBLISHED_INFERENCE_EVALUATION_ID": inference[
                    "inference_evaluation_id"
                ],
                "LEGACY_PUBLISHED_MODEL_EXPORT_ID": model_export_id,
            }
            target = "xenia_revocable_feedback_model.release."

            def verify_with_pins(pins: dict[str, str]) -> None:
                with ExitStack() as stack:
                    for name, value in pins.items():
                        stack.enter_context(patch(target + name, value))
                    verify_release(release)

            verify_with_pins(exact)

            for member in exact:
                pinned = dict(exact)
                pinned[member] = domain_separated_id(
                    "test-legacy-mismatch/0.1", {"member": member}
                )
                with self.subTest(member=member):
                    with self.assertRaises(TrainingBundleError):
                        verify_with_pins(pinned)

    def test_build_rejects_evaluated_and_released_model_mismatch(self) -> None:
        template, notice, license_path = default_bundle_paths()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run = root / "run"
            model_export_id = write_minimal_model_export(run / "model-export")
            write_canonical_json(run / "run-receipt.json", run_receipt())
            evaluation_path = root / "evaluation.json"
            write_canonical_json(evaluation_path, inference_evaluation(model_export_id))
            write_minimal_model_export(
                run / "model-export",
                weight_payload=b"\x01\x00\x00\x00",
            )
            output = root / "release"
            with self.assertRaises(TrainingBundleError):
                build_release(
                    run_dir=run,
                    scorecard_path=evaluation_path,
                    output_dir=output,
                    template_path=template,
                    notice_path=notice,
                    license_path=license_path,
                )
            self.assertFalse(output.exists())

    def test_verify_rejects_rehashed_different_weights(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            release, _ = build_fixture(Path(temporary))
            from test_bundle import minimal_safetensors_bytes

            (release / "model.safetensors").write_bytes(
                minimal_safetensors_bytes(payload=b"\x01\x00\x00\x00")
            )
            rehash_release_manifest(release)
            with self.assertRaises(TrainingBundleError):
                verify_release(release)

    def test_verify_rejects_sanitized_json_bypass_even_when_rehashed(self) -> None:
        fake_hf = "hf_" + "a" * 24
        hostile_documents = (
            '{"prompt":"private"}\n',
            f'{{"api_key":"{fake_hf}","api_key":"safe"}}\n',
        )
        for document in hostile_documents:
            with self.subTest(document=document[:12]), tempfile.TemporaryDirectory() as temporary:
                release, _ = build_fixture(Path(temporary), inference=False)
                (release / "config.json").write_text(document, encoding="utf-8")
                rehash_release_manifest(release)
                with self.assertRaises(TrainingBundleError):
                    verify_release(release)

    def test_output_and_release_tree_reject_symlinks_special_nodes_and_extra_dirs(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "target"
            target.mkdir()
            output = root / "output"
            output.symlink_to(target, target_is_directory=True)
            with self.assertRaises(TrainingBundleError):
                ensure_empty_output(output)

        mutations: list[tuple[str, Callable[[Path], None]]] = [
            (
                "directory symlink",
                lambda release: (release / "linked").symlink_to(
                    release / "evaluation", target_is_directory=True
                ),
            ),
            ("extra empty directory", lambda release: (release / "extra").mkdir()),
        ]
        if hasattr(os, "mkfifo"):
            mutations.append(
                ("fifo", lambda release: os.mkfifo(release / "evaluation" / "pipe"))
            )
        for name, mutate in mutations:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                release, _ = build_fixture(Path(temporary), inference=False)
                mutate(release)
                with self.assertRaises(TrainingBundleError):
                    verify_release(release)

    def test_verify_rejects_nested_manifest_and_allowlisted_model_names(self) -> None:
        for relative, value in (
            ("training/hash-manifest.json", {"hidden": True}),
            ("evaluation/config.json", {"model_type": "hidden"}),
        ):
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as temporary:
                release, _ = build_fixture(Path(temporary), inference=False)
                write_canonical_json(release / relative, value)
                rehash_release_manifest(release)
                with self.assertRaises(TrainingBundleError):
                    verify_release(release)

    def test_verify_rejects_manifest_extra_claim_and_non_integer_byte_count(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            release, _ = build_fixture(Path(temporary), inference=False)
            manifest_path = release / "hash-manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["credential"] = "hidden"
            write_canonical_json(manifest_path, manifest)
            with self.assertRaises(TrainingBundleError):
                verify_release(release)

        with tempfile.TemporaryDirectory() as temporary:
            release, _ = build_fixture(Path(temporary), inference=False)
            manifest_path = release / "hash-manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            manifest["files"][0]["bytes"] = True
            payload = {
                "manifest_excludes_itself": True,
                "files": manifest["files"],
            }
            manifest["manifest_id"] = domain_separated_id(
                "agenttool-sanitized-model-release-manifest/0.1", payload
            )
            write_canonical_json(manifest_path, manifest)
            with self.assertRaises(TrainingBundleError):
                verify_release(release)

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
            model_export_id = write_minimal_model_export(run / "model-export")
            write_canonical_json(run / "run-receipt.json", run_receipt())
            evaluation["model_export_id"] = model_export_id
            rehash_inference(evaluation)
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
