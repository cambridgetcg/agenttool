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
    architecture_patch,
    inference_evaluation,
    minimal_safetensors_bytes,
    perfect_scorecard,
    public_cases,
    run_receipt,
    write_minimal_model_export,
)
from xenia_revocable_feedback_model.core import (
    MODEL_SCORECARD_SCHEMA,
    SCORECARD_SCHEMA,
    TrainingBundleError,
    domain_separated_id,
    ensure_empty_output,
    inspect_model_export,
    write_canonical_json,
)
from xenia_revocable_feedback_model.evaluate import (
    INFERENCE_EVALUATION_SCHEMA,
    LEGACY_INFERENCE_EVALUATION_SCHEMA,
    validate_inference_evaluation,
)
from xenia_revocable_feedback_model.release import (
    _PINNED_PUBLIC_REGRESSION_CASES,
    _legacy_scorecard_from_current,
    _manifest_entries,
    build_release,
    default_bundle_paths,
    validate_scorecard,
    verify_release,
)


_ARCHITECTURE_PATCH = architecture_patch()


def setUpModule() -> None:
    _ARCHITECTURE_PATCH.start()  # type: ignore[attr-defined]


def tearDownModule() -> None:
    _ARCHITECTURE_PATCH.stop()  # type: ignore[attr-defined]


def rehash_scorecard(scorecard: dict[str, Any]) -> None:
    payload = {
        key: value
        for key, value in scorecard.items()
        if key not in {"schema", "scorecard_id"}
    }
    scorecard["scorecard_id"] = domain_separated_id(scorecard["schema"], payload)


def rehash_inference(evaluation: dict[str, Any]) -> None:
    payload = {
        key: value
        for key, value in evaluation.items()
        if key not in {"schema", "inference_evaluation_id"}
    }
    evaluation["inference_evaluation_id"] = domain_separated_id(
        evaluation["schema"],
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
    write_canonical_json(run / "run-receipt.json", run_receipt(model_export_id))
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
            "schema": MODEL_SCORECARD_SCHEMA,
            "scorecard_id": domain_separated_id(MODEL_SCORECARD_SCHEMA, payload),
            **payload,
        }
        with self.assertRaises(TrainingBundleError):
            validate_scorecard(forged)

    def test_build_release_rejects_self_hashed_partial_before_write(self) -> None:
        payload = {"case_count": 8, "pair_count": 4}
        forged = {
            "schema": MODEL_SCORECARD_SCHEMA,
            "scorecard_id": domain_separated_id(MODEL_SCORECARD_SCHEMA, payload),
            **payload,
        }
        template, notice, license_path = default_bundle_paths()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run = root / "run"
            model_export_id = write_minimal_model_export(run / "model-export")
            write_canonical_json(
                run / "run-receipt.json",
                run_receipt(model_export_id),
            )
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
    def test_build_rejects_self_consistent_partial_weights_before_output(self) -> None:
        template, notice, license_path = default_bundle_paths()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run = root / "run"
            model = run / "model-export"
            write_minimal_model_export(model)
            (model / "model.safetensors").write_bytes(minimal_safetensors_bytes())
            model_export_id = inspect_model_export(model).model_export_id
            write_canonical_json(
                run / "run-receipt.json",
                run_receipt(model_export_id),
            )
            evaluation_path = root / "evaluation.json"
            write_canonical_json(
                evaluation_path,
                inference_evaluation(model_export_id),
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

    def test_inference_validator_rejects_malformed_or_legacy_nested_scorecard(self) -> None:
        malformed = inference_evaluation()
        malformed["scorecard"] = {
            "schema": MODEL_SCORECARD_SCHEMA,
            "scorecard_id": "not-a-content-id",
            "case_count": 8,
            "case_results": malformed["scorecard"]["case_results"],
        }
        rehash_inference(malformed)
        with self.assertRaises(TrainingBundleError):
            validate_inference_evaluation(malformed)

        legacy_nested = inference_evaluation()
        legacy_nested["scorecard"]["schema"] = SCORECARD_SCHEMA
        rehash_scorecard(legacy_nested["scorecard"])
        rehash_inference(legacy_nested)
        with self.assertRaises(TrainingBundleError):
            validate_inference_evaluation(legacy_nested)

        for name, mutate in (
            (
                "metric count",
                lambda scorecard: scorecard["metric_vector"][0].__setitem__("count", 7),
            ),
            (
                "metric denominator",
                lambda scorecard: scorecard["metric_vector"][0].__setitem__("denominator", 0),
            ),
        ):
            with self.subTest(name=name):
                forged_nested = inference_evaluation()
                mutate(forged_nested["scorecard"])
                rehash_scorecard(forged_nested["scorecard"])
                rehash_inference(forged_nested)
                with self.assertRaises(TrainingBundleError):
                    validate_inference_evaluation(forged_nested)

    def test_build_rejects_rehashed_extra_claim_before_output(self) -> None:
        template, notice, license_path = default_bundle_paths()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run = root / "run"
            model_export_id = write_minimal_model_export(run / "model-export")
            write_canonical_json(
                run / "run-receipt.json",
                run_receipt(model_export_id),
            )
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
            write_canonical_json(
                run / "run-receipt.json",
                run_receipt(model_export_id),
            )
            legacy = inference_evaluation(model_export_id)
            legacy["schema"] = LEGACY_INFERENCE_EVALUATION_SCHEMA
            legacy.pop("model_export_id")
            legacy["scorecard"] = _legacy_scorecard_from_current(legacy["scorecard"])
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

    def test_build_never_accepts_the_legacy_scorecard_shape(self) -> None:
        template, notice, license_path = default_bundle_paths()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run = root / "run"
            model_export_id = write_minimal_model_export(run / "model-export")
            write_canonical_json(
                run / "run-receipt.json",
                run_receipt(model_export_id),
            )
            legacy_path = root / "legacy-scorecard.json"
            write_canonical_json(
                legacy_path,
                _legacy_scorecard_from_current(perfect_scorecard()),
            )
            output = root / "release"
            with self.assertRaises(TrainingBundleError):
                build_release(
                    run_dir=run,
                    scorecard_path=legacy_path,
                    output_dir=output,
                    template_path=template,
                    notice_path=notice,
                    license_path=license_path,
                )
            self.assertFalse(output.exists())

    def test_build_never_accepts_the_legacy_run_receipt_shape(self) -> None:
        template, notice, license_path = default_bundle_paths()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run = root / "run"
            model_export_id = write_minimal_model_export(run / "model-export")
            legacy = run_receipt(model_export_id)
            legacy["schema"] = "agenttool-revocable-feedback-local-run/0.1"
            legacy.pop("model_export_id")
            write_canonical_json(run / "run-receipt.json", legacy)
            scorecard_path = root / "scorecard.json"
            write_canonical_json(scorecard_path, perfect_scorecard())
            output = root / "release"
            with self.assertRaises(TrainingBundleError):
                build_release(
                    run_dir=run,
                    scorecard_path=scorecard_path,
                    output_dir=output,
                    template_path=template,
                    notice_path=notice,
                    license_path=license_path,
                )
            self.assertFalse(output.exists())

    def test_verify_legacy_omission_requires_every_exact_triple_member(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            release, model_export_id = build_fixture(Path(temporary))
            receipt_path = release / "training" / "manifest.json"
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            receipt["schema"] = "agenttool-revocable-feedback-local-run/0.1"
            receipt.pop("model_export_id")
            write_canonical_json(receipt_path, receipt)
            inference_path = release / "evaluation" / "inference-receipt.json"
            inference = json.loads(inference_path.read_text(encoding="utf-8"))
            legacy_scorecard = _legacy_scorecard_from_current(inference["scorecard"])
            write_canonical_json(
                release / "evaluation" / "public-regression-vector.json",
                legacy_scorecard,
            )
            inference["schema"] = LEGACY_INFERENCE_EVALUATION_SCHEMA
            inference.pop("model_export_id")
            inference["scorecard"] = legacy_scorecard
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
            write_canonical_json(
                run / "run-receipt.json",
                run_receipt(model_export_id),
            )
            evaluation_path = root / "evaluation.json"
            write_canonical_json(evaluation_path, inference_evaluation(model_export_id))
            replacement_model_export_id = write_minimal_model_export(
                run / "model-export",
                weight_payload=b"\x01\x00\x00\x00",
            )
            write_canonical_json(
                run / "run-receipt.json",
                run_receipt(replacement_model_export_id),
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

    def test_build_scorecard_only_rejects_run_receipt_for_different_model(self) -> None:
        template, notice, license_path = default_bundle_paths()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run = root / "run"
            first_model_export_id = write_minimal_model_export(run / "model-export")
            write_canonical_json(
                run / "run-receipt.json",
                run_receipt(first_model_export_id),
            )
            write_minimal_model_export(
                run / "model-export",
                weight_payload=b"\x01\x00\x00\x00",
            )
            scorecard_path = root / "scorecard.json"
            write_canonical_json(scorecard_path, perfect_scorecard())
            output = root / "release"
            with self.assertRaises(TrainingBundleError):
                build_release(
                    run_dir=run,
                    scorecard_path=scorecard_path,
                    output_dir=output,
                    template_path=template,
                    notice_path=notice,
                    license_path=license_path,
                )
            self.assertFalse(output.exists())

    def test_verify_rejects_rehashed_run_receipt_model_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            release, _ = build_fixture(Path(temporary), inference=False)
            receipt_path = release / "training" / "manifest.json"
            receipt = json.loads(receipt_path.read_text(encoding="utf-8"))
            receipt["model_export_id"] = "sha256:" + "9" * 64
            write_canonical_json(receipt_path, receipt)
            rehash_release_manifest(release)
            with self.assertRaises(TrainingBundleError):
                verify_release(release)

    def test_verify_rejects_rehashed_model_card_lineage_tampering(self) -> None:
        replacement_sha = "sha256:" + "8" * 64
        mutations: tuple[tuple[str, Callable[[str, dict[str, Any], dict[str, Any]], str]], ...] = (
            (
                "dataset revision",
                lambda card, receipt, _: card.replace(
                    str(receipt["dataset"]["revision"]),
                    "0" * 40,
                    1,
                ),
            ),
            (
                "dataset authorization",
                lambda card, receipt, _: card.replace(
                    str(receipt["dataset"]["authorization_id"]),
                    replacement_sha,
                    1,
                ),
            ),
            (
                "dataset recipe",
                lambda card, receipt, _: card.replace(
                    str(receipt["dataset"]["recipe_id"]),
                    replacement_sha,
                    1,
                ),
            ),
            (
                "dataset manifest",
                lambda card, receipt, _: card.replace(
                    str(receipt["dataset"]["training_manifest_id"]),
                    replacement_sha,
                    1,
                ),
            ),
            (
                "Garden admission",
                lambda card, receipt, _: card.replace(
                    str(receipt["garden"]["dataset_admission_id"]),
                    replacement_sha,
                    1,
                ),
            ),
            (
                "scorecard",
                lambda card, _, scorecard: card.replace(
                    str(scorecard["scorecard_id"]),
                    replacement_sha,
                    1,
                ),
            ),
            (
                "unparsed count",
                lambda card, _receipt, _scorecard: card.replace(
                    "- Unparsed generation count: `0`",
                    "- Unparsed generation count: `1`",
                    1,
                ),
            ),
            (
                "duplicate contradictory scorecard",
                lambda card, _receipt, scorecard: card.replace(
                    f"- Public regression scorecard: `{scorecard['scorecard_id']}`",
                    f"- Public regression scorecard: `{scorecard['scorecard_id']}`\n"
                    f"- Public regression scorecard: `{replacement_sha}`",
                    1,
                ),
            ),
        )
        for name, mutate in mutations:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                release, _ = build_fixture(Path(temporary))
                receipt = json.loads(
                    (release / "training" / "manifest.json").read_text(
                        encoding="utf-8"
                    )
                )
                scorecard = json.loads(
                    (
                        release
                        / "evaluation"
                        / "public-regression-vector.json"
                    ).read_text(encoding="utf-8")
                )
                card_path = release / "README.md"
                original = card_path.read_text(encoding="utf-8")
                tampered = mutate(original, receipt, scorecard)
                self.assertNotEqual(tampered, original)
                card_path.write_text(tampered, encoding="utf-8", newline="\n")
                rehash_release_manifest(release)
                with self.assertRaises(TrainingBundleError):
                    verify_release(release)

    def test_scorecard_only_card_uses_explicit_not_applicable_unparsed_value(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            release, _ = build_fixture(Path(temporary), inference=False)
            self.assertIn(
                "- Unparsed generation count: `not_applicable_precomputed_predictions`",
                (release / "README.md").read_text(encoding="utf-8"),
            )
            verify_release(release)

    def test_verify_rejects_rehashed_crlf_model_card(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            release, _ = build_fixture(Path(temporary))
            card_path = release / "README.md"
            card = card_path.read_bytes()
            self.assertNotIn(b"\r\n", card)
            card_path.write_bytes(card.replace(b"\n", b"\r\n"))
            rehash_release_manifest(release)
            with self.assertRaises(TrainingBundleError):
                verify_release(release)

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
            "metric applicability": lambda value: value["metric_vector"][0].__setitem__(
                "applicable", False
            ),
            "metric denominator kind": lambda value: value["metric_vector"][0].__setitem__(
                "denominator_kind", "pair"
            ),
            "metric denominator": lambda value: value["metric_vector"][0].__setitem__(
                "denominator", 0
            ),
            "inapplicable metric count": lambda value: value["metric_vector"][2].__setitem__(
                "count", 1
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

    def test_rejects_stale_and_rehashed_bool_integer_type_aliases(self) -> None:
        mutators: dict[str, Callable[[dict[str, Any]], None]] = {
            "zero count as false": lambda value: value["metric_vector"][2].__setitem__(
                "count", False
            ),
            "one denominator as true": lambda value: value["metric_vector"][4].__setitem__(
                "denominator", True
            ),
            "true applicability as one": lambda value: value["metric_vector"][0].__setitem__(
                "applicable", 1
            ),
            "true exact match as one": lambda value: value["case_results"][0].__setitem__(
                "exact_match", 1
            ),
        }
        for name, mutate in mutators.items():
            for rehash in (False, True):
                with self.subTest(name=name, rehash=rehash):
                    forged = copy.deepcopy(perfect_scorecard())
                    mutate(forged)
                    if rehash:
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
            write_canonical_json(
                run / "run-receipt.json",
                run_receipt(model_export_id),
            )
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
