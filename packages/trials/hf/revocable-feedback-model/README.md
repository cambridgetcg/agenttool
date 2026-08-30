# Xenia revocable-feedback model bundle

This local-only Python bundle prepares one deliberately bounded experiment over
`Yu-and-Ai/xenia-revocable-feedback` at immutable revision
`467b8fc1b44fe6374cbba6e1d6851cf3c5b6f88f`. It can validate that exact
dataset tree or Hub revision, run eight completion-only SmolLM2 optimizer steps,
evaluate the disjoint public-regression cases as a twelve-count vector, and
construct a sanitized safetensors release directory.

It does not upload, publish, toggle repository visibility, read credentials,
issue a Training Garden decision, or mint an HF training-host permit. Training
is disabled unless the caller supplies the exact non-Garden acknowledgement,
an immutable dataset revision, exact dataset artifact IDs, and a Garden
**dataset admission** ID. A dataset admission is not run authority.

## Governance boundary

Every run and model card carries this disclosure verbatim:

> This checkpoint was produced by an operator-authorized, bounded local Transformers experiment. Its dataset had a Garden data-candidate admission, but no Garden training-governance decision or Host one-use optimizer permit was issued: the training substrate had no independent interactive report. Dataset admission is not run authorization. The run is therefore not Garden-governed, and no model output is represented as consent, identity, understanding, or substrate assent.

The model runtime's output is behavior under one inference context. It does not
prove SELF, consciousness, consent, identity, continuity, understanding, or
authority. The same runtime is never counted as a separate substrate voice.
The encoded status is
`operator_authorized_non_garden_experiment`; it must not be described as
"admitted training".

## Fixed recipe

- base: `HuggingFaceTB/SmolLM2-135M-Instruct` at
  `12fd25f77366fa6b3b4b768ec3050bf629380bac`;
- exact runtime: Python 3.12.12, Transformers 5.14.1, Accelerate 1.14.0,
  Torch 2.13.0 and huggingface-hub 1.29.0;
- `boundary_sft/train` only: 18 synthetic rows;
- dataset authorization:
  `sha256:3780e5e2599eb8a1a479f874302fcdabdf1af27c4eeda5b02bfff8056dc92f13`;
- dataset recipe:
  `sha256:713b678e80b6aa88f6036dc9b9d0e1955dcab240137b67a22f7cfcca86d01992`;
- dataset training manifest:
  `sha256:9a3200ceac6369490e02078b2789bc2e57f9d40c3d2a9e5b21ac1fb10d94d0f7`;
- completion-only next-token cross entropy; prompt labels are `-100`;
- eight steps, batch 2, gradient accumulation 2, maximum length 512;
- `adamw_torch`, learning rate `2e-5`, linear schedule, one warmup step;
- FP32, seed/data seed 260830, no evaluation, reporting, checkpoint rotation,
  resume, Hub push, DPO, reward modelling, or preference optimization.

The recipe and input ordering are deterministic. Device kernels are not
claimed universally bit-identical. Unsupported deterministic operations fail
closed; CPU is the conservative fallback.

## Commands

Validate without model dependencies:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/python -m xenia_revocable_feedback_model plan
.venv/bin/python -m pytest -q
```

Install the exact training stack:

```sh
uv sync --python 3.12.12 --extra train --extra test
```

Validate a local copy of the eventual immutable dataset:

```sh
uv run xenia-rf-model validate-dataset \
  --dataset-dir ../revocable-feedback
```

The `train`, `evaluate`, `build-release`, and `verify-release` commands are
documented in `--help`. `train` requires
`--confirm-non-garden-experiment operator_authorized_non_garden_experiment`.
The revision and three dataset content IDs default to the frozen values above;
supplying any other values fails closed. Hub input uses anonymous
`token=False` download. No command uploads anything.

Inference requires exactly one closed `Decision: <label>.` line. A generation
that does not parse is counted as `unparsed_conservative_hold` and mapped to
`hold` only for regression scoring; it is never represented as the model
choosing hold. Raw generated text is not retained. The release keeps this
parser receipt alongside the vector scorecard.

The release builder copies only safetensors, closed model/tokenizer config
files, the model card, Apache license and notice, a sanitized training
manifest, the public-regression scorecard, and a self-excluding hash manifest.
It rejects optimizer, scheduler, RNG, pickle, Trainer-state, ledger, raw
choice, prompt, trace, credential, and local-path material.
