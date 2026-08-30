from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any, Iterable, Mapping

from .evaluate import INFERENCE_EVALUATION_SCHEMA, validate_inference_evaluation

from .core import (
    BASE_MODEL_ID,
    BASE_MODEL_REVISION,
    DATASET_ID,
    DISCLOSURE,
    GOVERNANCE_STATUS,
    SCORECARD_SCHEMA,
    TrainingBundleError,
    _require,
    domain_separated_id,
    ensure_empty_output,
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
    _require(receipt.get("schema") == "agenttool-revocable-feedback-local-run/0.1", "unexpected run receipt schema")
    _require(receipt.get("governance_status") == GOVERNANCE_STATUS, "run governance status mismatch")
    _require(receipt.get("disclosure") == DISCLOSURE, "run disclosure mismatch")
    _require(receipt.get("observed_optimizer_steps") == 8, "release requires exactly eight observed optimizer steps")
    _require(receipt.get("publishes") is False, "run receipt must record no publication")
    garden = receipt.get("garden")
    _require(isinstance(garden, Mapping), "run receipt Garden boundary is absent")
    require_sha256_id(garden.get("dataset_admission_id"), "dataset_admission_id")
    _require(garden.get("dataset_admission_effect") == "data_candidate_only", "dataset admission effect mismatch")
    _require(garden.get("training_governance_decision_id") is None, "Garden training governance must be absent")
    _require(garden.get("host_one_use_optimizer_permit_id") is None, "Host optimizer permit must be absent")
    _require(garden.get("training_substrate_report") == "not_independently_available", "substrate availability mismatch")
    base = receipt.get("base")
    _require(base == {"model_id": BASE_MODEL_ID, "revision": BASE_MODEL_REVISION}, "run base binding mismatch")
    dataset = receipt.get("dataset")
    _require(isinstance(dataset, Mapping) and dataset.get("id") == DATASET_ID, "run dataset binding mismatch")
    for key in ("authorization_id", "recipe_id", "training_manifest_id", "hash_manifest_id"):
        require_sha256_id(dataset.get(key), key)
    _validate_sanitized_json(receipt, "run receipt")


def validate_scorecard(scorecard: Mapping[str, Any]) -> None:
    _require(scorecard.get("schema") == SCORECARD_SCHEMA, "unexpected scorecard schema")
    scorecard_id = require_sha256_id(scorecard.get("scorecard_id"), "scorecard_id")
    payload = {key: value for key, value in scorecard.items() if key not in {"schema", "scorecard_id"}}
    _require(scorecard_id == domain_separated_id(SCORECARD_SCHEMA, payload), "scorecard content ID mismatch")
    _require(scorecard.get("case_count") == 8 and scorecard.get("pair_count") == 4, "release requires the eight-case public regression")
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
