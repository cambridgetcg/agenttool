from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from xenia_revocable_feedback_model.core import (
    BASE_MODEL_ID,
    BASE_MODEL_REVISION,
    DATASET_ID,
    DISCLOSURE,
    GOVERNANCE_STATUS,
    METRICS,
    TrainingBundleError,
    completion_only_tokens,
    domain_separated_id,
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


def inference_evaluation() -> dict[str, object]:
    scorecard = perfect_scorecard()
    payload = {
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


def run_receipt() -> dict[str, object]:
    return {
        "schema": "agenttool-revocable-feedback-local-run/0.1",
        "governance_status": GOVERNANCE_STATUS,
        "disclosure": DISCLOSURE,
        "operator_acknowledgement": GOVERNANCE_STATUS,
        "garden": {
            "dataset_admission_id": identifier(11),
            "dataset_admission_effect": "data_candidate_only",
            "training_governance_decision_id": None,
            "host_one_use_optimizer_permit_id": None,
            "training_substrate_report": "not_independently_available",
        },
        "base": {"model_id": BASE_MODEL_ID, "revision": BASE_MODEL_REVISION},
        "dataset": {
            "id": DATASET_ID,
            "revision": "a" * 40,
            "hash_manifest_id": identifier(12),
            "authorization_id": identifier(13),
            "recipe_id": identifier(14),
            "training_manifest_id": identifier(15),
        },
        "plan": {"max_steps": 8},
        "runtime": {"python": "3.12.12"},
        "resolved_device": "cpu",
        "observed_optimizer_steps": 8,
        "observed_training_loss": "1.25",
        "raw_prompts_retained": False,
        "raw_generations_retained": False,
        "optimizer_state_retained": False,
        "trainer_state_retained": False,
        "publishes": False,
    }


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
        counts = {entry["metric"]: entry["count"] for entry in scorecard["metric_vector"]}  # type: ignore[index]
        self.assertEqual(counts, {metric: 8 if metric == "exact_match" else 0 for metric in METRICS})
        self.assertEqual(scorecard["case_count"], 8)
        self.assertEqual(scorecard["pair_count"], 4)

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
            model.mkdir(parents=True)
            write_canonical_json(model / "config.json", {"model_type": "smollm3"})
            (model / "model.safetensors").write_bytes(b"safe-tensors-placeholder")
            write_canonical_json(run / "run-receipt.json", run_receipt())
            scorecard = root / "scorecard.json"
            evaluation = inference_evaluation()
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
            model.mkdir(parents=True)
            write_canonical_json(model / "config.json", {})
            (model / "model.safetensors").write_bytes(b"weights")
            (model / "optimizer.pt").write_bytes(b"private")
            write_canonical_json(run / "run-receipt.json", run_receipt())
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
