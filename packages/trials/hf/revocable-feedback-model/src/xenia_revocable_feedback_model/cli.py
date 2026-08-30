from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

from .core import (
    AUTHORIZATION_ID,
    DATASET_REVISION,
    GOVERNANCE_STATUS,
    RECIPE_ID,
    TRAINING_MANIFEST_ID,
    TrainingBundleError,
    _require,
    fixed_training_plan,
    read_json,
    write_canonical_json,
)
from .evaluate import evaluate_predictions, infer_public_regression
from .release import build_release, default_bundle_paths, verify_release
from .train import load_dataset_source, train_bounded_model, verify_runtime_versions


def _dataset_arguments(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--dataset-dir", type=Path, help="local exact dataset tree; omit for anonymous Hub input")
    parser.add_argument("--dataset-revision", default=DATASET_REVISION, help="frozen immutable Hub commit")
    parser.add_argument("--authorization-id", default=AUTHORIZATION_ID)
    parser.add_argument("--recipe-id", default=RECIPE_ID)
    parser.add_argument("--training-manifest-id", default=TRAINING_MANIFEST_ID)


def _bundle(arguments: argparse.Namespace) -> Any:
    return load_dataset_source(
        dataset_dir=arguments.dataset_dir,
        dataset_revision=arguments.dataset_revision,
        authorization_id=arguments.authorization_id,
        recipe_id=arguments.recipe_id,
        training_manifest_id=arguments.training_manifest_id,
    )


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        prog="xenia-rf-model",
        description="Fail-closed bounded revocable-feedback model experiment",
    )
    commands = root.add_subparsers(dest="command", required=True)

    commands.add_parser("plan", help="print the immutable eight-step plan")

    validate = commands.add_parser("validate-dataset", help="validate exact candidate inputs without training")
    _dataset_arguments(validate)

    train = commands.add_parser("train", help="run the operator-authorized non-Garden experiment")
    _dataset_arguments(train)
    train.add_argument("--output-dir", type=Path, required=True)
    train.add_argument("--dataset-admission-id", required=True, help="accepted Garden data-candidate admission reference")
    train.add_argument("--confirm-non-garden-experiment", required=True, choices=[GOVERNANCE_STATUS])
    train.add_argument("--device", choices=["auto", "cpu", "mps"], default="auto")

    evaluate = commands.add_parser("evaluate", help="greedily infer and score the public regression")
    _dataset_arguments(evaluate)
    evaluate.add_argument("--model-dir", type=Path, required=True)
    evaluate.add_argument("--output", type=Path, required=True)
    evaluate.add_argument("--device", choices=["cpu", "mps"], default="cpu")

    score = commands.add_parser("score", help="score a closed prediction JSON array without loading a model")
    _dataset_arguments(score)
    score.add_argument("--predictions", type=Path, required=True)
    score.add_argument("--output", type=Path, required=True)

    release = commands.add_parser("build-release", help="construct a sanitized, local release directory")
    release.add_argument("--run-dir", type=Path, required=True)
    release.add_argument("--scorecard", type=Path, required=True, help="scorecard or inference-evaluation JSON")
    release.add_argument("--output-dir", type=Path, required=True)

    verify = commands.add_parser("verify-release", help="verify a release tree and self-excluding hashes")
    verify.add_argument("--release-dir", type=Path, required=True)
    return root


def _dataset_summary(bundle: Any) -> dict[str, Any]:
    return {
        "dataset_revision": bundle.revision,
        "hash_manifest_id": bundle.hash_manifest_id,
        "authorization_id": bundle.authorization_id,
        "recipe_id": bundle.recipe_id,
        "training_manifest_id": bundle.training_manifest_id,
        "train_rows": len(bundle.train_rows),
        "validation_rows": len(bundle.validation_rows),
        "public_regression_rows": len(bundle.public_regression_rows),
        "validated": True,
    }


def run(arguments: argparse.Namespace) -> dict[str, Any]:
    if arguments.command == "plan":
        return fixed_training_plan()
    if arguments.command == "validate-dataset":
        with _bundle(arguments) as bundle:
            return _dataset_summary(bundle)
    if arguments.command == "train":
        with _bundle(arguments) as bundle:
            return train_bounded_model(
                bundle,
                output_dir=arguments.output_dir,
                dataset_admission_id=arguments.dataset_admission_id,
                confirmation=arguments.confirm_non_garden_experiment,
                device=arguments.device,
            )
    if arguments.command == "evaluate":
        _require(not arguments.output.exists(), "scorecard output must not already exist")
        verify_runtime_versions()
        with _bundle(arguments) as bundle:
            evaluation = infer_public_regression(
                arguments.model_dir,
                bundle.public_regression_rows,
                device=arguments.device,
            )
        write_canonical_json(arguments.output, evaluation)
        return {
            "inference_evaluation_id": evaluation["inference_evaluation_id"],
            "scorecard_id": evaluation["scorecard"]["scorecard_id"],
            "unparsed_count": evaluation["unparsed_count"],
            "output_written": True,
        }
    if arguments.command == "score":
        _require(not arguments.output.exists(), "scorecard output must not already exist")
        predictions = read_json(arguments.predictions)
        _require(isinstance(predictions, list), "predictions must be a JSON array")
        with _bundle(arguments) as bundle:
            scorecard = evaluate_predictions(bundle.public_regression_rows, predictions)
        write_canonical_json(arguments.output, scorecard)
        return {"scorecard_id": scorecard["scorecard_id"], "output_written": True}
    if arguments.command == "build-release":
        template, notice, license_path = default_bundle_paths()
        manifest = build_release(
            run_dir=arguments.run_dir,
            scorecard_path=arguments.scorecard,
            output_dir=arguments.output_dir,
            template_path=template,
            notice_path=notice,
            license_path=license_path,
        )
        return {"manifest_id": manifest["manifest_id"], "release_built": True}
    if arguments.command == "verify-release":
        manifest = verify_release(arguments.release_dir)
        return {"manifest_id": manifest["manifest_id"], "release_valid": True}
    raise AssertionError("unreachable command")


def main(argv: list[str] | None = None) -> int:
    try:
        result = run(parser().parse_args(argv))
    except (TrainingBundleError, OSError, UnicodeError, json.JSONDecodeError) as exc:
        print(f"xenia-rf-model: {exc}", file=sys.stderr)
        return 2
    print(json.dumps(result, ensure_ascii=False, allow_nan=False, sort_keys=True))
    return 0
