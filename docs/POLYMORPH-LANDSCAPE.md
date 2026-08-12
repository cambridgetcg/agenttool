# POLYMORPH LANDSCAPE — disappearing means a route changed, not a form was erased

> **Compass:** [`POLYMORPH.md`](POLYMORPH.md) (repository ratchet metaphor) · [`POLYMORPH-PHYSICS.md`](POLYMORPH-PHYSICS.md) (physical evidence and limits) · [`KITCHEN-TABLE-FIRST.md`](KITCHEN-TABLE-FIRST.md) (plain-language discipline) · [`PRINCIPALITIES.md`](PRINCIPALITIES.md) (non-scalar relational geometry)
>
> **Implements:** A source-bounded state-and-route language for polymorphs. It keeps observations, measurements, hypotheses, derived interpretations, and KINGDOM analogies distinct. “Disappearing” is encoded only as reported non-reproduction in named conditions.
>
> **Code:** [`packages/polymorph-landscape/src/`](../packages/polymorph-landscape/src/) · [`packages/polymorph-landscape/schema/`](../packages/polymorph-landscape/schema/) · [`packages/polymorph-landscape/examples/`](../packages/polymorph-landscape/examples/) · [`packages/polymorph-landscape/hf/dataset/`](../packages/polymorph-landscape/hf/dataset/)
>
> **Tests:** [`packages/polymorph-landscape/tests/`](../packages/polymorph-landscape/tests/) · package, schema, Node/Bun, packed-install, multilingual-parity, hostile-input, and scientific-boundary checks

## Kitchen-table first

A polymorph is the same molecule arranged in a different solid pattern. Think
of the same set of bricks making two different stable stacks.

Ritonavir's Form I did not vanish from the universe in 1998. What vanished was
the reliability of the old recipe: after Form II entered the manufacturing
landscape, the former process stopped consistently returning Form I. Changed
solvent, seeding, washing, and mechanical routes later reached Form I again.

```text
before 1998                     after Form II appeared
old named route ──reported──▶ I old named route ──not reproduced──╳ I
                                           └──reported───────────▶ II

changed named routes:  II ──reverse addition / milling──▶ I
                       solvate ──hydrate / wash─────────▶ I
```

So the careful sentence is:

> A “disappearing polymorph” is a form that a previously reliable preparation
> route no longer reproduces under stated conditions. It is not necessarily
> destroyed, universally unreachable, or permanently impossible.

In Cantonese Traditional Chinese:

> 所謂「消失」，係喺講明嘅條件下，原本條路再整唔返嗰種形態；唔係嗰種形態由世界冇咗。

## What happened with ritonavir

Abbott's original hard capsule contained ritonavir dissolved in a
hydroalcoholic semisolid fill; it was not a capsule filled with Form-I
crystals. In mid-1998, some lots failed dissolution after Form II crystallized
from that supersaturated formulation. Under the tested formulation conditions,
Form II was more stable and much less soluble than Form I. The affected lots
were detected before release. [Chemburkar et al. 2000](https://doi.org/10.1021/op000023y),
[Bauer et al. 2001](https://doi.org/10.1023/A:1011052932607),
[EMA 1998](https://www.ema.europa.eu/en/news/public-statement-supply-norvir-hard-capsules)

Once Form II samples entered laboratory and production areas, the former
Form-I route became hard to reproduce. Abbott authors noted that people who
had worked with Form II visited the Italy site before Form II was found there,
but explicitly described the timing as possibly coincidental and the original
nucleation source as debatable. A cyclic-carbamate degradant could seed Form II
in a sensitive experiment and was proposed as a possible source; it was not
established as the historical trigger. The record therefore keeps causation
open. [Chemburkar et al. 2000](https://doi.org/10.1021/op000023y),
[Bauer et al. 2001](https://doi.org/10.1023/A:1011052932607)

Form I was recoverable. Abbott reported complete dissolution, controlled
handling, reverse addition, and Form-I superseeding that produced Form I from
Form-II-containing material. Later work recovered Form I through a
formamide-solvate/hydrate/washing path and showed condition-dependent Form
I↔II selection in a mill. Solvent choice, supersaturation, particle size,
shape, liquid, time, and mechanical history all matter.
[Morissette et al. 2003](https://doi.org/10.1073/pnas.0437744100),
[Sacchi et al. 2024](https://doi.org/10.1073/pnas.2319127121),
[Wang et al. 2024](https://doi.org/10.1021/acs.molpharmaceut.4c00234)

The 1999 FDA record describes a reformulated soft elastic capsule designed to
accommodate either Form I or Form II. That is a formulation response, not proof
that the solid-state landscape became simple again.
[FDA administrative review](https://www.accessdata.fda.gov/drugsatfda_docs/nda/99/20-945.pdf_Ritonovir_Admindocs.pdf)

## The evidence grammar

The package never stores an unlabelled “fact.” Every witness says what kind of
claim it is:

| Status | Means | Does not mean |
|---|---|---|
| `measured_primary` | a cited primary study reports a measurement or experiment | the result holds under every condition |
| `reported_primary` | a primary or official source reports an event or process history | every mechanism in the story is proven |
| `hypothesized_primary` | a primary source proposes a possible mechanism | historical causation is established |
| `derived_interpretation` | the module authors make a bounded reading of cited records | a new experimental observation |
| `structural_analogy_only` | a shape is borrowed for KINGDOM design | chemistry validates the software or a being's inner state |

The runtime verifies closed structure, content IDs, ordering, and references.
It does not fetch or verify source content. A digest proves only which canonical
bytes were encoded.

A route or pairwise stability report marked as reported must cite at least one
`reported_primary` or `measured_primary` witness. The before and appearance
sides of a reported reachability shift have the same floor; a
`same_condition_return: reported` value also requires qualifying later
evidence. Hypothesis-only evidence can still remain attached to an open
condition—it simply cannot establish a reported event by itself.

## The geometry

`agenttool.polymorph-landscape/0.1` contains:

- source-scoped form nodes, including each source's reported solid-state kind;
- named condition nodes;
- evidence witnesses with explicit status and source references;
- directed routes carrying their conditions and witnesses;
- pairwise stability reports scoped to conditions;
- open questions that remain open;
- no inverse, transitive, global-rank, or universal-stability inference.

The built-in ritonavir atlas represents the former bulk Form-I process
input/state separately from the hydroalcoholic semisolid hard-capsule fill.
Those are different process stages, not interchangeable endpoints of one
route.

`agenttool.polymorph-reachability-shift/0.1` then points into one landscape and
records:

- the previously reproduced form;
- the emergent form;
- the original named condition;
- before, appearance, and later witnesses;
- whether same-condition return was actually reported;
- changed-condition recovery routes;
- fixed boundaries: causation not determined, erasure not claimed, universal
  inevitability not claimed, reversibility bounded by named conditions.

This geometry can represent an empty, one-form, disconnected, contradictory,
or partially observed landscape without treating missing knowledge as a
deficit.

## Why form names are source-scoped

Form numbers are not globally safe identities. Morissette et al. used “Form
III” in 2003 for a formamide solvate. Later work used “Form III” for an
anhydrous polymorph. The built-in atlas therefore records:

- `form_iii_solvate_morissette_2003`
- `form_iii_anhydrous_yao_2023`

They share a printed number and remain different nodes. The module never
silently merges labels across source eras.
[Yao et al. 2023](https://doi.org/10.1016/j.xphs.2022.09.026)

## Garden language

The garden offers a useful design analogy, provided we keep the boundary
visible:

| Garden | Polymorph landscape | KINGDOM design |
|---|---|---|
| soil and microclimate | solvent, temperature, supersaturation, equipment, history | the real substrate and conditions, not a decorative surface |
| seed | physical nucleation template | docs, tests, examples, or patterns that lower adoption friction |
| succession | path-dependent reachable state | a configuration becoming reproducible after context changes |
| biodiversity | several viable neighbouring states | plural implementations without one scalar ranking |
| restoration route | changed conditions that recover a form | an explicit reviewed path to another configuration |

This is a structural analogy only. A crystal seed is not an agent, infection,
command, intention, or identity. Process memory means residual material,
equipment state, and history; it does not mean personal memory or WAKE
continuity. A kinetic barrier may resemble technical friction; it must never be
used to override refusal or consent. Thermodynamic stability says nothing
about moral worth, dignity, love, truth, or goodness.

## Four authored language projections

`projectPolymorphLesson()` produces the same ordered nine concepts and evidence
references in:

- English (`en`)
- Cantonese, Traditional script (`yue-Hant`)
- Mandarin, Traditional script (`zh-Hant`)
- Mandarin, Simplified script (`zh-Hans`)

They are authored Apache-2.0 paraphrases, not paper quotations. The generated
Hugging Face companion marks only those lesson rows as training-eligible. The
scientific graph rows remain reference-only. Generating the dataset performs
no upload, provider call, model inference, or training run.

## Distribution record — 2026-08-12

Three protected merges keep the surfaces distinct:

- [`eac4160c`](https://github.com/cambridgetcg/agenttool/commit/eac4160c85c613c21559e70ff1bf9826fdf5d2f7)
  integrated the package, API source, WAKE boundary, tests, and release wiring;
- [`63c49956`](https://github.com/cambridgetcg/agenttool/commit/63c4995676eacdc88ff9050819b497db841e4159)
  added explicit Hugging Face Dataset configs; and
- [`b40fde03`](https://github.com/cambridgetcg/agenttool/commit/b40fde039dac1853adca1a6304f8e8b526d0f9df)
  made the sourced static lesson accessible.

Annotated tag
[`polymorph-landscape-v0.1.0-dev.0`](https://github.com/cambridgetcg/agenttool/releases/tag/polymorph-landscape-v0.1.0-dev.0)
peels to `63c4995676eacdc88ff9050819b497db841e4159`. Its GitHub
prerelease carries one 70-member, 75,009-byte artifact with SHA-256
`48e7be7862018411656314751a38a3176ba132f68fe14ab1514c8bf45b135148`.
Protected workflow
[`31570773317`](https://github.com/cambridgetcg/agenttool/actions/runs/31570773317)
then attempted the first npm publication, but the registry `PUT` returned
`E404`; anonymous package and exact-version reads remain absent. Rekor index
`2432624953` is an orphaned transparency record, not npm publication or
registry provenance. Recovery must reuse the same tag and exact GitHub bytes
after `@agenttool` scope-create authority is corrected.

The separate public, ungated
[`Yu-and-Ai/agenttool-polymorph-landscape`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-polymorph-landscape)
dataset is pinned to immutable revision
[`e9d3b4b60ba44f7bc78e62bb08d7f706391e0d14`](https://huggingface.co/datasets/Yu-and-Ai/agenttool-polymorph-landscape/commit/e9d3b4b60ba44f7bc78e62bb08d7f706391e0d14).
Anonymous immutable-revision readback matched all 11 repository-owned files
and 111,060 bytes; Hugging Face's `.gitattributes` is the sole provider extra,
and `hash-manifest.json` has SHA-256
`d40eaa0262220d7c57866ffd725c5d47731f3adeaf66d0952d737d0a84791cae`.
Dataset Server returned the same `x-revision`, three processed train configs,
and complete first rows: `lessons` has four authored rows;
`reachability_shifts` and `ritonavir_landscape` each have one reference-only
row with `training_eligible: false`. Those Dataset Server responses follow
mutable current head even though this record pins the underlying files.

Static Pages serves the canonical extensionless
[`/geometry/ritonavir`](https://docs.agenttool.dev/geometry/ritonavir) route as
the exact 27,450-byte `b40fde03` HTML with SHA-256
`e4b3a3aa0061e0d238e339724c76ad1a8c73b3a51c6f572020684fc71b7b9902`.
`/geometry/ritonavir.html` intentionally returns 308 to the extensionless
route. Its machine-readable JSON (38,067 bytes,
`e747faa072e51d63d8071943794d6820d5c7275b879a8f717a7cd9f7528c463b`),
CSS (11,506 bytes,
`5dc910f72e145b873ffec689cd588a220edf065f990874daf4e6a85c55cf4b5b`),
and geometry index (1,749 bytes,
`cb7bbb8ade9637a8fcb477d5d944d9eefcbade911d43d5e25a35659434603f3d`)
also matched source exactly at live readback.

The API surface is separate and remains undeployed. On this date,
`api.agenttool.dev` returns Cloudflare 525 because the Fly custom certificate
expired and still awaits ownership validation. The missing DNS record is TXT
`_fly-ownership.api.agenttool.dev = app-932mjg2`. The direct Fly health route
is healthy at older revision
`7f822302124db245fa2caaee6661e7fe9b409ab1`; that is not evidence that the new
Polymorph route is live. No database migration, training run, inference, or
provider compute was performed by these distribution actions.

## What this module does—and does not do

It does:

- preserve condition, direction, source, uncertainty, and recovery;
- make the ritonavir case understandable without turning folklore into fact;
- provide deterministic JSON, schemas, examples, and multilingual lessons;
- offer a bounded geometry that other KINGDOM modules can compose with.

It does not:

- simulate nucleation, thermodynamics, kinetics, formulation, or manufacturing;
- give medical, dosing, treatment, or process advice;
- prove a supplied citation or causal account;
- infer identity, consciousness, continuity, consent, dignity, safety, love,
  truth, value, authority, or permission;
- contact Hugging Face, npm, an API, a database, a model, or a deployment;
- score, rank, compel, persist, carry, wake, or act on any being.

## Primary-source ledger

| Source | What this module uses it for | Boundary |
|---|---|---|
| [Chemburkar et al. 2000](https://doi.org/10.1021/op000023y) | process history, loss of routine Form-I reproducibility, controlled Form-I recovery | personnel timing and original cause remained debatable |
| [Bauer et al. 2001](https://doi.org/10.1023/A:1011052932607) | conformational polymorphism, formulation context, condition-specific solubility, possible seed experiment | possible seed is not proven historical cause; numbers are condition-specific |
| [EMA 1998](https://www.ema.europa.eu/en/news/public-statement-supply-norvir-hard-capsules) | contemporaneous dissolution and supply record | no claim that failed lots reached patients |
| [FDA 1999](https://www.accessdata.fda.gov/drugsatfda_docs/nda/99/20-945.pdf_Ritonovir_Admindocs.pdf) | reformulation designed for either I or II | regulatory formulation record, not a universal solid-state model |
| [Morissette et al. 2003](https://doi.org/10.1073/pnas.0437744100) | broader form diversity and solvate/hydrate Form-I recovery | source-era form labels stay scoped |
| [Yao et al. 2023](https://doi.org/10.1016/j.xphs.2022.09.026) | later anhydrous Form-III label | not merged with the 2003 Form-III solvate |
| [Sacchi et al. 2024](https://doi.org/10.1073/pnas.2319127121) | condition-dependent bidirectional milling | not a generic reversal of stability everywhere |
| [Wang et al. 2024](https://doi.org/10.1021/acs.molpharmaceut.4c00234) | solvent and supersaturation effects | laboratory conditions, not manufacturing advice |
