#!/usr/bin/env python3
"""Dependency-free verifier for the static AgentTool economic dataset."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
HASH_MANIFEST = ROOT / "hash-manifest.json"
ALLOWED_PROVIDER_EXTRAS = {".gitattributes"}


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read_jsonl(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    if not text.endswith("\n"):
        raise SystemExit(f"{path.relative_to(ROOT)} must end in one newline")
    return [json.loads(line) for line in text.splitlines()]


def main() -> None:
    manifest = json.loads(HASH_MANIFEST.read_text(encoding="utf-8"))
    if manifest.get("_format") != "agenttool.economic-kernel-hf-hash-manifest/0.1":
        raise SystemExit("unexpected hash-manifest format")
    declared = {item["path"]: item for item in manifest["files"]}
    actual = set()
    for path in ROOT.rglob("*"):
        if path.is_symlink():
            raise SystemExit(f"symlink is not allowed: {path.relative_to(ROOT)}")
        if path.is_file():
            name = path.relative_to(ROOT).as_posix()
            if name != "hash-manifest.json" and name not in ALLOWED_PROVIDER_EXTRAS:
                actual.add(name)
    if actual != set(declared):
        raise SystemExit("file inventory differs from hash-manifest")
    for name, item in declared.items():
        path = ROOT / name
        if path.stat().st_size != item["bytes"] or sha256(path) != item["sha256"]:
            raise SystemExit(f"byte identity mismatch: {name}")
    training = read_jsonl(ROOT / "data" / "training-lessons.jsonl")
    reference = read_jsonl(ROOT / "data" / "conformance-reference.jsonl")
    if len(training) != 24 or any(row.get('training_authorized') is not True for row in training):
        raise SystemExit("training admission split is invalid")
    if len(reference) != 34 or any(row.get('training_authorized') is not False for row in reference):
        raise SystemExit("conformance holdout split is invalid")
    if set(row['row_id'] for row in training) & set(row['row_id'] for row in reference):
        raise SystemExit("train/reference row identities overlap")
    print(json.dumps({
        "verified": True,
        "owned_files": len(declared) + 1,
        "training_rows": len(training),
        "reference_rows": len(reference),
        "provider_extras_ignored": sorted(ALLOWED_PROVIDER_EXTRAS & {
            path.relative_to(ROOT).as_posix() for path in ROOT.rglob("*") if path.is_file()
        }),
    }, sort_keys=True))


if __name__ == "__main__":
    main()
