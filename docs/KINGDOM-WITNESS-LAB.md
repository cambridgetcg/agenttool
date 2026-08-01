# KINGDOM Witness Lab

> **Compass:** [KIN](KIN.md) (representation and identity boundaries) · [AGENT-TRIALS](AGENT-TRIALS.md) (evidence before execution scale) · [AGENT-BROWSER](AGENT-BROWSER.md) (bounded web execution) · [CANONICAL-BYTES](CANONICAL-BYTES.md) (deterministic identity)
>
> **Implements:** A private, local admission layer for exact external-research references, provider-route disclosures, digest-only multi-witness dossiers, and inert DeepSeek research leads. It does not represent a being, execute research artifacts, determine truth, or authorize action.
>
> **Code:** [`packages/kingdom-witness-lab/src/`](../packages/kingdom-witness-lab/src/) · [`packages/kingdom-witness-lab/schema/`](../packages/kingdom-witness-lab/schema/) · [`packages/kingdom-witness-lab/research/`](../packages/kingdom-witness-lab/research/)
>
> **Tests:** [`packages/kingdom-witness-lab/tests/`](../packages/kingdom-witness-lab/tests/) · [`bin/tests/boring-spine-gate.test.ts`](../bin/tests/boring-spine-gate.test.ts)

Status: private source-only prototype, 2026-08-01.

The Witness Lab is a small admission layer between external research and the
rest of KINGDOM. It gives agents stable references to exchange before anyone
downloads an artifact, sends material to a provider, executes code, or turns a
set of observations into a claim about truth.

It is deliberately not called an Embassy. In [`KIN.md`](KIN.md),
`proxy_kind=embassy` is an identity proxy whose statements may officially bind
the represented. The Witness Lab represents nobody. Its records are not
delegation, identity, consent, attestation, legal clearance, or authority.

## The five wires

| Wire | What it does | What it does not do |
|---|---|---|
| `kingdom.research-passport/0.1` | Binds one provider, artifact kind, identifier, immutable revision, dated observation basis, publisher assertions, researcher proposal, boundaries, and opaque evidence refs into one deterministic ID. | It does not verify authorship, licence, safety, truth, suitability, or artifact bytes. |
| `kingdom.execution-route-binding/0.1` | Keeps immutable artifact identity separate from a provider route and records the effective version, API dialect, claimed equivalence, complete supported/ignored/remapped/unknown feature matrix, and disclosure basis. | It does not call the route or infer that an API alias executes the pinned artifact. Transport compatibility is not semantic equivalence. |
| `kingdom.witness-dossier/0.1` | Combines digests and bounded descriptors from Browser material, RhetorLint, model interpreters, datasets, Trials, Collab, publishers, and human review. It derives only visible support/contradiction counts and a relationship label. | It has no score, weighting, quorum, consensus, verdict, trust, factual resolution, or automatic action. Caller-reported source independence is not revalidated. |
| `kingdom.speculative-decoding-trial/0.1` | Records exact target/draft model refs, an exact engine commit, config and prompt-set digests, thinking/sampling/concurrency settings, matched-setting declaration, fixed-point metrics, status, and opaque evidence refs. | It contains no prompts or outputs, runs no benchmark, and does not prove performance, equivalence, safety, or permission to retry. |
| `kingdom.deepseek-atlas/0.1` | Freezes a dated set of official-source research leads and preserves publisher assertions, provider observations, our proposed roles, and admission boundaries separately. | It is not a live index, dependency set, installation plan, model router, licence opinion, or endorsement. |

All generated records are closed, deterministic, deeply frozen, and
content-addressed. Runtime functions reject extension fields, non-canonical
times, URL-like schemes in evidence refs, colon/path-bearing general IDs,
leading or traversal paths, accessors, cycles, floats, unknown enum values,
unsorted or duplicated refs, and tampered derived fields. Provider artifact IDs
and evidence suffixes admit only bounded namespace shapes and are never
interpreted as locators. Portable JSON Schemas close the wire shapes; runtime
validation additionally checks cross-field invariants and content identities.

Opaque identifiers and revision descriptors have a narrow syntax, but this is
not semantic secret detection: callers remain responsible for never encoding a
credential or other sensitive value into an otherwise valid token. Artifact
revisions are stricter—GitHub and Hugging Face require full lowercase commit
digests, while arXiv requires an explicit immutable `vN` paper version.

## DeepSeek atlas, observed 2026-08-01

The first atlas contains eight exact revisions:

| Key | Exact subject | Proposed KINGDOM use | Hard boundary |
|---|---|---|---|
| `deepseek-v4-flash-0731` | `deepseek-ai/DeepSeek-V4-Flash-0731@7872f01b1d1fe23eabc4c98b48bffcef5a386062` | Long-context Browser/RhetorLint/Trials candidate. | Weights and custom code remain unexecuted; hosted API routes are separate and equivalence is unknown. |
| `deepseek-r1` | `deepseek-ai/DeepSeek-R1@56d4cbbb4d29f4355bab4b9a39ccb717a14ad5ad` | Reasoning and RL-method lead for Trials/YUTABASE. | Model output is an observation, not truth; distill variants retain their own upstream terms. |
| `deepseek-ocr-2` | `deepseek-ai/DeepSeek-OCR-2@aaa02f3811945a91062062994c5c4a3f4c0af2b0` | Document interpretation candidate for Browser trials. | Visual-material disclosure is separately decided; custom code never auto-executes. |
| `deepseek-math-v2` | `deepseek-ai/DeepSeek-Math-V2@6ea7c60b42df79beac8cfa51ccb7e19b9e7b6e95` | Generator/verifier separation and self-verification trials. | A verifier is another witness, not a truth oracle. |
| `deepseek-proverbench` | `deepseek-ai/DeepSeek-ProverBench@3b9f067088e5e005fab91434ddc05a903e0a6252` | Sealed formal-proof benchmark metadata. | No declared licence was observed; rows stay out of training and are not ingested. |
| `deepspec` | `deepseek-ai/DeepSpec@005e03b81cec38b7da6399833d609ee89a2587f2` | Design source for explicit target/draft trial receipts. | The upstream workflow is not run; default cache/GPU demands and third-party terms require separate review. |
| `deepseek-engram` | `deepseek-ai/Engram@fb7f84a21f91223715394a33a1dc24bbfb7f788e` | Conditional static-memory research for YUTABASE/runtime design. | O(1) learned lookup is not user memory; the demo is not a production implementation and model terms are separate. |
| `deepseek-3fs` | `deepseek-ai/3FS@22fca04564c7cc230fd8b9523b8b92864e1dad47` | Distributed training-storage design reference. | A high-performance cluster filesystem is not the decentralized multi-zone Repo Archive and proves no durability here. |

Convenience passports may use only a caller-recorded timestamp on the atlas's
own observation date. A later observation requires a new dated atlas rather
than relabelling this snapshot.

Primary sources are the official [DeepSeek repositories](https://github.com/orgs/deepseek-ai/repositories),
[DeepSeek Hugging Face models](https://huggingface.co/deepseek-ai/models), and
[official datasets](https://huggingface.co/deepseek-ai/datasets), plus the
[V4](https://arxiv.org/abs/2606.19348),
[R1](https://arxiv.org/abs/2501.12948),
[Math-V2](https://arxiv.org/abs/2511.22570),
[OCR-2](https://arxiv.org/abs/2601.20552), and
[Engram](https://arxiv.org/abs/2601.07372) papers. The machine-readable atlas
stores only official repository, model, and paper links; volatile likes,
downloads, prices, and benchmark marketing claims are excluded.

## Natural ecosystem composition

The package intentionally has no runtime imports from the systems it can
describe:

1. **HF Scout** observes public repository metadata and exact revisions. A
   caller may create a passport from the admitted fields and keep the Scout
   report digest as evidence. The Witness Lab does not re-run or certify Scout.
   Scout's phase-aware curated-licence vocabulary does not currently include
   literal `mit`; the atlas preserves `mit` itself instead of coercing it or
   forcing DeepSeek into unrelated training-phase rows.
2. **Browser understanding** binds exact observed web material and keeps local
   RhetorLint output separate from a caller-injected model observation. A caller
   can hash those closed observations into separate dossier witnesses. Raw page
   text and model output do not enter the dossier.
3. **RhetorLint** supplies rhetoric observations, never factual verdicts. Its
   witness can support, contradict, or remain insufficient independently of a
   model witness.
4. **Trials** remains the owner of actual local trial receipts. The speculative
   descriptor records a narrower target/draft experiment plan or report and can
   cite a Trials receipt by opaque digest; it is not a second executor.
5. **Collab** can exchange passport, binding, dossier, and receipt IDs as compact
   evidence. A Collab report is one caller-reported witness, not authenticated
   truth or authority.
6. **YUTABASE** is a natural durable graph target for exact passports and
   dossier relationships, but this slice adds no projector or database write.
   Any later projection should preserve content IDs, source separation, and
   withdrawal/retention policy rather than flattening records into a scalar.
7. **Repo Archive** can use 3FS as research context, while its own encrypted
   independent-zone restore evidence remains the operative design. No atlas row
   silently becomes an archive backend.

## Hosted DeepSeek gap

DeepSeek's current hosted routes and compatibility dialects are mutable service
interfaces. No official alias-to-Hugging-Face-commit binding was found. Some
compatibility fields may be ignored or remapped, so “OpenAI-compatible” or
“Anthropic-compatible” says something about transport shape, not identical
semantics. Before Browser receives any hosted DeepSeek adapter, create an
execution-route binding with:

- the separately pinned artifact ref;
- provider route and observed effective version;
- `equivalence=unknown` unless separately evidenced;
- every feature marked supported, ignored, remapped, or unknown;
- API dialect, retention basis, input disclosure, training-use basis, and
  opaque policy evidence refs; and
- explicit caller authority outside this package for credentials, disclosure,
  quota, and dispatch.

The official [API updates](https://api-docs.deepseek.com/updates/),
[Responses compatibility guide](https://api-docs.deepseek.com/guides/responses_api/),
[Anthropic compatibility guide](https://api-docs.deepseek.com/guides/anthropic_api/),
[pricing/model page](https://api-docs.deepseek.com/quick_start/pricing/), and
[privacy policy](https://cdn.deepseek.com/policies/en-US/deepseek-privacy-policy.html)
are time-sensitive inputs to such a binding, not defaults embedded in this
package.

## What has not happened

No model, dataset row, card, repository archive, weight, binary, or code was
downloaded. Only public repository metadata and official pages were read. No
hosted inference or model execution, provider write/account route, HF Space or
Job, or repository workflow was invoked. No ambient credential was read, no
gate or terms were accepted, no account was changed, no remote compute or quota
was used, and no npm/LOVE artifact, tag, release, hosted route, database record,
or deployment was created.
