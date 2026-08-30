from __future__ import annotations

import re
import shutil
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Mapping

from .evaluate import (
    INFERENCE_EVALUATION_SCHEMA,
    SCORECARD_KEYS,
    _PINNED_PUBLIC_REGRESSION_CASES,
    _validate_legacy_inference_evaluation,
    evaluate_predictions,
    validate_inference_evaluation,
    validate_scorecard,
)

from .core import (
    AUTHORIZATION_ID,
    BASE_MODEL_ID,
    BASE_MODEL_REVISION,
    DATASET_HASH_MANIFEST_ID,
    DATASET_ID,
    DATASET_REVISION,
    DISCLOSURE,
    EXPECTED_DATASET_ADMISSION_ID,
    EXPECTED_RUNTIME_VERSIONS,
    GOVERNANCE_STATUS,
    MODEL_EXPORT_FILE,
    PRIVATE_TEXT_PATTERNS,
    RECIPE_ID,
    RUN_RECEIPT_SCHEMA,
    SCORECARD_SCHEMA,
    SCORECARD_STATEMENT,
    TRAINING_MANIFEST_ID,
    TrainingBundleError,
    _require,
    canonical_json,
    domain_separated_id,
    ensure_empty_output,
    fixed_training_plan,
    inspect_publishable_model_export,
    inspect_regular_tree,
    read_json,
    require_sha256_id,
    sha256_file_hex,
    validate_sanitized_json,
    validate_publishable_model_load,
    write_canonical_json,
)

LEGACY_RUN_RECEIPT_SCHEMA = "agenttool-revocable-feedback-local-run/0.1"
RUN_RECEIPT_KEYS = {
    "schema",
    "model_export_id",
    "governance_status",
    "disclosure",
    "operator_acknowledgement",
    "garden",
    "base",
    "dataset",
    "plan",
    "runtime",
    "resolved_device",
    "observed_optimizer_steps",
    "observed_training_loss",
    "raw_prompts_retained",
    "raw_generations_retained",
    "optimizer_state_retained",
    "trainer_state_retained",
    "publishes",
}
LEGACY_RUN_RECEIPT_KEYS = RUN_RECEIPT_KEYS - {"model_export_id"}
EXPECTED_RUN_RUNTIME = {"python": "3.12.12", **EXPECTED_RUNTIME_VERSIONS}

LEGACY_PUBLISHED_RELEASE_MANIFEST_ID = "sha256:4c16e0bf945cbde8dda8af9e2e63a144a82900c504a404e344119ac7dae044e9"
LEGACY_PUBLISHED_INFERENCE_EVALUATION_ID = "sha256:299d3632fc6bf4256c883027591c25cbc8066621c25ec897efc7e26f73906f05"
LEGACY_PUBLISHED_MODEL_EXPORT_ID = "sha256:97b0c85898dec0396a4f575ea3fe619503a37239b054430b8f94e3905e45aad6"
RELEASE_NON_MODEL_ENTRIES = frozenset(
    {"README.md", "LICENSE", "NOTICE", "hash-manifest.json", "training", "evaluation"}
)

def _validate_run_receipt(
    receipt: Mapping[str, Any],
    *,
    legacy: bool,
    expected_model_export_id: str | None,
) -> None:
    expected_schema = LEGACY_RUN_RECEIPT_SCHEMA if legacy else RUN_RECEIPT_SCHEMA
    expected_keys = LEGACY_RUN_RECEIPT_KEYS if legacy else RUN_RECEIPT_KEYS
    _require(receipt.get("schema") == expected_schema, "unexpected run receipt schema")
    _require(set(receipt) == expected_keys, "run receipt must contain the complete closed release shape")
    if not legacy:
        model_export_id = require_sha256_id(
            receipt.get("model_export_id"),
            "run receipt model_export_id",
        )
        if expected_model_export_id is not None:
            _require(
                model_export_id == expected_model_export_id,
                "run receipt model export does not match the inspected model export",
            )
    _require(receipt.get("governance_status") == GOVERNANCE_STATUS, "run governance status mismatch")
    _require(receipt.get("disclosure") == DISCLOSURE, "run disclosure mismatch")
    _require(receipt.get("operator_acknowledgement") == GOVERNANCE_STATUS, "operator acknowledgement mismatch")
    _require(receipt.get("observed_optimizer_steps") == 8, "release requires exactly eight observed optimizer steps")
    for key in (
        "raw_prompts_retained",
        "raw_generations_retained",
        "optimizer_state_retained",
        "trainer_state_retained",
        "publishes",
    ):
        _require(receipt.get(key) is False, f"run receipt must record {key}=false")
    garden = receipt.get("garden")
    _require(isinstance(garden, Mapping), "run receipt Garden boundary is absent")
    _require(
        dict(garden)
        == {
            "dataset_admission_id": EXPECTED_DATASET_ADMISSION_ID,
            "dataset_admission_effect": "data_candidate_only",
            "training_governance_decision_id": None,
            "host_one_use_optimizer_permit_id": None,
            "training_substrate_report": "not_independently_available",
        },
        "run Garden binding does not match the reviewed data-candidate admission",
    )
    base = receipt.get("base")
    _require(base == {"model_id": BASE_MODEL_ID, "revision": BASE_MODEL_REVISION}, "run base binding mismatch")
    dataset = receipt.get("dataset")
    _require(isinstance(dataset, Mapping), "run dataset binding is absent")
    _require(
        dict(dataset)
        == {
            "id": DATASET_ID,
            "revision": DATASET_REVISION,
            "hash_manifest_id": DATASET_HASH_MANIFEST_ID,
            "authorization_id": AUTHORIZATION_ID,
            "recipe_id": RECIPE_ID,
            "training_manifest_id": TRAINING_MANIFEST_ID,
        },
        "run dataset binding does not match the frozen experiment",
    )
    _require(receipt.get("plan") == fixed_training_plan(), "run plan does not match the frozen experiment")
    runtime = receipt.get("runtime")
    _require(
        isinstance(runtime, Mapping) and dict(runtime) == EXPECTED_RUN_RUNTIME,
        "run runtime does not match the frozen experiment",
    )
    _require(receipt.get("resolved_device") in {"cpu", "mps"}, "run resolved device observation mismatch")
    observed_loss = receipt.get("observed_training_loss")
    _require(
        isinstance(observed_loss, str)
        and 0 < len(observed_loss) <= 64
        and observed_loss == observed_loss.strip(),
        "run loss observation must be a bounded string",
    )
    try:
        parsed_loss = Decimal(observed_loss)
    except InvalidOperation as exc:
        raise TrainingBundleError("run loss observation must be numeric") from exc
    _require(parsed_loss.is_finite() and parsed_loss >= 0, "run loss observation must be finite and non-negative")
    validate_sanitized_json(receipt, "run receipt")


def validate_run_receipt(
    receipt: Mapping[str, Any],
    *,
    expected_model_export_id: str | None = None,
) -> None:
    _validate_run_receipt(
        receipt,
        legacy=False,
        expected_model_export_id=expected_model_export_id,
    )


def _validate_legacy_run_receipt(receipt: Mapping[str, Any]) -> None:
    _validate_run_receipt(
        receipt,
        legacy=True,
        expected_model_export_id=None,
    )


def _legacy_scorecard_from_current(scorecard: Mapping[str, Any]) -> dict[str, Any]:
    payload = {
        key: value
        for key, value in scorecard.items()
        if key not in {"schema", "scorecard_id", "metric_vector", "statement"}
    }
    payload["metric_vector"] = [
        {"metric": entry["metric"], "count": entry["count"]}
        for entry in scorecard["metric_vector"]
    ]
    payload["statement"] = SCORECARD_STATEMENT
    return {
        "schema": SCORECARD_SCHEMA,
        "scorecard_id": domain_separated_id(SCORECARD_SCHEMA, payload),
        **payload,
    }


def _validate_legacy_scorecard(scorecard: Mapping[str, Any]) -> None:
    _require(scorecard.get("schema") == SCORECARD_SCHEMA, "unexpected legacy scorecard schema")
    _require(set(scorecard) == SCORECARD_KEYS, "legacy scorecard must contain the complete closed release shape")
    identifier = require_sha256_id(scorecard.get("scorecard_id"), "legacy scorecard_id")
    supplied_payload = {
        key: value
        for key, value in scorecard.items()
        if key not in {"schema", "scorecard_id"}
    }
    _require(
        identifier == domain_separated_id(SCORECARD_SCHEMA, supplied_payload),
        "legacy scorecard content ID mismatch",
    )
    results = scorecard.get("case_results")
    _require(isinstance(results, list), "legacy scorecard case_results must be an array")
    predictions: list[dict[str, Any]] = []
    for index, result in enumerate(results):
        _require(isinstance(result, Mapping), f"legacy scorecard case result {index} must be an object")
        predictions.append(
            {
                "record_id": result.get("record_id"),
                "decision": result.get("predicted_decision"),
            }
        )
    expected = _legacy_scorecard_from_current(
        evaluate_predictions(_PINNED_PUBLIC_REGRESSION_CASES, predictions)
    )
    _require(
        canonical_json(dict(scorecard)) == canonical_json(expected),
        "legacy scorecard does not equal the score recomputed from the pinned public regression",
    )
    validate_sanitized_json(scorecard, "legacy scorecard")


def _card_short_description(card: str) -> str:
    _require(card.startswith("---\n"), "model card must begin with YAML front matter")
    end = card.find("\n---\n", 4)
    _require(end != -1, "model card front matter is unterminated")
    matches = re.findall(r"(?m)^short_description:\s*(.+?)\s*$", card[4:end])
    _require(len(matches) == 1, "model card must have exactly one short_description")
    description = matches[0].strip().strip("'\"")
    _require(0 < len(description) <= 60, "model card short_description must be at most 60 characters")
    return description


def validate_model_card(card: str) -> None:
    _card_short_description(card)
    _require(DISCLOSURE in card, "model card is missing the exact audit disclosure")
    _require("{{" not in card and "}}" not in card, "model card contains unresolved placeholders")
    _require(GOVERNANCE_STATUS in card, "model card is missing the exact governance status")
    for pattern in PRIVATE_TEXT_PATTERNS:
        _require(pattern.search(card) is None, "model card contains a credential or local-path pattern")


def _render_card(
    template: str,
    receipt: Mapping[str, Any],
    scorecard: Mapping[str, Any],
    *,
    unparsed_count: int | None,
) -> str:
    dataset = receipt["dataset"]
    garden = receipt["garden"]
    values = {
        "DATASET_REVISION": dataset["revision"],
        "AUTHORIZATION_ID": dataset["authorization_id"],
        "RECIPE_ID": dataset["recipe_id"],
        "TRAINING_MANIFEST_ID": dataset["training_manifest_id"],
        "DATASET_ADMISSION_ID": garden["dataset_admission_id"],
        "SCORECARD_ID": scorecard["scorecard_id"],
        "UNPARSED_COUNT": "not_applicable_precomputed_predictions" if unparsed_count is None else str(unparsed_count),
    }
    rendered = template
    for key, value in values.items():
        rendered = rendered.replace("{{" + key + "}}", str(value))
    validate_model_card(rendered)
    return rendered


def _manifest_entries(root: Path) -> list[dict[str, Any]]:
    tree = inspect_regular_tree(root)
    _require(
        {path.relative_to(root).as_posix() for path in tree.directories}
        == {"evaluation", "training"},
        "release directory layout is not closed",
    )
    entries: list[dict[str, Any]] = []
    for path in tree.files:
        if path.relative_to(root).as_posix() == "hash-manifest.json":
            continue
        size, digest = sha256_file_hex(path)
        entries.append({"path": path.relative_to(root).as_posix(), "bytes": size, "sha256": digest})
    return sorted(entries, key=lambda entry: entry["path"])


def build_release(
    *,
    run_dir: Path,
    scorecard_path: Path,
    output_dir: Path,
    template_path: Path,
    notice_path: Path,
    license_path: Path,
) -> dict[str, Any]:
    receipt = read_json(run_dir / "run-receipt.json")
    evaluation_input = read_json(scorecard_path)
    _require(isinstance(receipt, Mapping) and isinstance(evaluation_input, Mapping), "release inputs must be JSON objects")
    validate_run_receipt(receipt)
    model_export = inspect_publishable_model_export(run_dir / "model-export")
    validate_publishable_model_load(model_export)
    validate_run_receipt(
        receipt,
        expected_model_export_id=model_export.model_export_id,
    )
    inference_evaluation: Mapping[str, Any] | None = None
    if evaluation_input.get("schema") == INFERENCE_EVALUATION_SCHEMA:
        inference_evaluation = evaluation_input
        embedded_input = evaluation_input.get("scorecard")
        _require(isinstance(embedded_input, Mapping), "inference evaluation lacks a scorecard")
        validate_scorecard(embedded_input)
        scorecard = validate_inference_evaluation(
            evaluation_input,
            expected_model_export_id=model_export.model_export_id,
        )
        validate_sanitized_json(inference_evaluation, "inference evaluation")
    else:
        scorecard = evaluation_input
    validate_scorecard(scorecard)
    ensure_empty_output(output_dir)
    for source in model_export.files:
        shutil.copyfile(source, output_dir / source.name)
    copied_model_export = inspect_publishable_model_export(output_dir)
    _require(
        copied_model_export.model_export_id == model_export.model_export_id,
        "copied model export differs from the validated input",
    )
    template = template_path.read_text(encoding="utf-8")
    (output_dir / "README.md").write_text(
        _render_card(
            template,
            receipt,
            scorecard,
            unparsed_count=None if inference_evaluation is None else int(inference_evaluation["unparsed_count"]),
        ),
        encoding="utf-8",
        newline="\n",
    )
    shutil.copyfile(license_path, output_dir / "LICENSE")
    shutil.copyfile(notice_path, output_dir / "NOTICE")
    write_canonical_json(output_dir / "training" / "manifest.json", receipt)
    write_canonical_json(output_dir / "evaluation" / "public-regression-vector.json", scorecard)
    if inference_evaluation is not None:
        write_canonical_json(output_dir / "evaluation" / "inference-receipt.json", inference_evaluation)
    entries = _manifest_entries(output_dir)
    payload = {"manifest_excludes_itself": True, "files": entries}
    manifest = {
        "schema": "agenttool-sanitized-model-release-manifest/0.1",
        "manifest_id": domain_separated_id("agenttool-sanitized-model-release-manifest/0.1", payload),
        **payload,
    }
    write_canonical_json(output_dir / "hash-manifest.json", manifest)
    verify_release(output_dir)
    return manifest


def verify_release(root: Path) -> dict[str, Any]:
    tree = inspect_regular_tree(root)
    _require(
        {path.relative_to(root).as_posix() for path in tree.directories}
        == {"evaluation", "training"},
        "release directory layout is not closed",
    )
    manifest = read_json(root / "hash-manifest.json")
    _require(isinstance(manifest, Mapping), "release hash manifest must be an object")
    _require(
        set(manifest) == {"schema", "manifest_id", "manifest_excludes_itself", "files"},
        "release hash manifest must contain the complete closed shape",
    )
    validate_sanitized_json(manifest, "release hash manifest")
    _require(manifest.get("schema") == "agenttool-sanitized-model-release-manifest/0.1", "release manifest schema mismatch")
    manifest_id = require_sha256_id(manifest.get("manifest_id"), "manifest_id")
    payload = {"manifest_excludes_itself": manifest.get("manifest_excludes_itself"), "files": manifest.get("files")}
    _require(payload["manifest_excludes_itself"] is True, "release manifest must exclude itself")
    _require(manifest_id == domain_separated_id("agenttool-sanitized-model-release-manifest/0.1", payload), "release manifest content ID mismatch")
    entries = manifest.get("files")
    _require(isinstance(entries, list) and entries, "release manifest files must be non-empty")
    expected_paths: list[str] = []
    for entry in entries:
        _require(isinstance(entry, Mapping) and set(entry) == {"path", "bytes", "sha256"}, "release hash entry has unexpected fields")
        relative = entry["path"]
        _require(isinstance(relative, str) and relative and not relative.startswith("/") and ".." not in Path(relative).parts, "unsafe release path")
        _require(
            isinstance(entry["bytes"], int)
            and not isinstance(entry["bytes"], bool)
            and entry["bytes"] >= 0,
            "release byte count is invalid",
        )
        _require(
            isinstance(entry["sha256"], str)
            and re.fullmatch(r"[0-9a-f]{64}", entry["sha256"]) is not None,
            "release digest is invalid",
        )
        path = root / relative
        _require(path.is_file() and not path.is_symlink(), "release file is missing")
        size, digest = sha256_file_hex(path)
        _require(entry["bytes"] == size and entry["sha256"] == digest, "release hash mismatch")
        expected_paths.append(relative)
    _require(expected_paths == sorted(expected_paths), "release entries must be sorted")
    actual_paths = sorted(
        path.relative_to(root).as_posix()
        for path in tree.files
        if path.relative_to(root).as_posix() != "hash-manifest.json"
    )
    _require(actual_paths == expected_paths, "release tree differs from its manifest")
    required_paths = {
        "README.md",
        "LICENSE",
        "NOTICE",
        "training/manifest.json",
        "evaluation/public-regression-vector.json",
    }
    optional_paths = {"evaluation/inference-receipt.json"}
    unexpected = [
        path
        for path in actual_paths
        if path not in required_paths | optional_paths
        and not (
            len(Path(path).parts) == 1
            and MODEL_EXPORT_FILE.fullmatch(path) is not None
        )
    ]
    _require(not unexpected, "release contains a non-allowlisted artifact")
    _require(required_paths.issubset(actual_paths), "release is missing required public metadata")
    model_export = inspect_publishable_model_export(
        root,
        permitted_non_model_entries=RELEASE_NON_MODEL_ENTRIES,
    )
    manifest_model_entries = {
        entry["path"]: (entry["bytes"], entry["sha256"])
        for entry in entries
        if len(Path(entry["path"]).parts) == 1
        and MODEL_EXPORT_FILE.fullmatch(entry["path"]) is not None
    }
    _require(
        manifest_model_entries
        == {
            entry["path"]: (entry["bytes"], entry["sha256"])
            for entry in model_export.inventory
        },
        "release manifest model entries differ from the inspected model snapshot",
    )
    receipt = read_json(root / "training" / "manifest.json")
    scorecard = read_json(root / "evaluation" / "public-regression-vector.json")
    _require(isinstance(receipt, Mapping) and isinstance(scorecard, Mapping), "release records must be objects")
    inference_path = root / "evaluation" / "inference-receipt.json"
    inference: Mapping[str, Any] | None = None
    if "evaluation/inference-receipt.json" in actual_paths:
        inference = read_json(inference_path)
        _require(isinstance(inference, Mapping), "inference receipt must be an object")

    legacy_compatibility = (
        inference is not None
        and manifest_id == LEGACY_PUBLISHED_RELEASE_MANIFEST_ID
        and inference.get("inference_evaluation_id")
        == LEGACY_PUBLISHED_INFERENCE_EVALUATION_ID
        and model_export.model_export_id == LEGACY_PUBLISHED_MODEL_EXPORT_ID
    )
    if legacy_compatibility:
        _validate_legacy_run_receipt(receipt)
    else:
        validate_run_receipt(
            receipt,
            expected_model_export_id=model_export.model_export_id,
        )
    if legacy_compatibility:
        _validate_legacy_scorecard(scorecard)
    else:
        validate_scorecard(scorecard)

    unparsed_count: int | None = None
    if inference is not None:
        if legacy_compatibility:
            embedded = _validate_legacy_inference_evaluation(inference)
            _validate_legacy_scorecard(embedded)
        else:
            embedded = validate_inference_evaluation(
                inference,
                expected_model_export_id=model_export.model_export_id,
            )
        _require(
            canonical_json(dict(embedded)) == canonical_json(dict(scorecard)),
            "inference receipt and released scorecard differ",
        )
        validate_sanitized_json(inference, "inference evaluation")
        unparsed_count = int(inference["unparsed_count"])

    actual_card_bytes = (root / "README.md").read_bytes()
    if legacy_compatibility:
        # The already-validated immutable manifest binds the exact legacy card
        # bytes. Do not make that frozen release depend on a mutable template.
        try:
            actual_card = actual_card_bytes.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise TrainingBundleError("model card is not valid UTF-8") from exc
        validate_model_card(actual_card)
    else:
        template_path, _, _ = default_bundle_paths()
        expected_card = _render_card(
            template_path.read_text(encoding="utf-8"),
            receipt,
            scorecard,
            unparsed_count=unparsed_count,
        )
        _require(
            actual_card_bytes == expected_card.encode("utf-8"),
            "model card does not equal the canonical card derived from release records",
        )
    validate_publishable_model_load(model_export)
    return dict(manifest)


def default_bundle_paths() -> tuple[Path, Path, Path]:
    bundle = Path(__file__).resolve().parents[2]
    return bundle / "MODEL_CARD.md.template", bundle / "NOTICE", bundle.parents[1] / "LICENSE"
