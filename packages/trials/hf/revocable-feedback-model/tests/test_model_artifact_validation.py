from __future__ import annotations

import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_bundle import (
    minimal_safetensors_bytes,
    write_minimal_model_export,
    write_minimal_tokenizer,
)
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


def mutate_json(path: Path, mutate: object) -> None:
    value = json.loads(path.read_text(encoding="utf-8"))
    mutate(value)  # type: ignore[operator]
    write_canonical_json(path, value)


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
                [
                    "config.json",
                    "generation_config.json",
                    "model.safetensors",
                    "tokenizer.json",
                    "tokenizer_config.json",
                ],
            )

    def test_export_requires_structured_trainer_tokenizer_artifacts(self) -> None:
        mutations = {
            "missing tokenizer": lambda model: (model / "tokenizer.json").unlink(),
            "missing tokenizer config": lambda model: (model / "tokenizer_config.json").unlink(),
            "empty tokenizer": lambda model: write_canonical_json(model / "tokenizer.json", {}),
            "missing tokenizer model type": lambda model: write_canonical_json(
                model / "tokenizer.json", {"model": {"vocab": {"<unk>": 0}}}
            ),
            "empty tokenizer vocab": lambda model: write_canonical_json(
                model / "tokenizer.json", {"model": {"type": "BPE", "vocab": {}}}
            ),
            "empty tokenizer class": lambda model: write_canonical_json(
                model / "tokenizer_config.json", {"tokenizer_class": ""}
            ),
            "invented tokenizer": lambda model: (
                write_canonical_json(
                    model / "tokenizer.json",
                    {"model": {"type": "not-a-real-tokenizer", "vocab": {"x": None}}},
                ),
                write_canonical_json(
                    model / "tokenizer_config.json",
                    {"tokenizer_class": "NotARealTokenizer"},
                ),
            ),
            "boolean vocab ID": lambda model: write_canonical_json(
                model / "tokenizer.json",
                {"model": {"type": "BPE", "vocab": {"a": False}, "merges": [["a", "a"]]}},
            ),
            "missing merges": lambda model: write_canonical_json(
                model / "tokenizer.json",
                {"model": {"type": "BPE", "vocab": {"a": 0}}},
            ),
            "malformed merge": lambda model: write_canonical_json(
                model / "tokenizer.json",
                {"model": {"type": "BPE", "vocab": {"a": 0}, "merges": [["a"]]}},
            ),
            "vocab size mismatch": lambda model: write_canonical_json(
                model / "tokenizer_config.json",
                {
                    "tokenizer_class": "GPT2Tokenizer",
                    "vocab_size": 7,
                    "bos_token": "<|im_start|>",
                    "eos_token": "<|im_end|>",
                    "pad_token": "<|im_end|>",
                    "unk_token": "<|endoftext|>",
                    "chat_template": "message['role'] message['content'] add_generation_prompt <|im_start|> <|im_end|>",
                },
            ),
            "empty chat template": lambda model: write_canonical_json(
                model / "tokenizer_config.json",
                {
                    "tokenizer_class": "GPT2Tokenizer",
                    "vocab_size": 6,
                    "bos_token": "<|im_start|>",
                    "eos_token": "<|im_end|>",
                    "pad_token": "<|im_end|>",
                    "unk_token": "<|endoftext|>",
                    "chat_template": "",
                },
            ),
            "invalid template with expected fragments": lambda model: mutate_json(
                model / "tokenizer_config.json",
                lambda value: value.__setitem__(
                    "chat_template",
                    "message['role'] message['content'] add_generation_prompt <|im_start|> <|im_end|>",
                ),
            ),
            "missing outer added tokens": lambda model: mutate_json(
                model / "tokenizer.json",
                lambda value: value.pop("added_tokens"),
            ),
            "wrong ByteLevel decoder": lambda model: mutate_json(
                model / "tokenizer.json",
                lambda value: value.__setitem__("decoder", {"type": "Whitespace"}),
            ),
            "wrong added-token ID": lambda model: mutate_json(
                model / "tokenizer.json",
                lambda value: value["added_tokens"][0].__setitem__("id", 5),
            ),
            "wrong model special-token ID": lambda model: mutate_json(
                model / "config.json",
                lambda value: value.__setitem__("bos_token_id", 5),
            ),
        }
        for name, mutate in mutations.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as temporary:
                model = Path(temporary) / "model"
                write_minimal_model_export(model)
                mutate(model)
                with self.assertRaises(TrainingBundleError):
                    inspect_model_export(model)

    def test_minimal_accepted_tokenizer_loads_under_the_exact_stack(self) -> None:
        try:
            import transformers
            from transformers import AutoTokenizer
        except ImportError:
            self.skipTest("exact tokenizer load smoke requires the train dependencies")
        if transformers.__version__ != "5.14.1":
            self.skipTest("tokenizer load smoke requires exact Transformers 5.14.1")
        with tempfile.TemporaryDirectory() as temporary:
            model = Path(temporary) / "model"
            write_minimal_model_export(model)
            tokenizer = AutoTokenizer.from_pretrained(
                model,
                local_files_only=True,
                trust_remote_code=False,
            )
            self.assertEqual(tokenizer.bos_token_id, 1)
            self.assertEqual(tokenizer.eos_token_id, 2)
            self.assertEqual(tokenizer.pad_token_id, 2)
            self.assertEqual(tokenizer.unk_token_id, 0)
            self.assertEqual(tokenizer.encode("ab"), [5])
            rendered = tokenizer.apply_chat_template(
                [{"role": "user", "content": "ab"}],
                tokenize=False,
                add_generation_prompt=True,
            )
            self.assertIn("<|im_start|>user\nab<|im_end|>\n", rendered)
            self.assertTrue(rendered.endswith("<|im_start|>assistant\n"))

            write_canonical_json(
                model / "special_tokens_map.json",
                {
                    "bos_token": "a",
                    "eos_token": "b",
                    "pad_token": "a",
                    "unk_token": "b",
                },
            )
            with self.assertRaises(TrainingBundleError):
                inspect_model_export(model)
            overridden = AutoTokenizer.from_pretrained(
                model,
                local_files_only=True,
                trust_remote_code=False,
            )
            self.assertEqual(
                (
                    overridden.bos_token,
                    overridden.eos_token,
                    overridden.pad_token,
                    overridden.unk_token,
                ),
                ("a", "b", "a", "b"),
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
            tokenizer = json.loads((model / "tokenizer.json").read_text(encoding="utf-8"))
            vocab = tokenizer["model"]["vocab"]
            for index in range(45_000):
                vocab[f"token-{index:05d}-" + "x" * 64] = len(vocab)
            write_canonical_json(
                model / "tokenizer.json",
                tokenizer,
            )
            model_config = json.loads((model / "config.json").read_text(encoding="utf-8"))
            model_config["vocab_size"] = len(vocab)
            write_canonical_json(model / "config.json", model_config)
            tokenizer_config = json.loads(
                (model / "tokenizer_config.json").read_text(encoding="utf-8")
            )
            tokenizer_config["vocab_size"] = len(vocab)
            write_canonical_json(model / "tokenizer_config.json", tokenizer_config)
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

    def test_unvalidated_tokenizer_formats_and_sidecars_are_not_publishable(self) -> None:
        fake_hf = "hf_" + "a" * 24
        for name in (
            "tokenizer.model",
            "merges.txt",
            "special_tokens_map.json",
            "added_tokens.json",
            "vocab.json",
        ):
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
            write_canonical_json(
                model / "config.json",
                {
                    "model_type": "llama",
                    "vocab_size": 6,
                    "bos_token_id": 1,
                    "eos_token_id": 2,
                    "pad_token_id": 2,
                },
            )
            write_minimal_tokenizer(model)
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
            (model / "tokenizer.json").unlink()
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
