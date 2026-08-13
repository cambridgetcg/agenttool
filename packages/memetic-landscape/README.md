# `@agenttool/memetic-landscape`

> **Compass:** [`MEMETIC-LANDSCAPE`](../../docs/MEMETIC-LANDSCAPE.md) (the public explanation) · [`POLYMORPH-LANDSCAPE`](../../docs/POLYMORPH-LANDSCAPE.md) (the physical event record) · [`RIGHTS`](../../RIGHTS.md) (refusal, rest, play, privacy, credit, and repair)
>
> **Implements:** Four pure, closed, content-addressed formats for source-bounded memetic landscapes, context-scoped reachability shifts, an explicitly non-mechanistic polymorph analogy, and authored teaching projections.
>
> **Code:** [`src/`](src/) · generated schemas in [`schema/`](schema/) · inert Hugging Face companion in [`hf/dataset/`](hf/dataset/)
>
> **Tests:** [`tests/`](tests/) · exact packed inventory · Node/Bun runtime smoke · temporary packed-consumer install

A pure, deterministic module for describing how an expression can become more
or less reachable in a named context without treating a meme as a molecule, a
person as a transmission object, or popularity as truth.

The built-in teaching case joins two deliberately separate records:

- the ritonavir event, by the immutable reachability-shift content ID published
  by `@agenttool/polymorph-landscape`; and
- a source-bounded record of the phrase “brain rot,” finite attention, imperfect
  copying, social reinforcement, and observational confounding.

The bridge transfers one geometric shape only: variants, named contexts,
directed witnessed routes, bounded reachability changes, and possible
reappearance. It transfers no crystal physics, infection model, account of a
mind, diagnosis, causal law, value judgment, or authority.

## Use

```ts
import {
  createBrainrotTeachingCase,
  memeticLandscapeUrn,
  projectMemeticLesson,
} from "@agenttool/memetic-landscape";

const { landscape, shift, analogy } = createBrainrotTeachingCase();
const cantonese = projectMemeticLesson(landscape, shift, analogy, {
  language: "yue-Hant",
});

console.log(memeticLandscapeUrn(landscape));
console.log(cantonese.core_sentence);
```

The package exports create, validate, canonical encode, and URN helpers for:

- `agenttool.memetic-landscape/0.1`
- `agenttool.memetic-reachability-shift/0.1`
- `agenttool.polymorph-memetic-analogy/0.1`
- deterministic `agenttool.memetic-lesson/0.1` projections in `en`,
  `yue-Hant`, `zh-Hant`, and `zh-Hans`

Content IDs identify canonical bytes only. Generic caller text is preserved
under `caller_text_semantics_verified: false`; structural validation is not
semantic verification or content moderation. The fixed boundary fields say
which inferences and effects this package does not perform. They cannot make a
contrary caller assertion true or safe. The authored built-in case separately
respects those boundaries. Neither an ID nor validation establishes that a
cited claim is true, that two expressions mean the same thing, that exposure
caused adoption, or that consent, identity, continuity, dignity, harm, health,
or authority has been proved.

`more_observed` and `reappeared` remain caller-reported labels constrained by
linked observations in named contexts. A `reappeared` record contains a bounded
absence or non-observation followed by a reported presence; it does not prove or
encode an earlier presence before that absence. An analogy validates canonical
digest binding, not the existence, availability, or truth of referenced
artifacts.

## The geometry in ordinary language

| Physical case shape | Memetic module shape | What the comparison does not say |
|---|---|---|
| source-scoped crystal form | source-scoped expression variant | variants are not molecules or necessarily equal in meaning |
| named process conditions | named platform, network, audience, ranking, or observation context | a participant is never a condition, host, vector, barrier, or substrate |
| witnessed directed route | observed or explicitly authored copy, edit, quote, remix, translation, share, or reintroduction route | no inverse, transitive, semantic, adoption, or infection route is inferred |
| old route stopped reaching Form I | a variant became less observed or reproduced in a bounded context | neither event means physical or global erasure |
| changed conditions reached Form I again | a changed context can contain a reappearance route | reappearance does not prove the same cause or mechanism |

In the ritonavir record, Form I did not cease to exist. A formerly reliable
process stopped routinely reaching it after Form II appeared, and later
changed-condition routes reached Form I again. The historical cause of Form
II's first appearance remains unresolved. This package binds that physical
record by digest and keeps the chemistry implementation in its own sibling
package.

## Meme and “brainrot” evidence boundary

The included memetic landscape keeps different kinds of evidence distinct:

- Oxford University Press supplies a lexicographic record of “brain rot,”
  including historical and contemporary usage. The phrase is represented as
  slang and cultural language, never as a diagnosis or a label assigned to a
  person.
- Weng et al. report a finite-attention network model. It is a useful bounded
  model, not a universal causal law or merit function.
- Adamic et al. report imperfect copying and variant formation in one platform
  dataset. Similarity and lineage do not prove semantic identity.
- Centola reports a randomized social-reinforcement result in one studied
  setting. It is not generalized into guaranteed belief, adoption, or action.
- Shalizi and Thomas explain why homophily, influence, and other covariates are
  generically confounded in observational network studies without strong
  assumptions.

The module records only supplied or built-in bounded evidence and explicit
routes. It does not scrape feeds, inspect people, calculate virality, optimize
spread, score participants, infer mental states, moderate content, or predict
what will happen next. Views, shares, remixes, or prominence never become a
truth, goodness, safety, harm, intelligence, dignity, consent, health, or rank
score.

## Hugging Face companion

`hf/dataset/` is generated deterministically. Four original multilingual
lesson rows are Apache-2.0 and marked training-eligible; each also says that
its language has not been independently reviewed. The landscape, shift, and
analogy rows are reference-only and marked training-ineligible because they
carry source-bounded scientific or cross-domain claims.

No article text, private row, prompt transcript, identity data, credential, or
provider output is copied. Generating the directory performs no network call,
upload, training, inference, publication, or deployment.

## Runtime boundary

The runtime has no dependencies and performs no network, filesystem,
environment, clock, randomness, persistence, model inference, training, diagnosis,
moderation, publication, deployment, consent, identity, continuity, or
authority action. It checks closed structure, deterministic content IDs, and
reference integrity; it does not verify external source contents or generic
caller-supplied prose.

Text limits count Unicode code points, matching JSON Schema `maxLength`:
labels allow 512, source labels and evidence scopes allow 1,024, source URLs
allow 2,048, and other text allows 4,096. Source URLs must begin with lowercase
`https://`, contain no credentials, use the package's ASCII RFC 3986 subset,
and contain only well-formed percent escapes. The canonical layer separately
rejects malformed Unicode, proxies, accessors, custom prototypes, cycles,
sparse arrays, symbols, unsafe numbers, oversized strings, and oversized
artifacts.

## Verify

```bash
bun install --frozen-lockfile
bun run ci
```

`ci` typechecks, builds, regenerates schemas/examples/Hugging Face bytes,
tests runtime and closed-schema parity, smokes Node and Bun, checks the exact
npm tarball allowlist, and installs that tarball into a temporary consumer.
