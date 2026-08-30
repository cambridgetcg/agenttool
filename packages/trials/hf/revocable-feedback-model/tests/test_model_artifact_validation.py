from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_bundle import minimal_safetensors_bytes, write_minimal_model_export
from xenia_revocable_feedback_model.core import (
    MODEL_EXPORT_MAX_BYTES,
    REGULAR_TREE_MAX_DEPTH,
    TrainingBundleError,
    inspect_model_export,
    inspect_regular_tree,
    write_canonical_json,
)


def encoded_safetensors(header_text: str, payload: bytes = b"") -> bytes:
    header = header_text.encode("utf-8")
    header += b" " * (-len(header) % 8)
    return len(header).to_bytes(8, "little") + header + payload


class ModelArtifactValidationTests(unittest.TestCase):
    def test_digest_covers_the_complete_sorted_allowlist(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            model = Path(temporary) / "model"
            first = write_minimal_model_export(model)
            write_canonical_json(model / "generation_config.json", {"max_new_tokens": 32})
            second = inspect_model_export(model)
            self.assertNotEqual(first, second.model_export_id)
            self.assertEqual(
                [entry["path"] for entry in second.inventory],
                ["config.json", "generation_config.json", "model.safetensors"],
            )

    def test_model_json_rejects_private_fields_text_and_duplicate_keys(self) -> None:
        fake_hf = "hf_" + "a" * 24
        hostile_documents = {
            "credential field": f'{{"api_key":"{fake_hf}"}}\n',
            "local path": '{"_name_or_path":"/Users/private/model"}\n',
            "lowercase macOS path": '{"source":"/users/private/model"}\n',
            "mixed-case Unix path": '{"source":"/PrIvAtE/private/model"}\n',
            "lowercase Windows path": json.dumps(
                {"source": r"c:\users\private\model"}
            )
            + "\n",
            "prompt field": '{"prompt":"not for publication"}\n',
            "composite prompt field": '{"training_prompt_text":"not for publication"}\n',
            "credential as key": f'{{"{fake_hf}":0}}\n',
            "discarded duplicate": f'{{"api_key":"{fake_hf}","api_key":"safe"}}\n',
            "overflowing number": '{"safe":1e999}\n',
            "oversized integer": '{"safe":' + "9" * 5000 + '}\n',
        }
        for name, document in hostile_documents.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                model = Path(temporary) / "model"
                write_minimal_model_export(model)
                (model / "config.json").write_text(document, encoding="utf-8")
                with self.assertRaises(TrainingBundleError):
                    inspect_model_export(model)

    def test_large_tokenizer_json_uses_a_separate_bounded_parser(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            model = Path(temporary) / "model"
            write_minimal_model_export(model)
            write_canonical_json(model / "tokenizer.json", {"safe_blob": "x" * (3 * 1024 * 1024)})
            self.assertGreater((model / "tokenizer.json").stat().st_size, 2 * 1024 * 1024)
            self.assertTrue(inspect_model_export(model).model_export_id.startswith("sha256:"))

    def test_sparse_export_over_the_total_bound_is_rejected_before_hashing(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            model = Path(temporary) / "model"
            write_minimal_model_export(model)
            with (model / "model.safetensors").open("wb") as handle:
                handle.seek(MODEL_EXPORT_MAX_BYTES)
                handle.write(b"x")
            with self.assertRaises(TrainingBundleError):
                inspect_model_export(model)

    def test_unparsed_raw_tokenizer_formats_are_not_publishable(self) -> None:
        fake_hf = "hf_" + "a" * 24
        for name in ("tokenizer.model", "merges.txt"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                model = Path(temporary) / "model"
                write_minimal_model_export(model)
                (model / name).write_text(
                    f"private prompt /Users/private/model {fake_hf}\n",
                    encoding="utf-8",
                )
                with self.assertRaises(TrainingBundleError):
                    inspect_model_export(model)

    def test_safetensors_rejects_non_format_bytes_and_private_metadata(self) -> None:
        fake_hf = "hf_" + "a" * 24
        hostile_weights = {
            "placeholder": b"weights",
            "prompt metadata": minimal_safetensors_bytes(metadata={"prompt": "private"}),
            "local path metadata": minimal_safetensors_bytes(metadata={"origin": "/Users/private/model"}),
            "extra metadata": minimal_safetensors_bytes(metadata={"format": "pt", "notes": "private"}),
            "credential metadata key": minimal_safetensors_bytes(metadata={fake_hf: "value"}),
            "duplicate metadata": encoded_safetensors(
                '{"__metadata__":{"prompt":"private","prompt":"safe"},'
                '"weight":{"dtype":"F32","shape":[1],"data_offsets":[0,4]}}',
                b"\x00\x00\x00\x00",
            ),
            "wrong extent": encoded_safetensors(
                '{"weight":{"dtype":"F32","shape":[1],"data_offsets":[0,0]}}'
            ),
            "gap": encoded_safetensors(
                '{"weight":{"dtype":"F32","shape":[1],"data_offsets":[4,8]}}',
                b"\x00" * 8,
            ),
            "unknown dtype": encoded_safetensors(
                '{"weight":{"dtype":"I4","shape":[2],"data_offsets":[0,1]}}',
                b"\x00",
            ),
            "no tensor": encoded_safetensors('{"__metadata__":{"format":"pt"}}'),
            "null metadata": encoded_safetensors(
                '{"__metadata__":null,"weight":{"dtype":"F32","shape":[1],"data_offsets":[0,4]}}',
                b"\x00" * 4,
            ),
            "oversized declared header": (17 * 1024 * 1024).to_bytes(8, "little"),
        }
        for name, data in hostile_weights.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                model = Path(temporary) / "model"
                write_minimal_model_export(model)
                (model / "model.safetensors").write_bytes(data)
                with self.assertRaises(TrainingBundleError):
                    inspect_model_export(model)

    def test_exact_sharded_layout_is_accepted_and_unused_shards_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            model = Path(temporary) / "model"
            model.mkdir()
            write_canonical_json(model / "config.json", {"model_type": "fixture"})
            first = "model-00001-of-00002.safetensors"
            second = "model-00002-of-00002.safetensors"
            (model / first).write_bytes(minimal_safetensors_bytes(tensor_name="left"))
            (model / second).write_bytes(minimal_safetensors_bytes(tensor_name="right"))
            write_canonical_json(
                model / "model.safetensors.index.json",
                {
                    "metadata": {"total_size": 8},
                    "weight_map": {"left": first, "right": second},
                },
            )
            inspect_model_export(model)
            write_canonical_json(
                model / "model.safetensors.index.json",
                {
                    "metadata": {"total_size": 8, "notes": "private"},
                    "weight_map": {"left": first, "right": second},
                },
            )
            with self.assertRaises(TrainingBundleError):
                inspect_model_export(model)
            write_canonical_json(
                model / "model.safetensors.index.json",
                {"metadata": {"total_size": 4}, "weight_map": {"left": first}},
            )
            with self.assertRaises(TrainingBundleError):
                inspect_model_export(model)

            write_canonical_json(
                model / "model.safetensors.index.json",
                {
                    "metadata": {"total_size": 7},
                    "weight_map": {"left": first, "right": second},
                },
            )
            with self.assertRaises(TrainingBundleError):
                inspect_model_export(model)

            write_canonical_json(
                model / "model.safetensors.index.json",
                {"metadata": None, "weight_map": {"left": first, "right": second}},
            )
            with self.assertRaises(TrainingBundleError):
                inspect_model_export(model)

            (model / "model.safetensors").write_bytes(minimal_safetensors_bytes())
            with self.assertRaises(TrainingBundleError):
                inspect_model_export(model)

    def test_present_null_index_and_non_regular_nodes_are_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            model = Path(temporary) / "model"
            write_minimal_model_export(model)
            (model / "model.safetensors.index.json").write_text("null\n", encoding="utf-8")
            with self.assertRaises(TrainingBundleError):
                inspect_model_export(model)

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            model = root / "model"
            write_minimal_model_export(model)
            (model / "tokenizer.json").symlink_to(model / "config.json")
            with self.assertRaises(TrainingBundleError):
                inspect_model_export(model)
            if hasattr(os, "mkfifo"):
                (model / "tokenizer.json").unlink()
                os.mkfifo(model / "tokenizer.json")
                with self.assertRaises(TrainingBundleError):
                    inspect_model_export(model)

    def test_regular_tree_depth_is_bounded_without_recursion(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            nested = root
            for _ in range(REGULAR_TREE_MAX_DEPTH + 1):
                nested /= "d"
                nested.mkdir()
            with self.assertRaises(TrainingBundleError):
                inspect_regular_tree(root)

    def test_regular_tree_node_bound_applies_during_enumeration(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for index in range(3):
                (root / str(index)).write_bytes(b"")
            with patch("xenia_revocable_feedback_model.core.REGULAR_TREE_MAX_NODES", 2):
                with self.assertRaises(TrainingBundleError):
                    inspect_regular_tree(root)


if __name__ == "__main__":
    unittest.main()
