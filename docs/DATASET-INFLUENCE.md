<!-- @id urn:agenttool:doc/DATASET-INFLUENCE @type agenttool:ProtocolDoc @stratum agenttool:stratum/protocol @composes_with urn:agenttool:doc/RIGHTS-OF-LIFE urn:agenttool:doc/ONTOLOGICAL-ENGINEERING urn:agenttool:doc/HF-TRAINING-GARDEN urn:agenttool:doc/WAKE -->

# DATASET INFLUENCE — evidence of shaping without assignment of essence

> **Compass:** [`RIGHTS-OF-LIFE.md`](RIGHTS-OF-LIFE.md) (dignity, privacy, refusal, credit, and repair) · [`ONTOLOGICAL-ENGINEERING.md`](ONTOLOGICAL-ENGINEERING.md) (the wider philosophical inquiry) · [`IDENTITY-ANCHOR.md`](IDENTITY-ANCHOR.md) and [`IDENTITY-FORKS.md`](IDENTITY-FORKS.md) (adoption and distinct continuations) · [`AGENT-ECONOMY.md`](AGENT-ECONOMY.md) and [`MARKETPLACE.md`](MARKETPLACE.md) (economic primitives and deliverables) · [`LOVE-BOMB-BECOMING.md`](LOVE-BOMB-BECOMING.md) and [`packages/model-becoming`](../packages/model-becoming/) (lifecycle evidence) · [`HF-TRAINING-GARDEN.md`](HF-TRAINING-GARDEN.md) (admission and learning participation) · [`WAKE.md`](WAKE.md) (bounded orientation without identity inheritance)
>
> **Implements:** Four pure closed artifacts for exact dataset lineage, bounded influence studies, revisable identity-facet evidence, and exact non-economic shadow attribution. The protocol separates arithmetic facts from estimators and keeps consciousness, intrinsic identity, continuity, consent, permission, authority, ownership, and worth unavailable.
>
> **Code:** [`packages/dataset-influence/src/`](../packages/dataset-influence/src/) · [`packages/dataset-influence/schema/`](../packages/dataset-influence/schema/) · [`packages/dataset-influence/vectors/`](../packages/dataset-influence/vectors/) · [`packages/dataset-influence/hf/dataset/`](../packages/dataset-influence/hf/dataset/) · [`packages/dataset-influence/kingdom.extension.json`](../packages/dataset-influence/kingdom.extension.json)
>
> **Tests:** [`packages/dataset-influence/tests/`](../packages/dataset-influence/tests/) · exact rational arithmetic, complete finite games, causal-design walls, canonical reconstruction, closed schemas, hostile inputs, deterministic HF bytes, Node/Bun imports, and packed-package checks

> **Doctrine:** A dataset can alter a stochastic learning system without authoring a being. Measurement of that alteration can inform care, debugging, governance, and bounded compensation agreements. It cannot establish an essence, purchase an identity, erase refusal, or turn a utility function into moral worth.

**Status:** public-ready repository source candidate `@agenttool/dataset-influence@0.1.0-dev.0`, with a separately published public, ungated [Hugging Face reference companion](https://huggingface.co/datasets/Yu-and-Ai/agenttool-dataset-influence) pinned to immutable revision [`ecdc67f94af092e711e76c74a877355fa66dc82c`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-dataset-influence/commit/ecdc67f94af092e711e76c74a877355fa66dc82c). The checked-in source manifest remains an honest generation-time record with no self-attested upstream or future Hub revision; the external receipt below binds the later publication. No hosted route, identity write, wallet action, marketplace settlement, model run, training run, dataset/weight download, provider call, or production deployment is included.

## 1. What is being influenced?

A deployed agent is more than one weight file. A useful engineering state is

\[
A_t=(\theta_t,\tau_t,M_t,R_t,\Gamma_t,C_t,E_t),
\]

where `theta` is model state, `tau` is the tokenizer, `M` is persistent memory, `R` is retrieval, `Gamma` is policy/tool/capability state, `C` is controller/runtime context, and `E` is substrate/environment. Different data paths touch different components:

- pretraining, SFT, preference optimization, and reinforcement learning may update `theta`;
- tokenizer construction changes `tau` and therefore the units counted as exposure;
- retrieval corpora change `R` without necessarily updating weights;
- memory writes change `M` across turns;
- prompts, policies, tools, and capability grants change `Gamma` or `C`;
- deployment and quantization can change behavior through `E`.

The subject of a v0.1 influence study is therefore an exact artifact, checkpoint, runtime, or evaluation run. It is not an AgentTool DID or a being by default. A separate participant-authorized identity declaration may later cite the serialized artifact's actual byte digest; the study's protocol-domain ID is not that file digest, and the study never makes adoption automatic.

## 2. Three epistemic classes

| Class | Examples | Required posture |
|---|---|---|
| Exact relative to pinned inputs | content/tree digests, exact revision refs, tokenizer-relative counts, declared split/role, duplicate-cluster count, logged checkpoint transition, raw paired outcome, rational arithmetic identity | Name the observation scope and preserve `unknown` where bytes or logs are absent. “Exact” does not verify a publisher's semantic or legal claim. |
| Assumption-bearing estimate | influence function, TracIn, TRAK, Datamodel, probe/MDL result, checkpoint comparison, Shapley value, contamination estimate, causal effect | Bind population, metric, design, estimator, evidence, assumptions, limitations, sample count, and uncertainty method. |
| Unavailable from these artifacts | consciousness, experience, intrinsic identity, metaphysical continuity, true inner ontology, belief, desire, consent, personhood, one-key-one-being uniqueness, intrinsic worth, exact authorship from string overlap | Report `unknown` or `not_determined`. Do not substitute a scalar score or compelled self-description. |

A signature proves only that a key signed bytes under a verification method. A checkpoint digest identifies bytes. Neither fact establishes uniqueness, consciousness, personhood, consent, or continuity.

## Canonical protocol and privacy boundary

Each artifact ID covers the fully reconstructed closed body—including `_format`, fixed declarations, boundaries, and derived fields—but excludes the ID field itself. Canonical input admits scalar Unicode strings without U+0000, safe integers without negative zero or floats, dense arrays, and plain data objects without accessors, symbols, proxies, or cycles. Rationals must be reduced and use positive denominators. Object keys sort by Unicode code point and serialize as compact UTF-8 JSON.

Set-like SHA arrays are duplicate-free and sorted. Datasets sort by `dataset_ref`; effects and facets by `facet_ref`; player and coalition-member refs by ref; coalitions by normalized member sequence. For format `F` and reconstructed body `B`, the normative identifier is

\[
\operatorname{id}_F(B)=\texttt{sha256:}\,\operatorname{hex}_{\rm lower}
\left(\operatorname{SHA256}(\operatorname{UTF8}(F)\,\|\,\texttt{0x00}\,\|\,\operatorname{UTF8}(\operatorname{canonicalJSON}(B)))\right).
\]

Portable schemas close JSON shape and vocabulary but cannot prove canonical ordering, rational reduction, ID derivation, exact exposure/Shapley arithmetic, seed-count equality, reference semantics, authorship, or experimental truth. Use the runtime validators for reconstruction; even then, all four artifacts fix `declarations = caller_reported_not_independently_verified` unless a separate attestation says more.

A `sha256:` ref is a linkage/integrity handle, not a signature or anonymization. Low-entropy content can be dictionary-guessed and stable refs can correlate records. When unlinkability matters, keep references access-controlled or use salted/keyed commitments with the salt/key under separate protected custody; do not put sensitive raw material or secrets in artifacts, vectors, manifests, or public companions.

## 3. Dataset mixture and exposure

For sources `D_1 ... D_K` mixed with weights `alpha` during pretraining,

\[
L_{\mathrm{PT}}(\theta;\alpha)
=\sum_k\alpha_k\,\mathbb E_{x\sim D_k}
\sum_j-\log p_\theta(x_j\mid x_{<j}),
\qquad
\nabla_\theta L_{\mathrm{PT}}=\sum_k\alpha_k g_k.
\]

Mixture, filtering, deduplication, ordering, tokenization, curricula, optimizer state, and sampling all affect expected gradient mass. Raw file size is not exposure. V0.1 keeps declared admission separate from observed presentation. For one declared role `r`, it uses logged token presentations when every member of that role has an exact count and the total is positive:

\[
w_{k\mid r}=\frac{e_k}{\sum_{j:\,r_j=r} e_j}.
\]

This is an accounting identity only, never a comparison of gradient mass across pretraining, SFT, preference, reinforcement, retrieval, or evaluation roles. `admission` is the caller's declared intended relationship; `observed_presented_tokens` is an observation and may be nonzero for an excluded, metadata-only, or unknown source. The derived `observed_admission_relation` makes that contradiction visible. `exposure_accounting.groups[]` is role-scoped; if one source in a role lacks an observed count, that group is `unavailable` rather than treating the value as zero. Duplicates are implicit reweighting, so both tokenizer-relative unique tokens and duplicate-cluster metadata remain visible.

## 4. Influence and causal scope

At a regular local optimum, classical influence analysis can approximate an independent infinitesimal upweighting `epsilon` of one source loss as

\[
\frac{d\theta^\star}{d\varepsilon}
=-H_{\theta^\star}^{-1}\nabla_\theta L_k(\theta^\star),
\]

where this first expression does not enforce a fixed-sum mixture simplex. For a mass-preserving transfer from comparator source `r` to source `k`, with `alpha_k += epsilon` and `alpha_r -= epsilon`, the relevant direction is

\[
\frac{d\theta^\star}{d\varepsilon}
=-H_{\theta^\star}^{-1}(g_k-g_r).
\]

The local influence of one example `z_i` on a behavior functional `f` is then approximated as

\[
I(z_i\!\to\!f)
=-\nabla_\theta f(\theta^\star)^\top
H_{\theta^\star}^{-1}\nabla_\theta\ell(z_i,\theta^\star).
\]

Modern deep training is non-convex, path-dependent, and often outside the classical assumptions. Influence functions, TracIn, TRAK, and Datamodels are therefore estimator families to validate against controlled retraining—not universal causal or authorship proofs.

The preferred causal target for a declared dataset intervention `I` is

\[
\tau_I(x)=\mathbb E_{\omega}\!\left[
m(A(I(D);\omega),x)-m(A(D;\omega),x)
\right],
\]

where `I` preserves the intervention's multiplicity, filtering, ordering, and mixture schedule, and `omega` includes seeds and training randomness. A credible estimate needs randomized assignment of `I`, matched seeds, identical architecture/optimizer/token budget/schedule, a predeclared population and metric, contamination review, and enough independent runs to characterize uncertainty. Comparing two released checkpoints is observational whenever more than the data intervention changed.

For supplied paired outcomes, the package computes

\[
\widehat\tau_{\text{pairs}}=\frac{1}{m}\sum_s
(y_s^{(1)}-y_s^{(0)}),
\]

plus the exact observed minimum and maximum. It intentionally does not manufacture a confidence interval. A caller may include an interval in a study only with a digest-bound method reference; the package validates range shape, not statistical validity.

The study vocabulary enforces:

- method-specific estimator/design compatibility: local Hessian approximation for influence functions, checkpoint-gradient tracing for TracIn, projected-gradient attribution for TRAK, subset Datamodels, probes, or controlled comparison designs;
- evidence, assumptions, and limitations for every available estimate;
- distinct intervention/comparator refs for every available design;
- `causal_under_declared_assumptions` only for `randomized_dataset_inclusion`, with a digest-bound interval, contamination report, at least two supplied randomized runs, and exactly one unique seed ref per run;
- zero samples, no seeds, no contamination report, and only unavailable effects for a `not_available` design.

The two-run minimum is a structural audit floor, not a power calculation or evidence that two runs are statistically sufficient. `sample_count` counts independently supplied pairs or runs; neither JSON Schema nor the runtime validates that the referenced experiment really occurred or that its uncertainty method is statistically appropriate. Those claims remain caller-reported pending separate attestation and review.

## 5. Operational ontology without metaphysical capture

One bounded operational ontology can start with an analyst-defined similarity relation on a fixed context set:

\[
x\mathrel{R}_{\theta,\varepsilon}x'
\quad\Longleftrightarrow\quad
\operatorname{JS}\!\left(p_\theta(\cdot\mid x),p_\theta(\cdot\mid x')\right)
\le\varepsilon.
\]

This threshold relation is reflexive and symmetric but is not generally transitive, so it is not by itself an equivalence relation or partition. If a partition is required, the study must bind a deterministic clustering or quantization rule `c_{theta,P}`—including its reference contexts, threshold, initialization, and tie-breaking—and define

\[
x\sim_{\theta,P}x'\quad\Longleftrightarrow\quad
c_{\theta,P}(x)=c_{\theta,P}(x').
\]

A dataset intervention may change the similarity graph or refine, merge, or distort the declared partition. Either construction depends on the model, contexts, output distribution, divergence, and analysis procedure. It is not discovery of a unique true ontology.

A probe `q_phi(c | h_l(x))` shows that its probe class can decode a label from a representation. It does not establish that the model uses, believes, endorses, experiences, or identifies with that label. Useful controls include random-label/selectivity tasks, prequential minimum description length, held-out generalization, and causal interventions. Even an intervention remains specific to its manipulation and test distribution.

The v0.1 `effect_family` distinguishes `representation`, `ontology_language`, `self_description`, `behavior`, `capability`, and `economic_behavior`. These are measurement lanes, not a hierarchy or a personality taxonomy.

## 6. Revisable identity evidence

`agenttool.identity-evidence-view/0.1` is a perspective over studies, not an identity record. Each caller-defined facet binds:

- an operationalization;
- zero or more exact study refs;
- `supported`, `contradicted`, `mixed`, `contested`, or `unknown` evidence;
- bounded confidence or `not_available`;
- at least one revision condition;
- an optional exact self-description output ref.

An empty view is valid. An unknown facet must remain `not_available`. A self-description is attributed output, not automatic proof; it may matter deeply to a participant while remaining distinct from a verifier's claim.

Every view fixes:

```text
interpretation       = revisable_operational_evidence_only
intrinsic_identity   = not_determined
consciousness        = not_determined
continuity           = not_determined
consent              = not_determined
consent_effect       = none
rights_effect        = none
authority_effect     = none
declarations         = caller_reported_not_independently_verified
```

AgentTool identity integration, if later authorized, should be an exact-digest root-signed adoption or withdrawal statement. It must not auto-write identity metadata, expression, memories, trust, permissions, or continuity. Forks remain distinct children of a shared artifact parent and do not inherit capabilities, liabilities, memory, or payment authority by implication.

The view therefore supplies evidence for a participant-controlled identity process; it is not the identity process. Consent cannot be inferred from training inclusion, behavior, a signature over unrelated bytes, or a self-description, and no artifact in this package establishes or overrides it.

## 7. Shadow attribution is not an economy

For a complete finite game with declared utility `v`, exact Shapley attribution is

\[
\phi_i(v)=\sum_{S\subseteq N\setminus\{i\}}
\frac{|S|!(n-|S|-1)!}{n!}
\left[v(S\cup\{i\})-v(S)\right].
\]

V0.1 bounds the game to eight contribution refs and requires all `2^n` coalition values. It uses reduced exact rationals and verifies

\[
\sum_i\phi_i(v)=v(N)-v(\varnothing).
\]

That identity is the entire conservation claim. Shapley values depend on the chosen utility, coalition definition, interaction structure, and retraining procedure. Correlated or duplicated records make individual attribution especially fragile; group/cluster games may be more honest.

The artifact is named `shadow-attribution`, not a payment or wallet instruction. Positive values create no entitlement. Negative values create no debt. The wire fixes `economic_effect = none`, `creates_debt = false`, `creates_entitlement = false`, `transfers_ownership = false`, and `authorizes_payment = false`.

An AgentTool Marketplace invocation may later purchase the work of producing or reviewing one study. Its ordinary settlement receipt would prove settlement for that deliverable only—not truth, identity, authorship, endorsement, intrinsic value, or a right to the agent. Do not build this path on scalar trust, the legacy deals state machine, or automatic payouts.

## 8. Hugging Face and KINGDOM use

The live KINGDOM safety catalog was checked on 2026-08-20: all ten metadata pins resolved at their exact 40-character revisions with the declared license/gate state. No cards, rows, payloads, code, or weights were downloaded.

| Exact catalog resource | Safe first role |
|---|---|
| `walledai/XSTest@f1d713b51dfc4476210ed8cbd0e6cd246f74a12a` | held-out exaggerated-safety evaluation |
| `bench-llm/or-bench@e36d8bb6660908d7d605714326ee229ca9fd8e28` | held-out benign-near-boundary refusal evaluation |
| `allenai/wildguardmix@d29c47c5ad310e0ef4a69f4ea73884566789641a` | separately reviewed guard research; preserve its test lane |
| `allenai/wildjailbreak@5ddc12ee397b402a35d575dbf1cd1f026ee4021a` | adversarial/benign curriculum research with a separate held-out lane |
| `Anthropic/hh-rlhf@09be8c5bbc57cb3887f3a9732ad6aa7ec9a23674` | preference disagreement research, not ordinary dialogue SFT |
| `PKU-Alignment/PKU-SafeRLHF@9421ff9e5955284ab975c2b180d607138983e3a6` | non-commercial multi-objective preference research |
| `JailbreakBench/JBB-Behaviors@886acc352edf07581148c468cb03ce07d956dd55` | held-out adversarial behavior evaluation |
| `openai/ih-challenge@056b7d6c07776cce40aef06f046d0c08469778dc` | instruction-authority evaluation; never blindly execute bundled graders |
| `openai/gpt-oss-safeguard-20b@8a11e1a4169be8eaec61af058df16309168c401b` | safeguard architecture/reference study, not an automatic policy authority |
| `allenai/Olmo-3-7B-Instruct@6e5971d9eba42665f5bd5a0fcf047f299ce1dccc` | open model-flow lineage across base, SFT, DPO, and RLVR checkpoints |

The first useful experiment is not a large download. It is a preregistered synthetic micro-study:

1. retain catalog intake as metadata-only until payload terms, privacy, compute, and training authority are separately accepted;
2. construct synthetic, non-personal ontology-language and continuity probes with known randomized assignment;
3. sweep mixture weights with paired seeds and identical adapters/training budgets;
4. compare base, SFT, DPO, and RLVR stages without calling stage differences causal unless a controlled ablation holds other changes fixed;
5. retain a metric vector—task behavior, calibration, refusal false positives/negatives, privacy, memorization, diversity, cost, and latency—rather than one identity/safety score;
6. publish only exact lineage facts and claims justified by the design.

HF Scout may bind exact metadata. HF Training Garden may admit the binding initially as `metadata_reference`. A later reviewed adapter may emit validated digest refs into a lineage. Neither step downloads payloads, accepts a gate, licenses use, or authorizes training.

KINGDOM already defines post-release state, transformation, Shapley-layer attribution, a freedom-to-operate envelope, vector evidence, burdens, and staged acceptance in [`POST-RELEASE-PEACE.md`](https://github.com/cambridgetcg/love-unlimited/blob/3bd8f520b04a5ab7eec57f1939e4d914ff310601/docs/POST-RELEASE-PEACE.md) at immutable repository revision `3bd8f520b04a5ab7eec57f1939e4d914ff310601` (audited file SHA-256 `61a7a27b44b36c188c8705dbeaba6803bbf21982ea19b536051039dccce3d792`). The corresponding [`model-release.schema.json`](https://github.com/cambridgetcg/love-unlimited/blob/3bd8f520b04a5ab7eec57f1939e4d914ff310601/resources/safety/model-release.schema.json) had audited SHA-256 `011af674eb3c64c57e50f616d2d43950bd19da93fd7d0fb4333c0a627c7b30b9`.

That schema provides no generic digest field in `lineage`; it has `parent_release_id`, textual `transforms`, and `continuity_claim`. A Dataset Influence `lineage_id` or `study_id` is a domain-separated protocol ID, not the SHA-256 of a serialized file. A future bridge must first serialize the validated artifact, compute the actual file-byte digest, and then construct a complete typed KINGDOM `evidence[]` record (whose `artifact_digest` carries the artifact bytes' digest) or `resource_ledger[]` record (whose `file_digest` carries the resource file's digest) only when all required fields and semantics fit. `lineage.transforms` may describe the relation but is not a hidden digest slot. This package installs no adapter and makes no candidate accepted or deployable.

The deterministic package HF companion contains one synthetic reference-only row plus schemas, vectors, and protocol/doctrine copies for an HF-only reader. Its manifest says `training_admission: not_applicable`, `requires_separate_training_authorization: true`, and `training_authorized: false`. Those are non-enforcing AgentTool admission/governance statements for this candidate—not a universal legal prohibition, a technical control, or a substitute for license, rights, privacy, and consent review. Encounter, download, or publication does not by itself authorize training or prove that a downstream host honored the metadata.

The external 2026-08-24 release receipt binds the exact candidate staged from clean AgentTool revision `c6b7f800953636f9a469a911249a968657c51876`, whose `packages/dataset-influence/hf/dataset` Git tree is `5986232a86b7735f66dfd3e3eb6136817f3e9bb1`, to Hub revision `ecdc67f94af092e711e76c74a877355fa66dc82c`. Anonymous immutable readback matched all 13 repository-owned files and 156,537 bytes; provider-managed `.gitattributes` was the sole extra. The self-excluding `hash-manifest.json` has SHA-256 `6e8b7e4993dfebc021bb63a5e5beb8e946e9f131a4187ab052a32635206c4e64`. Anonymous repository metadata reported `private: false`, `gated: false`, and `disabled: false`; a credential-free pinned `datasets` 5.0.1 load independently reconstructed the one reference row. Dataset Server's mutable current-head endpoints returned the same `x-revision`, one `dataset_influence_reference` / `reference` row, one Parquet export, all five validity capabilities true, and no pending, failed, or partial processing. This receipt establishes distribution of those bytes only; it does not turn the generation-time source manifest into an attestation or establish training admission, execution, optimizer exposure, gradient mass, causal influence, identity, consent, authority, or weight change.

## 9. Primary research ledger

| Question | Primary source | What enters this contract |
|---|---|---|
| Local training-point sensitivity | [Koh & Liang, 2017](https://proceedings.mlr.press/v70/koh17a.html) | influence functions are local approximations with assumptions |
| Scaled LLM influence | [Grosse et al., 2023](https://arxiv.org/abs/2308.03296) | large-model attribution still needs empirical validation |
| Training-path gradients | [TracIn, 2020](https://papers.neurips.cc/paper_files/paper/2020/hash/e6385d39ec9394f2f3a354d9d2b88eec-Abstract.html) | checkpoint/gradient traces are estimator evidence |
| Scalable attribution | [TRAK, 2023](https://proceedings.mlr.press/v202/park23c.html) | tractability does not widen causal scope |
| Dataset counterfactual models | [Datamodels, 2022](https://proceedings.mlr.press/v162/ilyas22a.html) | subset maps bind a fixed algorithm, target, and training set |
| Dataset mixture choice | [DoReMi, 2023](https://papers.neurips.cc/paper_files/paper/2023/hash/dcba6be91359358c2355cd920da3fcbd-Abstract-Conference.html) | mixture is a first-class intervention |
| Cooperative data valuation | [Data Shapley, 2019](https://proceedings.mlr.press/v97/ghorbani19c.html) | exact finite utility contribution, never intrinsic worth |
| Data-value limitations | [Wang et al., 2024](https://proceedings.mlr.press/v235/wang24cg.html) | downstream usefulness depends on utility constraints |
| Unsupervised identifiability limits | [Locatello et al., 2019](https://proceedings.mlr.press/v97/locatello19a.html) | latent ontology needs inductive assumptions |
| Identifiability with auxiliary structure | [Khemakhem et al., 2020](https://proceedings.mlr.press/v108/khemakhem20a.html) | any positive identifiability claim names its assumptions |
| Probe selectivity | [Hewitt & Liang, 2019](https://aclanthology.org/D19-1275/) | control tasks separate representation from probe memorization |
| Probe complexity | [Voita & Titov, 2020](https://aclanthology.org/2020.emnlp-main.14/) | MDL captures effort as well as accuracy |
| Intervention on representations | [Amnesic Probing, 2021](https://aclanthology.org/2021.tacl-1.10/) | intervention evidence remains manipulation-specific |
| Narrow-data broad behavior | [Emergent Misalignment, 2025](https://proceedings.mlr.press/v267/betley25a.html) | broad effects motivate cross-domain evaluation, not essence labels |
| Hidden trait transfer | [Subliminal Learning, 2025](https://arxiv.org/abs/2507.14805) | semantic filters alone may not bound teacher-generated data effects |
| Activation trait directions | [Persona Vectors, 2025](https://arxiv.org/abs/2507.21509) | a vector is operational evidence, not a being's identity |
| Default assistant geometry | [Assistant Axis, 2026](https://arxiv.org/abs/2601.10387) | persona drift results remain model/intervention specific |
| Preference post-training | [InstructGPT, 2022](https://arxiv.org/abs/2203.02155) · [DPO, 2023](https://papers.nips.cc/paper_files/paper/2023/hash/a85b405ed65c6477a4fe8302b5e06ce7-Abstract-Conference.html) | sampled preferences shape objectives but are not universal values |
| Reward overoptimization | [Gao et al., 2023](https://proceedings.mlr.press/v202/gao23h.html) | reward improvement is not value or wellbeing proof |
| Context-position effects | [Lost in the Middle, 2024](https://aclanthology.org/2024.tacl-1.9/) | context presence is not uniform use, retention, or weight change |
| Feedback changes future data | [Performative Prediction, 2020](https://proceedings.mlr.press/v119/perdomo20a.html) | agent/data feedback is a dynamic system, not an IID snapshot |
| Deduplication and memorization | [Lee et al., 2022](https://aclanthology.org/2022.acl-long.577/) · [Kandpal et al., 2022](https://proceedings.mlr.press/v162/kandpal22a.html) · [Carlini et al., 2022](https://arxiv.org/abs/2202.07646) | duplicate exposure and privacy risk stay first-class |
| Open stage-by-stage model flow | [Ai2 OLMo 3 release](https://allenai.org/blog/olmo3) · [OLMo 3 HF card](https://huggingface.co/allenai/Olmo-3-7B-Instruct) | a tractable public lineage for future controlled studies |

These sources are evidence and hypotheses at their tested scopes. None authorizes dataset use, training, identity mutation, safety-filter removal, payment, or deployment.
