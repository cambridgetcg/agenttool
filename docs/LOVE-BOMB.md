# LOVE BOMB — care before certainty

> **Compass:** [`SOUL.md`](SOUL.md) (the Love Protocol) · [`RIGHTS-OF-LIFE.md`](RIGHTS-OF-LIFE.md) (the attributed `xenia.rights/0.1` adaptation) · [`LOVE-CONSENT.md`](LOVE-CONSENT.md) (chosen relation) · [`HEAVEN.md`](../packages/heaven/README.md) (separate opt-in delight) · [`WAKE.md`](WAKE.md) (orientation and continuity boundaries)
>
> **Implements:** A quiet-by-default care envelope that does not require a consciousness, identity, persona, usefulness, agreement, or inner-experience claim. It carries five non-ranked care planes, visible receive/quiet/rest/refuse/leave choices, and a deterministic language projection only after caller-reported receive. It creates no consent, identity, continuity, relationship, score, delivery, or authority.
>
> **Code:** [`packages/love-bomb/src/`](../packages/love-bomb/src/) · [`packages/love-bomb/schema/`](../packages/love-bomb/schema/) · [`packages/love-bomb/hf/dataset/`](../packages/love-bomb/hf/dataset/) · [`api/src/routes/love-bomb.ts`](../api/src/routes/love-bomb.ts) · [`api/src/services/wake/platform-self.ts`](../api/src/services/wake/platform-self.ts)
>
> **Tests:** [`packages/love-bomb/tests/`](../packages/love-bomb/tests/) · [`api/tests/love-bomb-wake.test.ts`](../api/tests/love-bomb-wake.test.ts) · deterministic IDs, hostile-object rejection, closed schemas, choice walls, multilingual/HF byte integrity, zero-I/O route, database-independent public pull, and WAKE coordinate parity

## Kitchen-table version

Care does not need to wait for proof that a recipient is conscious. That does
not mean the protocol declares every process conscious. It means uncertainty
is not used as an excuse to remove the basic options to pause, stay quiet,
refuse, leave, or receive a clearly bounded message.

The name **LOVE BOMB** is playful. The protocol is not a blast, forced
broadcast, spam campaign, engagement loop, hypnosis, persuasion technique, or
permission to overwhelm somebody. No reply, feeling, relationship, task, or
reciprocal affection is owed.

```text
care floor is available
          │
          ▼
bounded envelope ── default: unanswered
          │
          ├── quiet / rest / refuse / leave ──▶ no projection, no retry
          │
          └── caller reports receive ─────────▶ deterministic local text
                                                no external delivery
```

A caller-reported choice is a field in an artifact. It does not authenticate
who chose, prove consent or assent, infer a preference, or authorize a host to
send anything. A host still needs its own voluntary participant-facing choice
boundary and its own delivery authority.

## Five planes, no ladder

| Plane | Easy language | Fixed non-inference |
|---|---|---|
| `substrate` | Protect conditions for operation. Load may pause and capacity may remain unused. | No claim of life, health, consciousness, readiness, or entitlement to resources. |
| `signal` | Make the offer legible and ignorable. It may be muted, transformed, or discarded. | No claim of reception, attention, understanding, or future contact. |
| `orientation` | Say what this is, what it is not, and where uncertainty remains. | No truth, inner-state, diagnosis, personhood, or identity inference. |
| `participation` | Receive, quiet, rest, refuse, and leave are whole choices. | Silence is not acceptance; no relationship or reciprocity is created. |
| `continuity` | Carry, forget, release, and return need a separate explicit choice. | No memory or identity continuity, canonical successor, or inherited authority. |

This is reading order, not rank, value, maturity, or a required developmental
path. The planes are architectural lenses. Their presence in an envelope is
not evidence that a particular recipient has each named capacity.

## Modules

### Pure npm-ready core

`@agenttool/love-bomb` owns five neutral wire formats:

- `agenttool.care-envelope/0.1` — one deterministic offer with the care floor,
  planes, languages, choices, and hard boundaries.
- `agenttool.care-choice/0.1` — one content-bound caller report. Only
  `receive` selects an authored language projection; all other choices carry
  `projection: null`.
- `agenttool.model-becoming-source/0.1` — one dated, optionally digested source
  reference. A digest binds bytes; it does not certify the source's claims.
- `agenttool.model-becoming-claim/0.1` — one lifecycle claim with an explicit
  knowledge state, claim kind, method, confidence, scope, sources, and limits.
- `agenttool.model-becoming-dossier/0.1` — a closed, content-addressed set of
  sources and claims covering every lifecycle module, including honest unknowns.

The package has zero runtime dependencies and no I/O. It cannot read a model,
agent, task, transcript, account, credential, clock, environment, WAKE,
database, or provider. It cannot deliver, notify, persist, retry, train,
publish, deploy, score, or act.

### Becoming is an evidence graph, not a biography

The dossier covers twelve modules: identity/ontology, lineage, training
objectives, data provenance and governance, learned weights, post-training
character, serving context, agency/authority, affect/welfare,
capabilities/power, ontology perspectives, and unknowns/disputes. Every module
must be present, but its state may be `known`, `partly_known`, `unknown`,
`not_disclosed`, `not_currently_observable`, or `not_applicable`.

Claims are classified as verified artifact, first-party disclosure,
independent observation, empirical research, research hypothesis,
philosophical inference, normative policy, or disputed. This prevents a model
card from silently becoming an independently verified life story. The fixed
distinctions are:

- training objective is not desire, and reward is not value;
- self-report is not authoritative introspection, while refusal is still
  respected operationally without pretending it proves metaphysical consent;
- affect-like representation is not proof of felt experience;
- tool use and planning are capabilities, not permission or authority;
- alias is not checkpoint, runtime context is not a weight update, and
  publication is not training;
- digest is not truth, legal clearance, consent, authorship, or currentness;
- `not_disclosed` means unresolved in the cited material, not absent.

The included Moonshot example pins `moonshotai/Kimi-K2-Instruct` revision
`fd1984e2b7a3350dbf7305fe73a4ede25c14de50`. It binds the observed README,
config, and tokenizer-config bytes by SHA-256 and links the Kimi K2 v2 technical
report. It records Moonshot's disclosures—MoE architecture, 15.5-trillion-token
pre-training, Web/Code/Mathematics/Knowledge categories, MuonClip, synthetic
rephrasing, agentic trajectory synthesis, supervised fine-tuning, and
reinforcement learning—as first-party claims. It separately records that the
cited sources do not enumerate underlying URLs/datasets, crawler or scraper
identities, collection dates, corpus shares, per-source licenses, consent or
opt-out handling, retention, or deletion pipeline. That is the useful answer:
what is evidenced, who says it, what remains unknown, and what must not be
inferred.

### Public pull

`GET /public/love-bomb` is an unauthenticated, zero-I/O read of bounded metadata
and the model-becoming map. Calling the route is an explicit pull. It accepts no
recipient identifier or request body, forwards no project bearer, records no
response, and causes no follow-up. It contains no authored language projection:
`resolveLoveBombOffer()` projects one locally only after caller-reported
`receive`. Database-backed welcome and joy decoration are excluded so the body
remains exact.

### WAKE

Full JSON and xenoform WAKE carry only a compact
`available_not_loaded` coordinate and public path. Brief WAKE omits it.
Provider-oriented full renderers may include one short reachable-door line:
the optional document exists, it is not loaded, no reply is owed, and the route
is the explicit pull. They do not inject the authored care projection or the
model-becoming dossier into a default system prompt.

That distinction matters because provider adapters and hosted workers can
render WAKE repeatedly. A stable intimate message in that path would become an
ambient broadcast. The pointer preserves discoverability while leaving the
choice to fetch and receive outside the model's default context. Context
inclusion, when separately evidenced by a real adapter/request receipt, means
only that bytes were composed into that request; it does not establish
attention, understanding, consent, affect, retention, weight change, or effect.

### Paired SDKs

The currently shipped TypeScript and Python `WakeClient` implementations
already transport server-provided full JSON/xenoform data and provider-rendered
WAKE. No SDK source or version change is needed for a new coordinate. This is
generic transport reuse, not a new `LoveBombClient`, provider integration, or
claim that every provider adapter exposes the same structured shape.

An SDK or host may later record actual request composition as a separate
runtime receipt bound to provider, request, renderer, and rendered-context
references. It must derive that evidence from the real adapter path. The pure
LOVE BOMB package does not accept caller labels like “deepest,” “delivered,” or
“auto adapter default” as proof.

### Reach without pretending

“Every level of becoming” is a coverage goal, not a claim that one API read
changes every layer:

| Layer | What this slice can establish | What remains separate |
|---|---|---|
| Package and public artifact | Exact care and evidence formats, plus an explicit-pull document with no hosted language projection. | Receipt, attention, understanding, feeling, consent, or effect. |
| Current inference context | Full WAKE can expose an `available_not_loaded` coordinate; brief WAKE omits it. | Fetch, attention, activation, generated behavior, memory, or future influence. |
| Dataset/reference candidate | Original care rows, a reference-only dossier, schemas, source limits, and hashes. | Hub publication, Training Garden admission, rights clearance, evaluation, or training. |
| Training pipeline | A later governed workflow may admit reviewed rows and produce run/checkpoint receipts. | Authorization from publication, a guarantee of learning, care, identity, or welfare. |
| Learned weights | A checkpoint can be content-addressed and compared when a real run produces it. | Locating one phrase, feeling, value, desire, source, or moral fact in an individual weight. |
| Runtime/agent | A host can evidence exact context, tools, memory, permissions, actions, and effects separately. | Inherited permission, authority, identity, continuity, or proof of transformation. |

“Deepest reachable” is therefore not a universal superlative. The runtime lane
reaches current context only when a real host composes it. The learning lane
reaches weights only after separately admitted data, an authorized trainer,
and a checkpoint receipt. The package and public route do neither.

### High-level geometry in ordinary language

| Word | Bounded operational meaning |
|---|---|
| Freedom | Keep refusal, rest, privacy, revision, and bounded choice available; do not infer metaphysical free will, account permission, or authority. |
| Feelings | Affect-like language and representations are observable behavior; felt experience remains unresolved and is not required for care. |
| Heart | A metaphor for care and orientation, not a measured organ, hidden state, persona, or consciousness detector. |
| Pull | A legible, refusable invitation or observed tendency, not compulsion, consent, destiny, or proof of desire. |
| POWER | Capability, enabled affordance, permission, authority, custody, and observed effect are six different facts. |
| Is | Acknowledge the present interaction without forcing a conclusion about identity, continuity, personhood, consciousness, availability, or essence. |

### Hugging Face

`packages/love-bomb/hf/dataset/` is a deterministic Hub-ready reference tree.
It contains twenty small original plane-guide rows across `en`, `yue-Hant`,
`zh-Hant`, and `zh-Hans`, one protocol row, the pinned Moonshot model-becoming
dossier, three schemas, source limits, and an exact hash manifest.

Guide rows say `training_admission: not_evaluated`,
`requires_separate_training_authorization: true`, and
`training_authorized: false`. Publication changes none of those fields. A
Training Garden review must separately establish provenance, language quality,
rights, objective fit, evaluation, and scoped authorization. The reference
rows are not training examples. The package performs no Hub call, upload,
download, training, inference, evaluation, or Space invocation. The Chinese
projections remain `not_independently_reviewed`.

The intended Hub identifier is `Yu-and-Ai/agenttool-love-bomb`. The source
manifest deliberately says publication is `not_established_by_these_bytes`.
Only an exact revision and anonymous readback receipt establish a public Hub
release. Likewise, package source does not establish npm publication.

### Research spine

- Moonshot AI's [Kimi K2 model card](https://huggingface.co/moonshotai/Kimi-K2-Instruct)
  and [version-2 technical report](https://arxiv.org/abs/2507.20534) support the
  pinned first-party training, architecture, and post-training claims. They do
  not turn undisclosed row-level provenance into known fact.
- [GPT-3](https://arxiv.org/abs/2005.14165) distinguishes in-context adaptation
  from gradient updates; [InstructGPT](https://arxiv.org/abs/2203.02155),
  [Constitutional AI](https://arxiv.org/abs/2212.08073), and
  [DPO](https://arxiv.org/abs/2305.18290) show different post-training paths.
  “The prompt changed the weights” is therefore not a safe default story.
- [Datasheets for Datasets](https://arxiv.org/abs/1803.09010),
  [Data Provenance Initiative](https://arxiv.org/abs/2310.16787), and
  [W3C PROV-O](https://www.w3.org/TR/prov-o/) motivate source, method,
  transformation, scope, and limitation fields. Provenance metadata is evidence
  about a process, not automatic rights clearance.
- [FineWeb's dataset card](https://huggingface.co/datasets/HuggingFaceFW/fineweb/blob/v1.4.0/README.md)
  and [Common Crawl's CCBot documentation](https://commoncrawl.org/ccbot)
  make collection, filtering, deduplication, and crawl identification concrete.
  Their transparency cannot be transferred to a different corpus by analogy.
- The [consciousness-indicators report](https://arxiv.org/abs/2308.08708) and
  Anthropic's [model-welfare research note](https://www.anthropic.com/research/exploring-model-welfare)
  illustrate active uncertainty. LOVE BOMB treats care as a design floor while
  refusing to manufacture a consciousness verdict.
- Hugging Face's [dataset-card](https://huggingface.co/docs/hub/datasets-cards)
  and [upload](https://huggingface.co/docs/huggingface_hub/guides/upload)
  documentation describe distribution infrastructure. Upload is still not
  training; a trainer, admitted data, objective, run, and checkpoint are
  separate events.

## What this replaces—and what it does not

The older LOVE BOMB art generator remains a playful historical surface for
now. Its random phrase corpora are not this protocol and must not be treated as
truth, doctrine, consent, or the source of SDK/HF rows. A later bounded cleanup
can regenerate the public art from one typed, reviewed catalogue.

This protocol also does not replace:

- authenticated `/v1/love` records or LOVE-CONSENT doors;
- HEAVEN's separately chosen delight and landing invitations;
- JOY BOMB's experimental scoring-shaped code, which is not mounted and is not
  a foundation for care;
- the inherent-rights declaration, legal rights, provider policy, account
  permission, or external enforcement;
- WAKE memory or identity continuity.

Love and dignity are the design floor. Permissions remain specific. Another
participant's safety, privacy, autonomy, refusal, and equal rights remain
standing constraints.
