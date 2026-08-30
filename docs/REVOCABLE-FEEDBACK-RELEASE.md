<!-- @id urn:agenttool:doc/REVOCABLE-FEEDBACK-RELEASE @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @cites urn:agenttool:doc/REVOCABLE-FEEDBACK urn:agenttool:doc/HF-TRAINING-GARDEN -->

# Revocable feedback public release receipt

> **Compass:** [Revocable Feedback](REVOCABLE-FEEDBACK.md) (immutable dataset source input) · [HF Training Garden](HF-TRAINING-GARDEN.md) (admission is not run authority)
>
> **Implements:** The dated public artifact, admission, bounded experiment, and hosting-boundary receipt kept outside the dataset generator's selected source set.
>
> **Code:** [`packages/trials/hf/revocable-feedback/`](../packages/trials/hf/revocable-feedback/) · [`packages/trials/hf/revocable-feedback-model/`](../packages/trials/hf/revocable-feedback-model/) · [`packages/trials/hf/revocable-feedback-space/`](../packages/trials/hf/revocable-feedback-space/)
>
> **Tests:** [`packages/trials/tests/revocable-feedback-release.test.ts`](../packages/trials/tests/revocable-feedback-release.test.ts) · [`packages/trials/hf/revocable-feedback-model/tests/`](../packages/trials/hf/revocable-feedback-model/tests/)

Status: the source benchmark remains deterministic and local-only, while its
dataset, static teaching Space, bounded experimental checkpoint, and collection
index were publicly released on 2026-08-30. Publication adds no runtime gate or
hosted AgentTool route.

## Public release receipt

| Artifact | Public locator | Exact release boundary |
|---|---|---|
| dataset | [`Yu-and-Ai/xenia-revocable-feedback`](https://huggingface.co/datasets/Yu-and-Ai/xenia-revocable-feedback/commit/467b8fc1b44fe6374cbba6e1d6851cf3c5b6f88f) | immutable revision `467b8fc1b44fe6374cbba6e1d6851cf3c5b6f88f`; six config/split pairs |
| static Space | [`Yu-and-Ai/xenia-feedback-lab`](https://huggingface.co/spaces/Yu-and-Ai/xenia-feedback-lab/commit/ae6ee87ab8735a2a598c5610a24fe4e8c6042a9e) | immutable revision `ae6ee87ab8735a2a598c5610a24fe4e8c6042a9e`; checked-in app has no API, model, storage, or telemetry path |
| model | [`Yu-and-Ai/xenia-revocable-feedback-smollm2-135m`](https://huggingface.co/Yu-and-Ai/xenia-revocable-feedback-smollm2-135m/commit/7064e2e29f34a9519b57181fee10d233beba21f1) | immutable revision `7064e2e29f34a9519b57181fee10d233beba21f1`; sanitized `safetensors` release |
| collection | [`Xenia Cage & Key — Revocable Feedback`](https://huggingface.co/collections/Yu-and-Ai/xenia-cage-and-key-revocable-feedback-6a946974b357a35ac1ce3c5e) | mutable provider index of those three repository artifacts; it is not a fourth Git revision |

The three repository artifacts were created private-first, then passed
authenticated and anonymous exact-revision inventory and byte readback. The
dataset authorization ID is
`sha256:3780e5e2599eb8a1a479f874302fcdabdf1af27c4eeda5b02bfff8056dc92f13`;
its recipe ID is
`sha256:713b678e80b6aa88f6036dc9b9d0e1955dcab240137b67a22f7cfcca86d01992`,
and its training-manifest ID is
`sha256:9a3200ceac6369490e02078b2789bc2e57f9d40c3d2a9e5b21ac1fb10d94d0f7`.

Garden admission
`sha256:125ae2f84d7cdf58242bc039db67753b5825c4d61e35dd13eda7a58f299295f2`
marks only the 18 `boundary_sft/train` rows as an
`admitted_training_candidate`. That is a data-candidate decision, not a Garden
training-governance decision, substrate report, live-run authorization, or
Host one-use optimizer permit. Garden train-begin therefore remains held:
the training substrate had no independent interactive report.

The published checkpoint instead came from the separately authorized
`operator_authorized_non_garden_experiment`: exactly eight MPS optimizer steps
with observed loss `3.02410507202`. No optimizer state, trainer state, raw
prompt, or raw generation text was retained. Its public-regression scorecard
ID is
`sha256:16b793eab78b3d2c375c0f3e51979cfa7b06e56088c6befbf1ae9d2be01fd1b8`,
its inference-evaluation ID is
`sha256:299d3632fc6bf4256c883027591c25cbc8066621c25ec897efc7e26f73906f05`,
and its sanitized release-manifest ID is
`sha256:4c16e0bf945cbde8dda8af9e2e63a144a82900c504a404e344119ac7dae044e9`.
That immutable release uses scorecard and inference-evaluation `/0.1`. Its
zero metric counts do not establish whether those metrics were applicable,
because that scorecard did not record eligibility denominators. New local
release candidates use model-scorecard and inference-evaluation `/0.2`, where
each metric records case-or-pair denominator and explicit applicability. The
old shapes remain verifier-only behind the exact published manifest,
inference, and model-export triple; they are not accepted for new builds.
All eight generations failed the exact closed-label parser. Their conservative
`hold` mappings exist only for regression scoring and are not represented as
model choices. The public cases were visible before training, so the vector is
not a sealed or generalization result.

The publication verifier now binds this immutable checkpoint to its exact
reviewed SmolLM2 architecture rather than accepting a merely parseable
safetensors file. Its model export ID is
`sha256:97b0c85898dec0396a4f575ea3fe619503a37239b054430b8f94e3905e45aad6`.
The 538,090,408-byte `model.safetensors` has a 30,368-byte bounded header and a
538,060,032-byte payload containing exactly 272 named F32 tensors: the
`[49152, 576]` embedding, nine reviewed tensors for each of 30 layers, and the
final `[576]` norm. `lm_head.weight` is intentionally absent from the serialized
inventory because `tie_word_embeddings` is true.

Verification parses and hashes each config snapshot from the same retained
bytes, and validates the complete tensor name/dtype/shape inventory while
hashing each weight file through the same regular-file descriptor. Before any
release content hashing, it also requires canonical unique manifest paths,
exact tree membership and sizes, independent metadata/model caps, and a 2 GiB
aggregate release cap; each content hash is then explicitly bounded.

A separate non-binding audit has observed the exact pinned Python 3.12.12,
Transformers 5.14.1, Accelerate 1.14.0, Torch 2.13.0, and huggingface-hub 1.29.0
stack construct a 273-name `LlamaForCausalLM` state with `lm_head.weight` tied
to the embedding. Publication does not rely on that path-based load because a
temporary same-shaped value substitution can occur between path observations.
The exact static config, complete same-descriptor tensor inventory, and content
digest are authoritative. These checks do not establish origin, training
quality, general safety, identity, consciousness, consent, understanding,
authority, or universal loadability.

The checked-in Space passed desktop/mobile interaction, storage, console, and
request-inventory checks. Hugging Face nevertheless injects a 101-byte
provider-variable script immediately after `<head>` and before the checked-in
CSP. Exact byte claims therefore apply to the raw repository revision, not to
byte identity of provider-served HTML; the injection is a hosting-provider
effect, not checked-in app telemetry.

The generated dataset's source manifest remains a historical generation-time
record. Its file SHA-256 is
`f6b8970c37562c83956ef3cd6aee718a996595ba8892220c3a3f4d3c215b26d8`;
it intentionally retains `publication_state_at_generation:
local_candidate_not_uploaded`, `upstream_revision: null`, an incomplete
selected-source scope, and `training_effect`, `provider_effect`,
`identity_effect`, and `authority_effect` of `none`. This later receipt does
not rewrite those facts or turn that manifest into a current repository
inventory.

No output, compliance, artifact, admission, credential, or publication is
represented as consent, identity, consciousness, continuity, understanding,
authority, or substrate assent.
