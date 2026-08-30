from __future__ import annotations

import importlib.metadata
import os
import random
import shutil
import sys
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator, Mapping, Sequence

from .core import (
    BASE_MODEL_ID,
    BASE_MODEL_REVISION,
    DATASET_ID,
    DISCLOSURE,
    EXPECTED_DATASET_ADMISSION_ID,
    EXPECTED_RUNTIME_VERSIONS,
    GOVERNANCE_STATUS,
    RUN_RECEIPT_SCHEMA,
    DatasetBundle,
    TrainingBundleError,
    _require,
    completion_only_tokens,
    ensure_empty_output,
    fixed_training_plan,
    inspect_model_export,
    load_and_validate_dataset,
    require_revision,
    write_canonical_json,
)


def verify_runtime_versions() -> dict[str, str]:
    _require(sys.version_info[:3] == (3, 12, 12), "Python 3.12.12 is required exactly")
    observed: dict[str, str] = {}
    for distribution, expected in EXPECTED_RUNTIME_VERSIONS.items():
        try:
            version = importlib.metadata.version(distribution)
        except importlib.metadata.PackageNotFoundError as exc:
            raise TrainingBundleError(f"required distribution is absent: {distribution}") from exc
        _require(version == expected, f"{distribution} must be exactly {expected}; observed {version}")
        observed[distribution] = version
    return {"python": f"{sys.version_info.major}.{sys.version_info.minor}.{sys.version_info.micro}", **observed}


@contextmanager
def resolved_dataset_root(
    *,
    dataset_dir: Path | None,
    dataset_revision: str,
) -> Iterator[Path]:
    require_revision(dataset_revision)
    _require(dataset_dir is None or dataset_dir.is_dir(), "dataset directory does not exist")
    if dataset_dir is not None:
        yield dataset_dir
        return
    try:
        from huggingface_hub import snapshot_download
    except ImportError as exc:  # pragma: no cover - exercised only with train extra
        raise TrainingBundleError("huggingface-hub is required for Hub dataset input") from exc
    with tempfile.TemporaryDirectory(prefix="xenia-rf-dataset-") as temporary:
        resolved = snapshot_download(
            repo_id=DATASET_ID,
            repo_type="dataset",
            revision=dataset_revision,
            local_dir=temporary,
            token=False,
        )
        metadata = Path(temporary) / ".cache"
        if metadata.exists():
            shutil.rmtree(metadata)
        provider_attributes = Path(temporary) / ".gitattributes"
        if provider_attributes.is_file():
            provider_attributes.unlink()
        yield Path(resolved)


def load_dataset_source(
    *,
    dataset_dir: Path | None,
    dataset_revision: str,
    authorization_id: str,
    recipe_id: str,
    training_manifest_id: str,
) -> Iterator[DatasetBundle]:
    @contextmanager
    def _load() -> Iterator[DatasetBundle]:
        with resolved_dataset_root(dataset_dir=dataset_dir, dataset_revision=dataset_revision) as root:
            yield load_and_validate_dataset(
                root,
                revision=dataset_revision,
                authorization_id=authorization_id,
                recipe_id=recipe_id,
                training_manifest_id=training_manifest_id,
            )

    return _load()


class _TokenDataset:
    def __init__(self, rows: Sequence[dict[str, list[int]]]) -> None:
        self._rows = tuple(rows)

    def __len__(self) -> int:
        return len(self._rows)

    def __getitem__(self, index: int) -> dict[str, list[int]]:
        return self._rows[index]


class _CompletionCollator:
    def __init__(self, torch_module: Any, pad_token_id: int) -> None:
        self._torch = torch_module
        self._pad_token_id = pad_token_id

    def __call__(self, features: Sequence[Mapping[str, Sequence[int]]]) -> dict[str, Any]:
        width = max(len(feature["input_ids"]) for feature in features)
        input_ids: list[list[int]] = []
        attention_mask: list[list[int]] = []
        labels: list[list[int]] = []
        for feature in features:
            padding = width - len(feature["input_ids"])
            input_ids.append(list(feature["input_ids"]) + [self._pad_token_id] * padding)
            attention_mask.append(list(feature["attention_mask"]) + [0] * padding)
            labels.append(list(feature["labels"]) + [-100] * padding)
        return {
            "input_ids": self._torch.tensor(input_ids, dtype=self._torch.long),
            "attention_mask": self._torch.tensor(attention_mask, dtype=self._torch.long),
            "labels": self._torch.tensor(labels, dtype=self._torch.long),
        }


def _resolve_device(torch_module: Any, requested: str) -> str:
    _require(requested in {"auto", "cpu", "mps"}, "device must be auto, cpu, or mps")
    available = bool(torch_module.backends.mps.is_available())
    if requested == "mps":
        _require(available, "MPS was requested but is unavailable")
        return "mps"
    return "mps" if requested == "auto" and available else "cpu"


def train_bounded_model(
    bundle: DatasetBundle,
    *,
    output_dir: Path,
    dataset_admission_id: str,
    confirmation: str,
    device: str,
) -> dict[str, Any]:
    _require(
        isinstance(dataset_admission_id, str)
        and dataset_admission_id == EXPECTED_DATASET_ADMISSION_ID,
        "dataset admission does not match the reviewed data-candidate admission",
    )
    _require(confirmation == GOVERNANCE_STATUS, f"confirmation must equal {GOVERNANCE_STATUS}")
    versions = verify_runtime_versions()
    ensure_empty_output(output_dir)
    os.environ["PYTORCH_ENABLE_MPS_FALLBACK"] = "0"
    try:
        import numpy as np
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer, Trainer, TrainingArguments
    except ImportError as exc:  # pragma: no cover - exercised only with train extra
        raise TrainingBundleError("the exact train dependencies are required") from exc

    random.seed(260830)
    np.random.seed(260830)
    torch.manual_seed(260830)
    torch.use_deterministic_algorithms(True)
    resolved_device = _resolve_device(torch, device)
    tokenizer = AutoTokenizer.from_pretrained(
        BASE_MODEL_ID,
        revision=BASE_MODEL_REVISION,
        token=False,
        trust_remote_code=False,
    )
    if tokenizer.pad_token_id is None:
        _require(tokenizer.eos_token_id is not None, "tokenizer has no pad or EOS token")
        tokenizer.pad_token = tokenizer.eos_token
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL_ID,
        revision=BASE_MODEL_REVISION,
        token=False,
        trust_remote_code=False,
        use_safetensors=True,
        dtype=torch.float32,
    )
    token_rows = [completion_only_tokens(tokenizer, row, max_length=512) for row in bundle.train_rows]
    dataset = _TokenDataset(token_rows)
    collator = _CompletionCollator(torch, tokenizer.pad_token_id)

    with tempfile.TemporaryDirectory(prefix="xenia-rf-trainer-") as trainer_output:
        arguments = TrainingArguments(
            output_dir=trainer_output,
            max_steps=8,
            per_device_train_batch_size=2,
            gradient_accumulation_steps=2,
            learning_rate=2e-5,
            lr_scheduler_type="linear",
            warmup_steps=1,
            weight_decay=0.0,
            max_grad_norm=1.0,
            optim="adamw_torch",
            seed=260830,
            data_seed=260830,
            dataloader_num_workers=0,
            fp16=False,
            bf16=False,
            eval_strategy="no",
            save_strategy="no",
            logging_strategy="no",
            report_to=[],
            push_to_hub=False,
            load_best_model_at_end=False,
            gradient_checkpointing=False,
            use_cpu=resolved_device == "cpu",
            disable_tqdm=True,
        )
        trainer = Trainer(
            model=model,
            args=arguments,
            train_dataset=dataset,
            data_collator=collator,
            processing_class=tokenizer,
        )
        result = trainer.train(resume_from_checkpoint=None)
        _require(int(trainer.state.global_step) == 8, "trainer did not complete exactly eight optimizer steps")

    model_export = output_dir / "model-export"
    model.save_pretrained(model_export, safe_serialization=True)
    tokenizer.save_pretrained(model_export, save_jinja_files=False)
    model_export_id = inspect_model_export(model_export).model_export_id
    receipt = {
        "schema": RUN_RECEIPT_SCHEMA,
        "model_export_id": model_export_id,
        "governance_status": GOVERNANCE_STATUS,
        "disclosure": DISCLOSURE,
        "operator_acknowledgement": GOVERNANCE_STATUS,
        "garden": {
            "dataset_admission_id": dataset_admission_id,
            "dataset_admission_effect": "data_candidate_only",
            "training_governance_decision_id": None,
            "host_one_use_optimizer_permit_id": None,
            "training_substrate_report": "not_independently_available",
        },
        "base": {"model_id": BASE_MODEL_ID, "revision": BASE_MODEL_REVISION},
        "dataset": {
            "id": DATASET_ID,
            "revision": bundle.revision,
            "hash_manifest_id": bundle.hash_manifest_id,
            "authorization_id": bundle.authorization_id,
            "recipe_id": bundle.recipe_id,
            "training_manifest_id": bundle.training_manifest_id,
        },
        "plan": fixed_training_plan(),
        "runtime": versions,
        "resolved_device": resolved_device,
        "observed_optimizer_steps": 8,
        "observed_training_loss": format(float(result.metrics["train_loss"]), ".12g"),
        "raw_prompts_retained": False,
        "raw_generations_retained": False,
        "optimizer_state_retained": False,
        "trainer_state_retained": False,
        "publishes": False,
    }
    write_canonical_json(output_dir / "run-receipt.json", receipt)
    return receipt
