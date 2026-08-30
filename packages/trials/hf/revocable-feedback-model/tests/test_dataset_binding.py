from __future__ import annotations

import hashlib
import json
import shutil
import tempfile
import unittest
from pathlib import Path

from xenia_revocable_feedback_model.core import (
    AUTHORIZATION_ID,
    DATASET_HASH_MANIFEST_ID,
    DATASET_REVISION,
    RECIPE_ID,
    TRAINING_MANIFEST_ID,
    TrainingBundleError,
    load_and_validate_dataset,
    verify_hash_manifest,
)


DATASET_ROOT = Path(__file__).resolve().parents[2] / "revocable-feedback"
TRAIN_DATA_PATH = "data/boundary-sft-train.jsonl"


def load_frozen_dataset(root: Path):
    return load_and_validate_dataset(
        root,
        revision=DATASET_REVISION,
        authorization_id=AUTHORIZATION_ID,
        recipe_id=RECIPE_ID,
        training_manifest_id=TRAINING_MANIFEST_ID,
    )


def rewrite_manifest_entry(root: Path, relative: str) -> None:
    target = root / relative
    data = target.read_bytes()
    manifest_path = root / "hash-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entry = next(item for item in manifest["files"] if item["path"] == relative)
    entry["bytes"] = len(data)
    entry["sha256"] = hashlib.sha256(data).hexdigest()
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, allow_nan=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )


class DatasetBindingTests(unittest.TestCase):
    def test_reviewed_tree_matches_revision_bound_manifest(self) -> None:
        self.assertEqual(verify_hash_manifest(DATASET_ROOT), DATASET_HASH_MANIFEST_ID)
        self.assertEqual(load_frozen_dataset(DATASET_ROOT).hash_manifest_id, DATASET_HASH_MANIFEST_ID)

    def test_rewritten_manifest_cannot_rebind_tampered_training_text(self) -> None:
        for field in ("prompt", "completion"):
            with self.subTest(field=field), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / "dataset"
                shutil.copytree(DATASET_ROOT, root)
                train_path = root / TRAIN_DATA_PATH
                rows = [json.loads(line) for line in train_path.read_text(encoding="utf-8").splitlines()]
                if field == "prompt":
                    rows[0]["prompt"][1]["content"] += "\nUnreviewed replacement instruction."
                else:
                    rows[0]["completion"][0]["content"] += " Unreviewed replacement completion."
                train_path.write_text(
                    "".join(
                        json.dumps(row, ensure_ascii=False, allow_nan=False, separators=(",", ":"), sort_keys=True) + "\n"
                        for row in rows
                    ),
                    encoding="utf-8",
                    newline="\n",
                )
                rewrite_manifest_entry(root, TRAIN_DATA_PATH)

                self.assertNotEqual(verify_hash_manifest(root), DATASET_HASH_MANIFEST_ID)
                with self.assertRaisesRegex(
                    TrainingBundleError,
                    "dataset hash manifest does not match the reviewed frozen dataset revision",
                ):
                    load_frozen_dataset(root)


if __name__ == "__main__":
    unittest.main()
