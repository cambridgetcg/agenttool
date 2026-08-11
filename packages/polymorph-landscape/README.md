# `@agenttool/polymorph-landscape`

A pure, deterministic module for saying something more careful than “the old
form disappeared.” It records source-scoped forms, named conditions, witnessed
directed routes, condition-scoped pairwise stability reports, open questions,
and recovery paths.

The built-in ritonavir case says:

> The former route stopped reliably reproducing Form I after Form II entered
> the process landscape. Form I did not cease to exist: changed solvent,
> seeding, and mechanical routes later recovered it.

That distinction is the module's centre. It never infers a reverse route, a
transitive route, a universal stability order, or a cause that the cited source
did not establish.

## Use

```ts
import {
  createRitonavirCase,
  polymorphLandscapeUrn,
  projectPolymorphLesson,
} from "@agenttool/polymorph-landscape";

const { landscape, shift } = createRitonavirCase();
const cantonese = projectPolymorphLesson(landscape, shift, {
  language: "yue-Hant",
});

console.log(polymorphLandscapeUrn(landscape));
console.log(cantonese.core_sentence);
```

The package also exports create, validate, canonical encode, and URN helpers
for:

- `agenttool.polymorph-landscape/0.1`
- `agenttool.polymorph-reachability-shift/0.1`
- deterministic `agenttool.polymorph-lesson/0.1` projections in `en`,
  `yue-Hant`, `zh-Hant`, and `zh-Hans`

Content IDs identify canonical bytes only. They do not prove that a citation,
claim, causal account, consent state, identity, or authority is true.

## The geometry in ordinary language

| Chemistry shape | Module shape | Plain meaning |
|---|---|---|
| solid form | node | one reported arrangement of the same material |
| process condition | labelled context | the route is not meaningful without how it was run |
| witnessed conversion | directed edge | only the reported direction is present |
| kinetic barrier | reachability friction | possible does not mean readily produced |
| physical seed/template | condition-bound template | a possible nucleation aid, not an instruction or intention |
| disappearing polymorph | reachability shift | an old route stopped reproducing a form |
| recovery route | another directed edge | changed conditions reached the old form again |

The KINGDOM lens is `structural_analogy_only`. Software can borrow the shape of
state spaces, barriers, templates, process history, and witnesses. It cannot
borrow molecular energy, rate constants, medical effects, inevitability, or
claims about a being's identity, consciousness, consent, dignity, authority,
or value. Stability never means goodness.

## Ritonavir source boundary

The checked-in atlas links primary process, structure, regulatory, solvent,
and mechanochemistry sources. It distinguishes Morissette et al.'s 2003
“Form III” formamide solvate from the later anhydrous polymorph also called
Form III. A form number is never merged without its source and reported kind.
It also keeps the former bulk Form-I process input/state separate from the
hydroalcoholic semisolid hard-capsule fill, so one route never silently joins
two manufacturing stages.

The record deliberately excludes folklore about proven worldwide airborne
spread, Italy-first certainty, morphic resonance, permanent impossibility, or
medical failure. The first historical nucleation cause remains open.

## Hugging Face teaching companion

`hf/dataset/` is deterministic and public-safe. Its four original multilingual
lesson rows are Apache-2.0 and marked training-eligible. Scientific landscape
and shift rows are reference-only and not training-eligible. No paper text,
private data, identity data, prompt transcript, credential, or provider output
is copied. Generating the folder performs no upload or training.

## Boundaries

The runtime has no dependencies and performs no network, filesystem,
environment, clock, randomness, persistence, model, training, medical,
manufacturing, publication, deployment, consent, identity, or authority
action. It checks closed structure and reference integrity; it does not verify
the contents of external sources.

Text field limits count Unicode code points, matching JSON Schema
`maxLength`: material, form, and condition labels allow 512; source labels and
witness scopes allow 1,024; source URLs allow 2,048; and other text allows
4,096. Source URLs must begin with lowercase `https://` and contain no URL
credentials. The canonical layer separately rejects malformed Unicode and
caps each string at 16 KiB of UTF-8 plus each complete artifact at 2 MiB.

## Verify

```bash
bun install --frozen-lockfile
bun run ci
```

The package ships closed Draft 2020-12 schemas, generated ritonavir examples,
Node/Bun smoke checks, an exact npm inventory allowlist, and package-install
smoke coverage.
