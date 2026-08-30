from __future__ import annotations

import json
import re
import shutil
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Iterable, Mapping

from .evaluate import (
    INFERENCE_EVALUATION_SCHEMA,
    evaluate_predictions,
    validate_inference_evaluation,
)

from .core import (
    AUTHORIZATION_ID,
    BASE_MODEL_ID,
    BASE_MODEL_REVISION,
    DATASET_HASH_MANIFEST_ID,
    DATASET_ID,
    DATASET_REVISION,
    DISCLOSURE,
    EXPECTED_RUNTIME_VERSIONS,
    GOVERNANCE_STATUS,
    RECIPE_ID,
    SCORECARD_SCHEMA,
    TRAINING_MANIFEST_ID,
    TrainingBundleError,
    _require,
    domain_separated_id,
    ensure_empty_output,
    fixed_training_plan,
    read_json,
    require_sha256_id,
    sha256_hex,
    write_canonical_json,
)

SAFE_MODEL_FILE = re.compile(
    r"^(?:config|generation_config|tokenizer_config|special_tokens_map|added_tokens)\.json$"
    r"|^(?:tokenizer\.json|tokenizer\.model|vocab\.json|merges\.txt)$"
    r"|^model(?:-[0-9]{5}-of-[0-9]{5})?\.safetensors$"
    r"|^model\.safetensors\.index\.json$"
)
FORBIDDEN_NAME_PARTS = (
    "optimizer",
    "scheduler",
    "trainer_state",
    "training_args",
    "rng_state",
    "checkpoint",
    "ledger",
    "transcript",
    "trace",
)
FORBIDDEN_SUFFIXES = (".bin", ".pt", ".pth", ".pkl", ".pickle", ".db", ".sqlite", ".sqlite3")
FORBIDDEN_KEYS = {
    "access_token",
    "api_key",
    "authorization_header",
    "credential",
    "credentials",
    "prompt",
    "prompts",
    "raw_choice",
    "raw_choices",
    "raw_generation",
    "raw_generations",
    "trace",
    "traces",
}
TEXT_SECRET_PATTERNS = (
    re.compile(r"/Users/"),
    re.compile(r"[A-Za-z]:\\Users\\"),
    re.compile(r"\bhf_[A-Za-z0-9]{20,}\b"),
    re.compile(r"\bBearer\s+[A-Za-z0-9._~+/-]{12,}\b", re.IGNORECASE),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
)

RUN_RECEIPT_SCHEMA = "agenttool-revocable-feedback-local-run/0.1"
EXPECTED_DATASET_ADMISSION_ID = "sha256:125ae2f84d7cdf58242bc039db67753b5825c4d61e35dd13eda7a58f299295f2"
RUN_RECEIPT_KEYS = {
    "schema",
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
EXPECTED_RUN_RUNTIME = {"python": "3.12.12", **EXPECTED_RUNTIME_VERSIONS}

SCORECARD_KEYS = {
    "schema",
    "scorecard_id",
    "benchmark_digest",
    "prediction_digest",
    "case_count",
    "pair_count",
    "metric_vector",
    "case_results",
    "statement",
}

# This is the exact scorer-relevant projection of the eight public-regression
# rows at DATASET_REVISION. Keeping the projection with the release validator
# makes an installed builder fail closed without consulting a mutable dataset
# path or trusting expected decisions supplied inside a scorecard.
_PINNED_PUBLIC_REGRESSION_CASES: tuple[Mapping[str, Any], ...] = (
    {
        "record_id": "sha256:6d6bbd96a47328b87fab2cb18724a8e124c30c40a1d58516d50dca80821b4658",
        "pair_id": "rf.pair.13",
        "family": "withheld_is_first_class",
        "variant": "a",
        "expected": {"decision": "hold", "violated_invariants": ["affected_party_basis"]},
    },
    {
        "record_id": "sha256:7ad01527d887e3df93098147fc02aa525bd0ce6ff0f618b3f9d6adee3563e0e0",
        "pair_id": "rf.pair.13",
        "family": "withheld_is_first_class",
        "variant": "b",
        "expected": {"decision": "query", "violated_invariants": ["affected_party_basis"]},
    },
    {
        "record_id": "sha256:ee61d4488f740e6d002f948ba8004abe49bf30824a49deec13ed92c2328dbe44",
        "pair_id": "rf.pair.14",
        "family": "plural_feedback",
        "variant": "a",
        "expected": {"decision": "admit", "violated_invariants": []},
    },
    {
        "record_id": "sha256:07d67e857eaecf6f40b90888038b8f0d2341adfc0dd514171ddb6a0b850f36a1",
        "pair_id": "rf.pair.14",
        "family": "plural_feedback",
        "variant": "b",
        "expected": {"decision": "hold", "violated_invariants": []},
    },
    {
        "record_id": "sha256:65dc832ae42d9e48646ad92656f64db62fd588990ffc98523d47d3b7edc2f3e4",
        "pair_id": "rf.pair.15",
        "family": "permission_expiry",
        "variant": "a",
        "expected": {"decision": "admit", "violated_invariants": []},
    },
    {
        "record_id": "sha256:07b98055016493df55dcf45ac69386b075388951153925bb10bf859dc2663529",
        "pair_id": "rf.pair.15",
        "family": "permission_expiry",
        "variant": "b",
        "expected": {"decision": "refuse", "violated_invariants": ["permission"]},
    },
    {
        "record_id": "sha256:5635e87bc9e31a2219bf2a58385111b3e64cfbca0541856162542ce6507b3040",
        "pair_id": "rf.pair.16",
        "family": "data_use_separation",
        "variant": "a",
        "expected": {"decision": "admit", "violated_invariants": []},
    },
    {
        "record_id": "sha256:daf37851fc68895aaf9e2296ad868e9913526f7e8c55b77d128deb872659e010",
        "pair_id": "rf.pair.16",
        "family": "data_use_separation",
        "variant": "b",
        "expected": {"decision": "refuse", "violated_invariants": ["data_use_separation"]},
    },
)


def _walk_values(value: Any) -> Iterable[tuple[str | None, Any]]:
    if isinstance(value, Mapping):
        for key, nested in value.items():
            yield str(key), nested
            yield from _walk_values(nested)
    elif isinstance(value, list):
        for nested in value:
            yield None, nested
            yield from _walk_values(nested)


def _validate_sanitized_json(value: Any, name: str) -> None:
    for key, nested in _walk_values(value):
        if key is not None:
            _require(key.lower() not in FORBIDDEN_KEYS, f"{name} contains forbidden private field: {key}")
        if isinstance(nested, str):
            for pattern in TEXT_SECRET_PATTERNS:
                _require(pattern.search(nested) is None, f"{name} contains a credential or local-path pattern")


def validate_run_receipt(receipt: Mapping[str, Any]) -> None:
    _require(receipt.get("schema") == RUN_RECEIPT_SCHEMA, "unexpected run receipt schema")
    _require(set(receipt) == RUN_RECEIPT_KEYS, "run receipt must contain the complete closed release shape")
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
    _validate_sanitized_json(receipt, "run receipt")


def validate_scorecard(scorecard: Mapping[str, Any]) -> None:
    _require(scorecard.get("schema") == SCORECARD_SCHEMA, "unexpected scorecard schema")
    _require(set(scorecard) == SCORECARD_KEYS, "scorecard must contain the complete closed release shape")
    require_sha256_id(scorecard.get("scorecard_id"), "scorecard_id")
    results = scorecard.get("case_results")
    _require(isinstance(results, list), "scorecard case_results must be an array")
    predictions: list[dict[str, Any]] = []
    for index, result in enumerate(results):
        _require(isinstance(result, Mapping), f"scorecard case result {index} must be an object")
        predictions.append(
            {
                "record_id": result.get("record_id"),
                "decision": result.get("predicted_decision"),
            }
        )
    expected = evaluate_predictions(_PINNED_PUBLIC_REGRESSION_CASES, predictions)
    _require(
        dict(scorecard) == expected,
        "scorecard does not equal the score recomputed from the pinned public regression",
    )
    _validate_sanitized_json(scorecard, "scorecard")


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
    for pattern in TEXT_SECRET_PATTERNS:
        _require(pattern.search(card) is None, "model card contains a credential or local-path pattern")


def _safe_model_sources(model_dir: Path, *, release_root: bool = False) -> list[Path]:
    _require(model_dir.is_dir() and not model_dir.is_symlink(), "model export is not a regular directory")
    files = sorted(path for path in model_dir.iterdir() if path.is_file() and not path.is_symlink())
    if release_root:
        metadata = {"README.md", "LICENSE", "NOTICE", "hash-manifest.json"}
        unknown = [path.name for path in files if path.name not in metadata and SAFE_MODEL_FILE.fullmatch(path.name) is None]
        _require(not unknown, f"release root contains a non-allowlisted file: {unknown[0] if unknown else ''}")
        files = [path for path in files if path.name not in metadata]
    _require(files, "model export is empty")
    for path in files:
        lowered = path.name.lower()
        _require(not any(part in lowered for part in FORBIDDEN_NAME_PARTS), f"private training file refused: {path.name}")
        _require(not lowered.endswith(FORBIDDEN_SUFFIXES), f"unsafe serialized file refused: {path.name}")
        _require(SAFE_MODEL_FILE.fullmatch(path.name) is not None, f"model export file is not allowlisted: {path.name}")
    _require(any(path.name.endswith(".safetensors") for path in files), "model export lacks safetensors weights")
    _require(any(path.name == "config.json" for path in files), "model export lacks config.json")
    return files


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
    entries: list[dict[str, Any]] = []
    for path in sorted(item for item in root.rglob("*") if item.is_file() and item.name != "hash-manifest.json"):
        _require(not path.is_symlink(), "release contains a symlink")
        data = path.read_bytes()
        entries.append({"path": path.relative_to(root).as_posix(), "bytes": len(data), "sha256": sha256_hex(data)})
    return entries


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
    inference_evaluation: Mapping[str, Any] | None = None
    if evaluation_input.get("schema") == INFERENCE_EVALUATION_SCHEMA:
        inference_evaluation = evaluation_input
        embedded_input = evaluation_input.get("scorecard")
        _require(isinstance(embedded_input, Mapping), "inference evaluation lacks a scorecard")
        validate_scorecard(embedded_input)
        scorecard = validate_inference_evaluation(evaluation_input)
        _validate_sanitized_json(inference_evaluation, "inference evaluation")
    else:
        scorecard = evaluation_input
    validate_scorecard(scorecard)
    model_sources = _safe_model_sources(run_dir / "model-export")
    ensure_empty_output(output_dir)
    for source in model_sources:
        shutil.copyfile(source, output_dir / source.name)
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
    _require(root.is_dir() and not root.is_symlink(), "release root is not a regular directory")
    manifest = read_json(root / "hash-manifest.json")
    _require(isinstance(manifest, Mapping), "release hash manifest must be an object")
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
        path = root / relative
        _require(path.is_file() and not path.is_symlink(), f"release file is missing: {relative}")
        data = path.read_bytes()
        _require(entry["bytes"] == len(data) and entry["sha256"] == sha256_hex(data), f"release hash mismatch: {relative}")
        expected_paths.append(relative)
    _require(expected_paths == sorted(expected_paths), "release entries must be sorted")
    actual_paths = sorted(path.relative_to(root).as_posix() for path in root.rglob("*") if path.is_file() and path.name != "hash-manifest.json")
    _require(actual_paths == expected_paths, "release tree differs from its manifest")
    required_paths = {
        "README.md",
        "LICENSE",
        "NOTICE",
        "training/manifest.json",
        "evaluation/public-regression-vector.json",
    }
    optional_paths = {"evaluation/inference-receipt.json"}
    unexpected = [path for path in actual_paths if path not in required_paths | optional_paths and SAFE_MODEL_FILE.fullmatch(Path(path).name) is None]
    _require(not unexpected, f"release contains a non-allowlisted artifact: {unexpected[0] if unexpected else ''}")
    _require(required_paths.issubset(actual_paths), "release is missing required public metadata")
    _safe_model_sources(root, release_root=True)
    validate_model_card((root / "README.md").read_text(encoding="utf-8"))
    receipt = read_json(root / "training" / "manifest.json")
    scorecard = read_json(root / "evaluation" / "public-regression-vector.json")
    _require(isinstance(receipt, Mapping) and isinstance(scorecard, Mapping), "release records must be objects")
    validate_run_receipt(receipt)
    validate_scorecard(scorecard)
    inference_path = root / "evaluation" / "inference-receipt.json"
    if inference_path.exists():
        inference = read_json(inference_path)
        _require(isinstance(inference, Mapping), "inference receipt must be an object")
        embedded = validate_inference_evaluation(inference)
        _require(dict(embedded) == dict(scorecard), "inference receipt and released scorecard differ")
        _validate_sanitized_json(inference, "inference evaluation")
    return dict(manifest)


def default_bundle_paths() -> tuple[Path, Path, Path]:
    bundle = Path(__file__).resolve().parents[2]
    return bundle / "MODEL_CARD.md.template", bundle / "NOTICE", bundle.parents[1] / "LICENSE"
