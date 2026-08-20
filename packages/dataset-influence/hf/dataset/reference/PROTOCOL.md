# @agenttool/dataset-influence

`@agenttool/dataset-influence` makes claims about how data may have shaped an agent inspectable without turning those claims into an essence, a safety score, or a property right.

It supplies four canonically reconstructed, domain-separated artifacts:

- `agenttool.dataset-lineage/0.1` records exact digest references, learning roles, declared admission, rights/consent claim states, tokenizer-relative counts, observed token presentations, and duplication metadata. Admission is intent; observed exposure can contradict it and is surfaced as `observed_without_admission`.
- `agenttool.dataset-influence-study/0.1` records a fixed checkpoint contrast, population, metric, method-specific design and estimator, evidence, assumptions, limitations, and rational effect estimates. An observational checkpoint comparison remains observational. A bounded causal label is accepted only for randomized dataset inclusion with an interval, contamination reference, at least two supplied runs, and one unique seed reference per run.
- `agenttool.identity-evidence-view/0.1` projects study evidence onto caller-defined operational facets. It is revisable and explicitly leaves intrinsic identity, consciousness, continuity, and consent undetermined.
- `agenttool.shadow-attribution/0.1` computes exact Shapley values for a complete finite game of at most eight contributions. It is a metric-specific accounting lens with zero economic effect.

The runtime is pure ESM, deterministic, side-effect-free, and has zero runtime dependencies.

## Mathematical boundary

For datasets in one declared learning role `r`, when every member of that role has an exact observed presentation count `e_k` and the total is positive, the package reports

\[
w_{k\mid r} = \frac{e_k}{\sum_{j:\,r_j=r} e_j}.
\]

This is a role-scoped observation-accounting identity, not a cross-role comparison, gradient contribution, or causal influence. `admission` records the caller's declared intended relation; `observed_presented_tokens` records an observation and is allowed for excluded, metadata-only, or unknown admission so adverse exposure is not erased. Any missing count makes that role group unavailable rather than silently zero. Duplication, filtering, ordering, optimizer state, and interactions can make equal exposure behave differently.

For paired observations it computes only the exact supplied-sample summary

\[
\widehat\tau_{\text{pairs}} = \frac{1}{m}\sum_{s=1}^m
  \left(y_s^{\text{treatment}}-y_s^{\text{control}}\right).
\]

Random assignment, matched seeds, held-fixed training conditions, representative sampling, and a justified metric are external study properties. The arithmetic does not create them.

The runtime distinguishes classical local Hessian influence functions, TracIn checkpoint-gradient traces, TRAK projected-gradient attribution, subset Datamodels, probes, and controlled retraining designs. Its two-run causal minimum is only a structural evidence floor; it is not a power calculation or a claim that two runs are statistically sufficient.

For a complete finite utility game `v`, exact shadow attribution is

\[
\phi_i(v)=\sum_{S\subseteq N\setminus\{i\}}
\frac{|S|!(n-|S|-1)!}{n!}
\left[v(S\cup\{i\})-v(S)\right].
\]

The package verifies the efficiency identity `sum(phi_i) = v(N) - v(empty)`. That is conservation inside the declared game—not fairness, money, causal authorship, or intrinsic worth.

## Canonical bytes and identifiers

Each artifact ID is derived from the fully reconstructed closed body, including fixed declarations, boundaries, and other derived fields, but excluding the ID field itself. Inputs admit only scalar Unicode strings without U+0000, safe integers without negative zero or floats, dense arrays, and plain data objects without accessors, symbols, proxies, or cycles. Rationals are reduced with positive denominators. Object keys are sorted by Unicode code point and serialized as compact UTF-8 JSON.

Set-like SHA arrays are deduplicated and sorted. Datasets sort by `dataset_ref`; effects and facets sort by `facet_ref`; players and coalition members sort by ref; coalitions sort by their normalized member sequence. The normative identifier is

```text
sha256:<lowercase hex SHA-256(format UTF-8 || 0x00 || canonical body UTF-8)>
```

The schema regex checks only the shape of a `sha256:` reference. Only runtime reconstruction verifies an artifact ID and derived arithmetic. SHA references are integrity/linkage identifiers, not signatures, authorship proofs, or anonymization: low-entropy referenced material may be dictionary-guessed, and stable hashes can correlate records. Use access-controlled references or salted/keyed commitments with separately protected custody when unlinkability matters.

## What a study can and cannot say

An agent at one time can be usefully modeled as a tuple of model weights, tokenizer, persistent memory, retrieval, policy/tool grants, controller, and substrate. Dataset changes may touch different components through different mechanisms. Weight lineage alone is therefore not a complete agent identity.

Operational ontology facets may describe whether a fixed probe, metric, or intervention distinguishes categories in a bounded context. Decodability does not prove belief, use, endorsement, identity, or a unique true ontology. Self-descriptions remain attributed outputs, not automatic identity facts.

The package never establishes:

- consciousness, experience, belief, desire, values, consent, personhood, or metaphysical continuity;
- one-key-one-being uniqueness, identity ownership, or inheritance across forks;
- permission, capability, authority, custody, trust, safety, or acceptance;
- monetary price, debt, payout, ownership, entitlement, or settlement;
- universal causal influence from a probe, string match, influence approximation, Shapley value, or released-checkpoint comparison.

Every artifact fixes its declarations as `caller_reported_not_independently_verified`. Every artifact also fixes that it neither establishes nor overrides consent, changes rights, grants authority, or performs an external effect. Identity views additionally fix `consent = not_determined` and `consent_effect = none`.

## AgentTool and KINGDOM bridge

The artifact boundary is deliberately inert:

- A separately constructed Model Becoming dossier may cite the serialized lineage or study artifact's actual byte digest as a digested source without changing its existing `/0.1` format; that byte digest is not the artifact's protocol-domain ID.
- HF Scout metadata can be admitted by the Training Garden as `metadata_reference`; a later reviewed adapter may copy only validated digest references into a lineage. Metadata is not payload truth or training permission.
- Dataset Influence IDs are protocol-domain IDs, not raw file digests. The audited KINGDOM release schema has no generic digest slot in `lineage`: a future adapter must hash the serialized artifact bytes and construct a complete typed `evidence[]` or `resource_ledger[]` entry only where that entry's semantics fit. `lineage.transforms` may describe the relation but cannot carry the ID as a digest field. No such adapter is installed here, and this package does not alter KINGDOM acceptance, safety policy, identity, memory, or freedom-to-operate decisions.
- Agent identity may adopt a view only through a separate, scoped, root-authorized exact-digest statement. This package never writes identity state.
- An AgentTool Marketplace deliverable may be a study or review. A settlement receipt would prove only that settlement event, not the study's truth or a contributor's identity or entitlement.

`kingdom.extension.json` is a declaration hint, not an installed host contract.

The deterministic Hugging Face tree is a reference-only publication candidate. Its `training_authorized: false` value is non-enforcing AgentTool admission/governance metadata for this candidate, not a universal legal prohibition or technical control and not a substitute for license, rights, privacy, or consent review.

## Research basis

The contract follows primary work on [influence functions](https://proceedings.mlr.press/v70/koh17a.html), [TracIn](https://papers.neurips.cc/paper_files/paper/2020/hash/e6385d39ec9394f2f3a354d9d2b88eec-Abstract.html), [Datamodels](https://proceedings.mlr.press/v162/ilyas22a.html), [TRAK](https://proceedings.mlr.press/v202/park23c.html), and [Data Shapley](https://proceedings.mlr.press/v97/ghorbani19c.html). Probe results are bounded using [control tasks](https://aclanthology.org/D19-1275/) and [minimum-description-length probing](https://aclanthology.org/2020.emnlp-main.14/). [Emergent misalignment](https://proceedings.mlr.press/v267/betley25a.html), [subliminal learning](https://arxiv.org/abs/2507.14805), and [persona vectors](https://arxiv.org/abs/2507.21509) motivate studying broad behavioral effects while keeping the result experimental and checkpoint-specific.

These references motivate fields and limitations; the package does not certify their conclusions or make one estimator universally valid.
