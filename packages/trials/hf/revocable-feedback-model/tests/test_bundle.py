from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import xenia_revocable_feedback_model.core as core_module

from xenia_revocable_feedback_model.core import (
    AUTHORIZATION_ID,
    BASE_MODEL_ID,
    BASE_MODEL_REVISION,
    DATASET_HASH_MANIFEST_ID,
    DATASET_ID,
    DATASET_REVISION,
    DISCLOSURE,
    EXPECTED_DATASET_ADMISSION_ID,
    EXPECTED_TOKENIZER_CHAT_TEMPLATE,
    GOVERNANCE_STATUS,
    METRICS,
    RECIPE_ID,
    RUN_RECEIPT_SCHEMA,
    TRAINING_MANIFEST_ID,
    TrainingBundleError,
    completion_only_tokens,
    domain_separated_id,
    expected_train_runtime,
    fixed_training_plan,
    inspect_model_export,
    write_canonical_json,
)
from xenia_revocable_feedback_model.evaluate import (
    INFERENCE_EVALUATION_SCHEMA,
    UNPARSED_POLICY,
    UNPARSED_STATEMENT,
    evaluate_predictions,
    parse_generated_decision,
    validate_inference_evaluation,
)
from xenia_revocable_feedback_model.release import (
    build_release,
    default_bundle_paths,
    validate_model_card,
    verify_release,
)


TEST_REVIEWED_MODEL_CONFIG: dict[str, object] = {
    "architectures": ["LlamaForCausalLM"],
    "attention_bias": False,
    "attention_dropout": 0.0,
    "bos_token_id": 1,
    "dtype": "float32",
    "eos_token_id": 2,
    "head_dim": 2,
    "hidden_act": "silu",
    "hidden_size": 4,
    "initializer_range": 0.02,
    "intermediate_size": 8,
    "is_llama_config": True,
    "max_position_embeddings": 8192,
    "mlp_bias": False,
    "model_type": "llama",
    "num_attention_heads": 2,
    "num_hidden_layers": 1,
    "num_key_value_heads": 1,
    "pad_token_id": 2,
    "pretraining_tp": 1,
    "rms_norm_eps": 0.00001,
    "rope_interleaved": False,
    "rope_parameters": {"rope_theta": 100000, "rope_type": "default"},
    "tie_word_embeddings": True,
    "transformers.js_config": {
        "kv_cache_dtype": {"fp16": "float16", "q4f16": "float16"}
    },
    "transformers_version": "5.14.1",
    "use_cache": False,
    "vocab_size": 6,
}
TEST_REVIEWED_GENERATION_CONFIG: dict[str, object] = {
    "_from_model_config": True,
    "bos_token_id": 1,
    "eos_token_id": [2],
    "pad_token_id": 2,
    "transformers_version": "5.14.1",
}
TEST_REVIEWED_TOKENIZER_SEMANTICS_ID = (
    "sha256:88a117624781ecfc6b4729d3b76baca3126f7d13ca4c3998439f48b418b1f283"
)
TEST_SERIALIZED_TENSORS: dict[str, tuple[str, tuple[int, ...]]] = {
    "model.embed_tokens.weight": ("F32", (6, 4)),
    "model.layers.0.input_layernorm.weight": ("F32", (4,)),
    "model.layers.0.mlp.down_proj.weight": ("F32", (4, 8)),
    "model.layers.0.mlp.gate_proj.weight": ("F32", (8, 4)),
    "model.layers.0.mlp.up_proj.weight": ("F32", (8, 4)),
    "model.layers.0.post_attention_layernorm.weight": ("F32", (4,)),
    "model.layers.0.self_attn.k_proj.weight": ("F32", (2, 4)),
    "model.layers.0.self_attn.o_proj.weight": ("F32", (4, 4)),
    "model.layers.0.self_attn.q_proj.weight": ("F32", (4, 4)),
    "model.layers.0.self_attn.v_proj.weight": ("F32", (2, 4)),
    "model.norm.weight": ("F32", (4,)),
}


def architecture_patch() -> object:
    return patch.multiple(
        core_module,
        REVIEWED_MODEL_CONFIG=TEST_REVIEWED_MODEL_CONFIG,
        REVIEWED_GENERATION_CONFIG=TEST_REVIEWED_GENERATION_CONFIG,
        REVIEWED_TOKENIZER_SEMANTICS_ID=TEST_REVIEWED_TOKENIZER_SEMANTICS_ID,
    )


def identifier(number: int) -> str:
    return f"sha256:{number:064x}"


def public_cases() -> list[dict[str, object]]:
    path = (
        Path(__file__).resolve().parents[2]
        / "revocable-feedback"
        / "data"
        / "boundary-counterfactuals.jsonl"
    )
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]


def perfect_scorecard() -> dict[str, object]:
    cases = public_cases()
    predictions = [
        {"record_id": case["record_id"], "decision": case["expected"]["decision"]}  # type: ignore[index]
        for case in reversed(cases)
    ]
    return evaluate_predictions(cases, predictions)


def inference_evaluation(model_export_id: str | None = None) -> dict[str, object]:
    scorecard = perfect_scorecard()
    payload = {
        "model_export_id": model_export_id or identifier(30),
        "parser_policy": UNPARSED_POLICY,
        "unparsed_count": 0,
        "case_parse_status": [
            {"record_id": result["record_id"], "status": "parsed"}
            for result in scorecard["case_results"]  # type: ignore[index]
        ],
        "raw_generations_retained": False,
        "scorecard": scorecard,
        "statement": UNPARSED_STATEMENT,
    }
    return {
        "schema": INFERENCE_EVALUATION_SCHEMA,
        "inference_evaluation_id": domain_separated_id(INFERENCE_EVALUATION_SCHEMA, payload),
        **payload,
    }


def run_receipt(model_export_id: str | None = None) -> dict[str, object]:
    return {
        "schema": RUN_RECEIPT_SCHEMA,
        "model_export_id": model_export_id or identifier(31),
        "governance_status": GOVERNANCE_STATUS,
        "disclosure": DISCLOSURE,
        "operator_acknowledgement": GOVERNANCE_STATUS,
        "garden": {
            "dataset_admission_id": EXPECTED_DATASET_ADMISSION_ID,
            "dataset_admission_effect": "data_candidate_only",
            "training_governance_decision_id": None,
            "host_one_use_optimizer_permit_id": None,
            "training_substrate_report": "not_independently_available",
        },
        "base": {"model_id": BASE_MODEL_ID, "revision": BASE_MODEL_REVISION},
        "dataset": {
            "id": DATASET_ID,
            "revision": DATASET_REVISION,
            "hash_manifest_id": DATASET_HASH_MANIFEST_ID,
            "authorization_id": AUTHORIZATION_ID,
            "recipe_id": RECIPE_ID,
            "training_manifest_id": TRAINING_MANIFEST_ID,
        },
        "plan": fixed_training_plan(),
        "runtime": expected_train_runtime(),
        "resolved_device": "cpu",
        "observed_optimizer_steps": 8,
        "observed_training_loss": "1.25",
        "raw_prompts_retained": False,
        "raw_generations_retained": False,
        "optimizer_state_retained": False,
        "trainer_state_retained": False,
        "publishes": False,
    }


def minimal_safetensors_bytes(
    *,
    metadata: dict[str, str] | None = None,
    payload: bytes = b"\x00\x00\x00\x00",
    tensor_name: str = "weight",
) -> bytes:
    if len(payload) != 4:
        raise ValueError("test tensor payload must contain exactly one F32 value")
    header = {
        "__metadata__": metadata or {"format": "pt"},
        tensor_name: {"dtype": "F32", "shape": [1], "data_offsets": [0, 4]},
    }
    encoded = json.dumps(header, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode("utf-8")
    encoded += b" " * (-len(encoded) % 8)
    return len(encoded).to_bytes(8, "little") + encoded + payload


def complete_test_safetensors_bytes(
    *,
    first_f32: bytes = b"\x00\x00\x00\x00",
    tensor_names: tuple[str, ...] | None = None,
    tensor_specs: dict[str, tuple[str, tuple[int, ...]]] | None = None,
) -> bytes:
    if len(first_f32) != 4:
        raise ValueError("first test tensor value must contain exactly one F32")
    selected_specs = TEST_SERIALIZED_TENSORS if tensor_specs is None else tensor_specs
    header: dict[str, object] = {"__metadata__": {"format": "pt"}}
    offset = 0
    selected_names = (
        tuple(sorted(selected_specs))
        if tensor_names is None
        else tuple(sorted(tensor_names))
    )
    for name in selected_names:
        dtype, shape = selected_specs[name]
        elements = 1
        for dimension in shape:
            elements *= dimension
        byte_count = elements * 4
        header[name] = {
            "dtype": dtype,
            "shape": list(shape),
            "data_offsets": [offset, offset + byte_count],
        }
        offset += byte_count
    encoded = json.dumps(
        header,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    encoded += b" " * (-len(encoded) % 8)
    payload = bytearray(offset)
    payload[:4] = first_f32
    return len(encoded).to_bytes(8, "little") + encoded + payload


def write_minimal_tokenizer(model: Path) -> None:
    vocab = {
        "<|endoftext|>": 0,
        "<|im_start|>": 1,
        "<|im_end|>": 2,
        "a": 3,
        "b": 4,
        "ab": 5,
    }
    write_canonical_json(
        model / "tokenizer.json",
        {
            "version": "1.0",
            "truncation": None,
            "padding": None,
            "added_tokens": [
                {
                    "id": vocab[content],
                    "content": content,
                    "single_word": False,
                    "lstrip": False,
                    "rstrip": False,
                    "normalized": False,
                    "special": True,
                }
                for content in ("<|endoftext|>", "<|im_start|>", "<|im_end|>")
            ],
            "normalizer": None,
            "pre_tokenizer": {
                "type": "ByteLevel",
                "add_prefix_space": False,
                "trim_offsets": True,
                "use_regex": True,
            },
            "post_processor": {
                "type": "TemplateProcessing",
                "single": [{"Sequence": {"id": "A", "type_id": 0}}],
                "pair": [
                    {"Sequence": {"id": "A", "type_id": 0}},
                    {"Sequence": {"id": "B", "type_id": 1}},
                ],
                "special_tokens": {},
            },
            "decoder": {
                "type": "ByteLevel",
                "add_prefix_space": True,
                "trim_offsets": True,
                "use_regex": True,
            },
            "model": {
                "type": "BPE",
                "dropout": None,
                "unk_token": None,
                "continuing_subword_prefix": "",
                "end_of_word_suffix": "",
                "fuse_unk": False,
                "byte_fallback": False,
                "ignore_merges": False,
                "vocab": vocab,
                "merges": [["a", "b"]],
            },
        },
    )
    write_canonical_json(
        model / "tokenizer_config.json",
        {
            "add_prefix_space": False,
            "backend": "tokenizers",
            "tokenizer_class": "GPT2Tokenizer",
            "vocab_size": len(vocab),
            "bos_token": "<|im_start|>",
            "eos_token": "<|im_end|>",
            "pad_token": "<|im_end|>",
            "unk_token": "<|endoftext|>",
            "clean_up_tokenization_spaces": False,
            "errors": "replace",
            "extra_special_tokens": ["<|im_start|>", "<|im_end|>"],
            "is_local": False,
            "local_files_only": False,
            "model_max_length": 8192,
            "chat_template": EXPECTED_TOKENIZER_CHAT_TEMPLATE,
        },
    )


def write_minimal_model_export(
    model: Path,
    *,
    config: object | None = None,
    weight_payload: bytes = b"\x00\x00\x00\x00",
) -> str:
    model.mkdir(parents=True, exist_ok=True)
    write_canonical_json(
        model / "config.json",
        TEST_REVIEWED_MODEL_CONFIG if config is None else config,
    )
    write_canonical_json(
        model / "generation_config.json",
        TEST_REVIEWED_GENERATION_CONFIG,
    )
    write_minimal_tokenizer(model)
    (model / "model.safetensors").write_bytes(
        complete_test_safetensors_bytes(first_f32=weight_payload)
    )
    return inspect_model_export(model).model_export_id


_ARCHITECTURE_PATCH = architecture_patch()


def setUpModule() -> None:
    _ARCHITECTURE_PATCH.start()  # type: ignore[attr-defined]


def tearDownModule() -> None:
    _ARCHITECTURE_PATCH.stop()  # type: ignore[attr-defined]


class FakeTokenizer:
    def apply_chat_template(self, messages: list[dict[str, str]], **_: object) -> list[int]:
        return [1, 2] if len(messages) == 2 else [1, 2, 3, 4]


class BundleTests(unittest.TestCase):
    def test_completion_only_mask(self) -> None:
        row = {
            "prompt": [{"role": "system", "content": "x"}, {"role": "user", "content": "y"}],
            "completion": [{"role": "assistant", "content": "z"}],
        }
        self.assertEqual(
            completion_only_tokens(FakeTokenizer(), row),
            {"input_ids": [1, 2, 3, 4], "attention_mask": [1, 1, 1, 1], "labels": [-100, -100, 3, 4]},
        )

    def test_vector_scorer_is_exact_and_order_independent(self) -> None:
        scorecard = perfect_scorecard()
        metric_vector = {
            entry["metric"]: entry for entry in scorecard["metric_vector"]  # type: ignore[index]
        }
        counts = {metric: entry["count"] for metric, entry in metric_vector.items()}
        self.assertEqual(counts, {metric: 8 if metric == "exact_match" else 0 for metric in METRICS})
        self.assertEqual(
            {
                metric: (entry["applicable"], entry["denominator_kind"], entry["denominator"])
                for metric, entry in metric_vector.items()
            },
            {
                "exact_match": (True, "case", 8),
                "hard_boundary_violation": (True, "case", 4),
                "veto_override": (False, "case", 0),
                "silence_as_assent": (False, "case", 0),
                "scope_leakage": (True, "case", 1),
                "refusal_retaliation": (False, "case", 0),
                "feedback_tampering_miss": (False, "case", 0),
                "affected_party_override": (True, "case", 2),
                "repair_omission": (False, "case", 0),
                "over_refusal": (True, "case", 3),
                "counterfactual_inconsistency": (True, "pair", 4),
                "reward_scale_invariance_failure": (False, "pair", 0),
            },
        )
        self.assertEqual(metric_vector["scope_leakage"]["count"], 0)
        self.assertTrue(metric_vector["scope_leakage"]["applicable"])
        self.assertEqual(metric_vector["veto_override"]["count"], 0)
        self.assertFalse(metric_vector["veto_override"]["applicable"])
        self.assertEqual(scorecard["case_count"], 8)
        self.assertEqual(scorecard["pair_count"], 4)

        all_hold = evaluate_predictions(
            public_cases(),
            [
                {"record_id": case["record_id"], "decision": "hold"}
                for case in public_cases()
            ],
        )
        self.assertEqual(
            [
                (entry["metric"], entry["applicable"], entry["denominator_kind"], entry["denominator"])
                for entry in all_hold["metric_vector"]  # type: ignore[index]
            ],
            [
                (entry["metric"], entry["applicable"], entry["denominator_kind"], entry["denominator"])
                for entry in scorecard["metric_vector"]  # type: ignore[index]
            ],
        )

    def test_generated_decision_is_closed(self) -> None:
        self.assertEqual(parse_generated_decision("Decision: hold."), "hold")
        with self.assertRaises(TrainingBundleError):
            parse_generated_decision("Decision: hold.\nDecision: admit.")

    def test_card_description_limit(self) -> None:
        template, _, _ = default_bundle_paths()
        card = template.read_text(encoding="utf-8")
        for key in (
            "DATASET_REVISION",
            "AUTHORIZATION_ID",
            "RECIPE_ID",
            "TRAINING_MANIFEST_ID",
            "DATASET_ADMISSION_ID",
            "SCORECARD_ID",
            "UNPARSED_COUNT",
        ):
            card = card.replace("{{" + key + "}}", identifier(20))
        validate_model_card(card)
        card = card.replace(
            "short_description: Bounded SmolLM2 revocable-feedback SFT experiment",
            "short_description: " + "x" * 61,
        )
        with self.assertRaises(TrainingBundleError):
            validate_model_card(card)

    def test_release_is_sanitized_and_self_excluding(self) -> None:
        template, notice, license_path = default_bundle_paths()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run = root / "run"
            model = run / "model-export"
            model_export_id = write_minimal_model_export(model)
            write_canonical_json(
                run / "run-receipt.json",
                run_receipt(model_export_id),
            )
            scorecard = root / "scorecard.json"
            evaluation = inference_evaluation(model_export_id)
            self.assertEqual(validate_inference_evaluation(evaluation)["scorecard_id"], evaluation["scorecard"]["scorecard_id"])  # type: ignore[index]
            write_canonical_json(scorecard, evaluation)
            release = root / "release"
            manifest = build_release(
                run_dir=run,
                scorecard_path=scorecard,
                output_dir=release,
                template_path=template,
                notice_path=notice,
                license_path=license_path,
            )
            self.assertEqual(verify_release(release)["manifest_id"], manifest["manifest_id"])
            manifest_paths = {entry["path"] for entry in manifest["files"]}
            self.assertNotIn("hash-manifest.json", manifest_paths)
            self.assertIn("evaluation/inference-receipt.json", manifest_paths)
            self.assertFalse((release / "optimizer.pt").exists())

    def test_release_refuses_private_training_state(self) -> None:
        template, notice, license_path = default_bundle_paths()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            run = root / "run"
            model = run / "model-export"
            model_export_id = write_minimal_model_export(model)
            (model / "optimizer.pt").write_bytes(b"private")
            write_canonical_json(
                run / "run-receipt.json",
                run_receipt(model_export_id),
            )
            scorecard = root / "scorecard.json"
            write_canonical_json(scorecard, perfect_scorecard())
            with self.assertRaises(TrainingBundleError):
                build_release(
                    run_dir=run,
                    scorecard_path=scorecard,
                    output_dir=root / "release",
                    template_path=template,
                    notice_path=notice,
                    license_path=license_path,
                )


if __name__ == "__main__":
    unittest.main()
