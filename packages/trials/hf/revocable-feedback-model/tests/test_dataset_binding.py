from __future__ import annotations

import hashlib
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from xenia_revocable_feedback_model import core as core_module
from xenia_revocable_feedback_model.core import (
    AUTHORIZATION_ID,
    DATASET_FILE_MAX_BYTES,
    DATASET_HASH_MANIFEST_ID,
    DATASET_REVISION,
    DATASET_TOTAL_MAX_BYTES,
    JSON_MAX_BYTES,
    RECIPE_ID,
    TRAINING_MANIFEST_ID,
    TrainingBundleError,
    load_and_validate_dataset,
    sha256_id,
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


def rewrite_manifest_claim(root: Path, relative: str, *, byte_count: object, digest: object) -> None:
    manifest_path = root / "hash-manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    entry = next(item for item in manifest["files"] if item["path"] == relative)
    entry["bytes"] = byte_count
    entry["sha256"] = digest
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, allow_nan=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
        newline="\n",
    )


class DatasetBindingTests(unittest.TestCase):
    def test_reviewed_tree_matches_revision_bound_manifest(self) -> None:
        self.assertEqual(verify_hash_manifest(DATASET_ROOT), DATASET_HASH_MANIFEST_ID)
        self.assertEqual(load_frozen_dataset(DATASET_ROOT).hash_manifest_id, DATASET_HASH_MANIFEST_ID)

    def test_manifest_and_listed_files_do_not_use_unbounded_path_reads(self) -> None:
        with mock.patch.object(
            Path,
            "read_bytes",
            side_effect=AssertionError("dataset hashing must use bounded streaming"),
        ):
            self.assertEqual(verify_hash_manifest(DATASET_ROOT), DATASET_HASH_MANIFEST_ID)

    def test_manifest_rejects_non_integer_and_negative_byte_counts(self) -> None:
        hostile_counts = (
            ("true aliases one", True, b"x"),
            ("false aliases zero", False, b""),
            ("float aliases one", 1.0, b"x"),
            ("negative", -1, b"x"),
            ("string", "1", b"x"),
            ("null", None, b"x"),
        )
        for name, byte_count, data in hostile_counts:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / "dataset"
                shutil.copytree(DATASET_ROOT, root)
                (root / TRAIN_DATA_PATH).write_bytes(data)
                rewrite_manifest_claim(
                    root,
                    TRAIN_DATA_PATH,
                    byte_count=byte_count,
                    digest=hashlib.sha256(data).hexdigest(),
                )
                with self.assertRaisesRegex(
                    TrainingBundleError,
                    "dataset byte count must be a non-negative integer",
                ), mock.patch.object(
                    core_module,
                    "sha256_file_hex",
                    wraps=core_module.sha256_file_hex,
                ) as hash_file:
                    verify_hash_manifest(root)
                hash_file.assert_not_called()

    def test_matching_attacker_declared_large_file_exceeds_independent_bound(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "dataset"
            shutil.copytree(DATASET_ROOT, root)
            data = b"x" * (8 * 1024 * 1024)
            (root / TRAIN_DATA_PATH).write_bytes(data)
            rewrite_manifest_claim(
                root,
                TRAIN_DATA_PATH,
                byte_count=len(data),
                digest=hashlib.sha256(data).hexdigest(),
            )
            with self.assertRaisesRegex(
                TrainingBundleError,
                "independent byte bound",
            ), mock.patch.object(
                core_module,
                "sha256_file_hex",
                wraps=core_module.sha256_file_hex,
            ) as hash_file:
                verify_hash_manifest(root)
            hash_file.assert_not_called()

    def test_declared_total_is_bounded_before_any_listed_file_hash(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "dataset"
            shutil.copytree(DATASET_ROOT, root)
            manifest_path = root / "hash-manifest.json"
            manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
            for entry in manifest["files"]:
                entry["bytes"] = DATASET_FILE_MAX_BYTES
                entry["sha256"] = "0" * 64
            self.assertGreater(
                sum(entry["bytes"] for entry in manifest["files"]),
                DATASET_TOTAL_MAX_BYTES,
            )
            manifest_path.write_text(
                json.dumps(manifest, ensure_ascii=False, allow_nan=False, indent=2, sort_keys=True) + "\n",
                encoding="utf-8",
                newline="\n",
            )
            with self.assertRaisesRegex(
                TrainingBundleError,
                "independent total byte bound",
            ), mock.patch.object(
                core_module,
                "sha256_file_hex",
                wraps=core_module.sha256_file_hex,
            ) as hash_file:
                verify_hash_manifest(root)
            hash_file.assert_not_called()

    def test_manifest_rejects_malformed_digest_claims_before_hashing(self) -> None:
        for name, digest in (
            ("uppercase", "A" * 64),
            ("short", "0" * 63),
            ("boolean", False),
            ("null", None),
        ):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / "dataset"
                shutil.copytree(DATASET_ROOT, root)
                rewrite_manifest_claim(
                    root,
                    TRAIN_DATA_PATH,
                    byte_count=(root / TRAIN_DATA_PATH).stat().st_size,
                    digest=digest,
                )
                with self.assertRaisesRegex(
                    TrainingBundleError,
                    "dataset digest must be a lowercase SHA-256 hex value",
                ), mock.patch.object(
                    core_module,
                    "sha256_file_hex",
                    wraps=core_module.sha256_file_hex,
                ) as hash_file:
                    verify_hash_manifest(root)
                hash_file.assert_not_called()

    def test_manifest_rejects_noncanonical_duplicate_and_self_paths_before_hashing(self) -> None:
        def duplicate(manifest: dict[str, object]) -> None:
            files = manifest["files"]
            assert isinstance(files, list) and isinstance(files[0], dict)
            files.insert(1, dict(files[0]))

        def unsorted(manifest: dict[str, object]) -> None:
            files = manifest["files"]
            assert isinstance(files, list)
            files.reverse()

        def replace_first_path(manifest: dict[str, object], value: str) -> None:
            files = manifest["files"]
            assert isinstance(files, list) and isinstance(files[0], dict)
            files[0]["path"] = value

        mutations = {
            "duplicate": duplicate,
            "unsorted": unsorted,
            "self": lambda manifest: replace_first_path(manifest, "hash-manifest.json"),
            "nested self": lambda manifest: replace_first_path(manifest, "nested/hash-manifest.json"),
            "noncanonical": lambda manifest: replace_first_path(manifest, "data/../LICENSE"),
            "windows separator escape": lambda manifest: replace_first_path(manifest, "..\\outside"),
            "windows drive absolute": lambda manifest: replace_first_path(manifest, "C:/outside"),
            "windows drive relative": lambda manifest: replace_first_path(manifest, "C:outside"),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary) / "dataset"
                shutil.copytree(DATASET_ROOT, root)
                manifest_path = root / "hash-manifest.json"
                manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
                mutate(manifest)
                manifest_path.write_text(
                    json.dumps(manifest, ensure_ascii=False, allow_nan=False, indent=2, sort_keys=True) + "\n",
                    encoding="utf-8",
                    newline="\n",
                )
                with self.assertRaises(TrainingBundleError), mock.patch.object(
                    core_module,
                    "sha256_file_hex",
                    wraps=core_module.sha256_file_hex,
                ) as hash_file:
                    verify_hash_manifest(root)
                hash_file.assert_not_called()

    def test_manifest_id_uses_the_same_bounded_bytes_that_were_decoded(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "dataset"
            shutil.copytree(DATASET_ROOT, root)
            manifest_path = root / "hash-manifest.json"
            original_manifest = manifest_path.read_bytes()
            (root / TRAIN_DATA_PATH).write_bytes(b"x")
            rewrite_manifest_entry(root, TRAIN_DATA_PATH)
            malicious_manifest = manifest_path.read_bytes()
            expected_id = sha256_id(malicious_manifest)
            real_decode = core_module._decode_json

            def swap_after_decode(data: bytes, *, header: bool = False):
                value = real_decode(data, header=header)
                manifest_path.write_bytes(original_manifest)
                return value

            with mock.patch.object(
                core_module,
                "_decode_json",
                side_effect=swap_after_decode,
            ):
                actual_id = verify_hash_manifest(root)
            self.assertEqual(actual_id, expected_id)
            self.assertNotEqual(actual_id, DATASET_HASH_MANIFEST_ID)

    def test_loader_consumes_the_same_bytes_verified_before_post_hash_mutation(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "dataset"
            shutil.copytree(DATASET_ROOT, root)
            train_path = root / TRAIN_DATA_PATH
            verified_train_path = train_path.resolve()
            injected_text = " [post-hash injected text]"
            real_hash = core_module.sha256_file_hex
            mutated = False

            def hash_then_mutate(
                path: Path,
                *,
                max_bytes: int | None = None,
                snapshot: bytearray | None = None,
            ) -> tuple[int, str]:
                nonlocal mutated
                result = real_hash(path, max_bytes=max_bytes, snapshot=snapshot)
                if path == verified_train_path and not mutated:
                    rows = [
                        json.loads(line)
                        for line in train_path.read_text(encoding="utf-8").splitlines()
                    ]
                    rows[0]["prompt"][1]["content"] += injected_text
                    train_path.write_text(
                        "".join(
                            json.dumps(
                                row,
                                ensure_ascii=False,
                                allow_nan=False,
                                separators=(",", ":"),
                                sort_keys=True,
                            )
                            + "\n"
                            for row in rows
                        ),
                        encoding="utf-8",
                        newline="\n",
                    )
                    mutated = True
                return result

            with mock.patch.object(
                core_module,
                "sha256_file_hex",
                side_effect=hash_then_mutate,
            ), mock.patch.object(
                core_module,
                "read_json",
                side_effect=AssertionError("loader must consume the verified snapshot"),
            ), mock.patch.object(
                core_module,
                "read_jsonl",
                side_effect=AssertionError("loader must consume the verified snapshot"),
            ):
                bundle = load_frozen_dataset(root)

            self.assertTrue(mutated)
            self.assertEqual(bundle.hash_manifest_id, DATASET_HASH_MANIFEST_ID)
            self.assertNotIn(injected_text, json.dumps(bundle.train_rows))
            self.assertIn(injected_text, train_path.read_text(encoding="utf-8"))

    def test_manifest_bytes_are_bounded_before_decode(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "dataset"
            shutil.copytree(DATASET_ROOT, root)
            (root / "hash-manifest.json").write_bytes(b" " * (JSON_MAX_BYTES + 1))
            with self.assertRaisesRegex(
                TrainingBundleError,
                "dataset hash manifest exceeds its byte bound",
            ), mock.patch.object(core_module, "_decode_json") as decode:
                verify_hash_manifest(root)
            decode.assert_not_called()

    def test_sparse_file_over_its_declared_bound_is_rejected_before_reading(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "dataset"
            shutil.copytree(DATASET_ROOT, root)
            with (root / TRAIN_DATA_PATH).open("r+b") as handle:
                handle.truncate(4 * 1024 * 1024 * 1024)
            with self.assertRaisesRegex(
                TrainingBundleError,
                "regular file exceeds its hash byte bound",
            ):
                verify_hash_manifest(root)

    def test_dataset_tree_rejects_symlinks_and_special_nodes(self) -> None:
        with self.subTest(name="root symlink"), tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "dataset"
            root.symlink_to(DATASET_ROOT, target_is_directory=True)
            with self.assertRaisesRegex(TrainingBundleError, "tree root is not a regular directory"):
                verify_hash_manifest(root)

        with self.subTest(name="file symlink"), tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "dataset"
            shutil.copytree(DATASET_ROOT, root)
            target = root / TRAIN_DATA_PATH
            target.unlink()
            target.symlink_to(root / "LICENSE")
            with self.assertRaisesRegex(TrainingBundleError, "tree contains a symlink"):
                verify_hash_manifest(root)

        with self.subTest(name="directory symlink"), tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "dataset"
            shutil.copytree(DATASET_ROOT, root)
            shutil.rmtree(root / "data")
            (root / "data").symlink_to(DATASET_ROOT / "data", target_is_directory=True)
            with self.assertRaisesRegex(TrainingBundleError, "tree contains a symlink"):
                verify_hash_manifest(root)

        with self.subTest(name="fifo"), tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary) / "dataset"
            shutil.copytree(DATASET_ROOT, root)
            os.mkfifo(root / "hostile.fifo")
            with self.assertRaisesRegex(TrainingBundleError, "tree contains a non-regular node"):
                verify_hash_manifest(root)

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
