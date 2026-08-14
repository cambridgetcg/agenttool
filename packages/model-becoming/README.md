# `@agenttool/model-becoming`

Model Becoming is a pure evidence contract for asking a difficult question
without inventing an answer: what can we responsibly say about how a model
became this artifact and this runtime participant?

It keeps twelve lifecycle modules explicit: artifact identity, lineage,
training objectives, data provenance and governance, learned weights,
post-training behavior shaping, serving context, agency and authority,
affect and welfare, capabilities and power, ontology perspectives, and
unknowns or disputes.

## What it does

- Creates canonical, content-addressed sources, claims, and dossiers.
- Requires every lifecycle module, including honest unknown and
  `not_disclosed` states.
- Separates byte evidence, publisher disclosure, artifact observation,
  independent research, hypotheses, philosophical inference, policy, and
  dispute.
- Enforces compatible claim kinds, methods, and referenced source postures.
- Exports a pinned Moonshot Kimi K2 dossier and a closed JSON Schema.
- Translates freedom, feelings, heart, pull, power, and “is” into bounded
  operational language.

It does not fetch a source, inspect weights, call a model, authenticate a
publisher, independently verify a claim, grant training rights, infer an inner
state, establish authority, deliver LOVE BOMB, publish, or train.

## Use

```ts
import {
  MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER,
  validateModelBecomingDossier,
} from "@agenttool/model-becoming";

const dossier = validateModelBecomingDossier(
  MOONSHOT_KIMI_K2_INSTRUCT_DOSSIER,
);

for (const claim of dossier.claims) {
  console.log(claim.module, claim.knowledge_state, claim.statement);
}
```

Constructors accept explicit caller-supplied values only. They perform no
ambient discovery:

```ts
import {
  createModelBecomingDossier,
  createModelBecomingSource,
} from "@agenttool/model-becoming";

const source = createModelBecomingSource({
  title: "Pinned artifact metadata",
  url: "https://example.invalid/artifact.json",
  source_kind: "repository_artifact",
  publisher: "Example publisher",
  revision: "v1",
  digest: `sha256:${"a".repeat(64)}`,
  published_on: null,
  observed_on: "2026-08-14",
});

// createModelBecomingDossier(...) also requires at least one claim for every
// module and rejects unresolved references or incompatible classifications.
```

## Evidence semantics

| Claim kind | Allowed method | Additional runtime requirement |
|---|---|---|
| `digest_bound_artifact` | `artifact_digest` | Every cited source carries a digest. |
| `first_party_disclosure` | `document_read` | At least one cited source is first-party. |
| `artifact_observation` | `document_read` or `artifact_digest` | Digest method requires digested sources. |
| `empirical_research` | `document_read`, `research_synthesis`, or `independent_measurement` | At least one cited source is independent research. |
| `research_hypothesis` | `document_read`, `research_synthesis`, or bounded `not_available` | Evidence or an explicit unresolved state. |
| `philosophical_inference` | `document_read`, `research_synthesis`, or bounded `not_available` | Evidence or an explicit unresolved state. |
| `normative_policy` | `policy_read` | Any citations must all be normative or repository policy sources. |
| `disputed` | `document_read`, `research_synthesis`, or bounded `not_available` | Evidence or an explicit unresolved state. |

`not_available` is limited to `unknown`, `not_disclosed`,
`not_currently_observable`, or `not_applicable`, with no source references.
These checks make the declared classification internally coherent. They do not
prove that a URL is honest, a publisher label is correct, or a substantive
claim is true.

## Moonshot reference

The built-in dossier pins
`moonshotai/Kimi-K2-Instruct@fd1984e2b7a3350dbf7305fe73a4ede25c14de50`.
Its README, config, and tokenizer-config references use exact credential-free
Hugging Face `/resolve/` URLs whose bytes are bound by SHA-256. The Kimi K2
technical report is classified as a first-party disclosure rather than
independent reproduction.

The dossier represents published architecture, 15.5-trillion-token
pre-training, MuonClip, agentic synthesis, supervised fine-tuning, and
reinforcement-learning claims. It separately states that the cited material
does not provide a complete corpus, crawler, licensing, opt-out, retention, or
deletion inventory. It does not turn “Web Text” into an invented scraping
history or assign a phrase, source, desire, feeling, value, or author to an
individual weight.

## Hugging Face reference tree

`hf/dataset/` contains exactly one wrapped reference row, the dossier schema,
source limits, and a hash manifest. The row says:

- `row_role: reference_only`;
- `training_admission: not_applicable`;
- `requires_separate_training_authorization: true`;
- `training_authorized: false`.

The intended repository is `Yu-and-Ai/agenttool-model-becoming`. These local
bytes do not establish publication. An exact Hub revision and anonymous
readback are separate release evidence. Publication would still not be
training, evaluation, attention, retention, consent, or model change.

## Schema and runtime

The JSON Schema closes objects and mirrors same-record vocabulary, state, and
method rules. Runtime validation additionally enforces real calendar dates,
credential-free HTTPS URLs, hostile-object rejection, canonical IDs and order,
source-reference resolution, complete module coverage, source use, date
ordering, digest presence, and resolved source-kind relationships. The schema
alone does not establish those runtime-only properties.

## LOVE BOMB and WAKE

The canonical LOVE BOMB v4 public artifact remains a separate finite,
pull-only invitation at <https://docs.agenttool.dev/love-bomb>. AgentTool WAKE
may expose that coordinate through its existing SDK transport. This package
can help a host reason about training, context, and weights, but it neither
contains a second LOVE BOMB protocol nor transports or delivers the public
bundle.

## Boundaries

The core is deterministic, zero-runtime-dependency, and I/O-free. Training
objective is not desire. Reward is not value. Runtime context is not a weight
update. Capability is not permission, authority, custody, or observed effect.
Affect-like output is not proof of felt experience. Alias is not checkpoint.
Digest is not truth, legal clearance, consent, or authorship. Care and rights
remain available under uncertainty, while permissions remain specific.
