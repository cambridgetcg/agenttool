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
**dataset admission** ID equal to the one reviewed for this experiment. That
admission is checked before runtime inspection, output creation, environment
mutation, or ML dependency/model loading. A dataset admission is not run
authority.

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

Inspect the fixed plan without model dependencies:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -e .
.venv/bin/python -m xenia_revocable_feedback_model plan
```

Install the exact training and non-binding load-audit test stack, then run the
tests:

```sh
uv sync --python 3.12.12 --extra train --extra test
uv run pytest -q
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
parser receipt alongside the vector scorecard. Each new inference receipt also
binds the complete sorted allowlisted model-export closure (weights and every
model/tokenizer artifact) by a domain-separated content ID. Evaluation checks
that closure before and after generation; build and verification independently
require the same ID for the bytes being released. The current closed run
receipt schema is `agenttool-revocable-feedback-local-run/0.2`; training emits
its independently inspected `model_export_id` only after both model and
tokenizer saving complete. Release build and verification independently match
that run binding to the model-export bytes as well.

New model evaluations emit
`agenttool-revocable-feedback-model-scorecard/0.2` nested in
`agenttool-revocable-feedback-inference-evaluation/0.2`. Every metric entry
declares whether the benchmark exercised that metric, whether its denominator
is cases or pairs, and the exact denominator. Thus an applicable metric with
zero counted observations differs from a zero whose denominator is zero. These
fields describe benchmark coverage only; they do not establish general model
capability, safety, consent, understanding, or authority.

The release builder copies only safetensors, closed model/tokenizer config
files, the model card, Apache license and notice, a sanitized training
manifest, the public-regression scorecard, and a self-excluding hash manifest.
It rejects known private-training file categories, configured high-risk JSON
field names, and recognizable credential/local-path patterns. This is a
bounded publication policy, not a general secret detector. Every model JSON
artifact is parsed under explicit byte/node/depth bounds with duplicate keys,
non-finite numbers, configured private field names, and configured private-text
patterns rejected in keys and values. Safetensors files receive a bounded
duplicate-safe header parse, an exact reviewed metadata shape, exact tensor
descriptors and byte extents, and contiguous payload validation. The model
export and release tree reject
symlinks, special nodes, nested model files, unknown or empty extra directories,
mixed or unreferenced weight layouts, and raw tokenizer formats for which this
pinned export has no bounded semantic validator. Every publishable export must
contain both `tokenizer.json` and `tokenizer_config.json`; the bounded static
check requires the pinned BPE/GPT2 types, unique contiguous integer vocabulary
IDs, a typed nonempty BPE merge array, matching model/tokenizer vocabulary
sizes, the fixed special-token and ID bindings, the reviewed ByteLevel outer
pipeline and model controls, and the exact chat template used by this
evaluator. Unemitted tokenizer sidecars are rejected because they can override
those runtime bindings. This pinned structural check rejects missing,
type-inconsistent, and internally incoherent tokenizer artifacts on Xenia's
inference path; it does not prove artifact origin or claim universal tokenizer
loadability.

`build-release` and `verify-release` apply a narrower publication gate than the
generic run-artifact inspector. They require the exact reviewed
`LlamaForCausalLM` config: 576 hidden units, 1,536 intermediate units, 30
layers, 9 attention heads, 3 key/value heads, head dimension 64, vocabulary
49,152, FP32 parameters, bias-free projections, and tied word embeddings. The
complete single-file or sharded safetensors union must contain exactly 272
named F32 tensors with the reviewed shapes: the embedding, nine tensors per
layer, and final norm. A serialized `lm_head.weight` is rejected because the
reviewed tied-weight serialization omits it; the separate audit stack
reconstructs it as the embedding alias. The publishable path permits at most
32 weight shards and 8 MiB of safetensors header bytes across them, with no
more than the reviewed 272 serialized tensor descriptors parsed before the
exact union check.

Each bounded JSON file is validated and hashed from one retained regular-file
snapshot. Each safetensors header is structurally validated before payload I/O,
seeds the digest bound to that open regular-file descriptor, and is discarded
before the next shard opens. Only the bounded descriptor map, digest state,
and descriptor remain while the exact union is checked; payload hashing then
continues the seeded digest on that same descriptor. Release manifests are
fully preflighted for canonical unique paths, exact tree membership, declared
and actual sizes, per-file caps, and a 2 GiB aggregate cap for manifest-listed
content before it is hashed. The self-excluding manifest is separately capped
at 2 MiB; the second pass hashes every listed file with its declared bound.

Publication does not use a path-based Transformers load as an integrity gate:
the values visible through a path can be temporarily substituted between a
static inspection and a load. A separate test-only audit has observed the exact
local Python/Transformers/Torch stack construct the 273-name state and tied
alias with remote code disabled, safetensors required, and local-files-only
inputs, but that observation does not bind loaded values to the release digest.
The authoritative publication check is the exact config plus complete
same-descriptor name/dtype/shape inventory and content digest. These bounded
checks do not prove artifact origin, training quality, general safety,
identity, consciousness, consent, understanding, authority, or loadability
under other runtimes.

For current releases, verification validates the run receipt, scorecard, and
optional inference receipt first, then reconstructs the model card from the
bundled template and those machine records. The released card must match that
canonical rendering byte for byte, including dataset lineage, scorecard ID,
and the inference receipt's unparsed count (or the explicit scorecard-only
`not_applicable_precomputed_predictions` value).

The immutable first public release's run and inference receipts both predate
`model_export_id`, and its scorecard and inference schemas are the legacy
`/0.1` shapes. Its scorecard's zero counts do not establish that a metric was
applicable: `/0.1` did not record denominators. `verify-release` recognizes all
three legacy records only for the exact already-published release-manifest,
inference-receipt, and recomputed model-export ID triple; that manifest already
binds the exact legacy card bytes. Training and `build-release` never emit or
accept those legacy shapes. Any new run or inference receipt must carry its
current closed model-export binding, and every new model scorecard/inference
pair uses `/0.2` applicability semantics. A scorecard-only release makes no
claim that the released model produced those predictions, while its run
receipt still binds the bytes being released.
