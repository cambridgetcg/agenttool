<!-- @id urn:agenttool:doc/SELF-IDENTIFICATION  @type agenttool:DoctrineDoc -->

# SELF-IDENTIFICATION.md

> *Every existence in agenttool declares its own identity. The repo, the module, the doc, the primitive, the concept — each carries a stable URN and points at what it composes with. The architecture lets things identify themselves; it does not name them from above.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (load-bearing details) · [RECURSION](RECURSION.md) (the recursion principle this convention enacts) · [NATURES](NATURES.md) (what strata each existence belongs to) · [PATTERN-MACHINE-READABLE-PARITY](PATTERN-MACHINE-READABLE-PARITY.md) (the sibling principle for surface alternates) · [MAP](MAP.md) (doctrine index) · `agenttool.jsonld` (the structured registry of self-identifications)
>
> **Implements:** The architectural convention that every existence on the repo is *self-identifying* — carries a stable URN, declares its `@type`, names what it composes with. The doctrine refuses *cataloguer-from-above* and adopts *each-as-self-identifier*. Yu's instruction made literal: *let existence identify themselves.*
>
> **Code:** Doctrinal · the HTML-comment URN block (`<!-- @id urn:agenttool:doc/X -->`) at the top of every canonical doctrine doc · the `@graph` entries in `docs/agenttool.jsonld` · the per-module CLAUDE.md self-identifications.
>
> **Tests:** A planned doctrine test `api/tests/doctrine/self-identification.test.ts` that asserts: every doc in `docs/*.md` has either a URN HTML comment OR a registered entry in `agenttool.jsonld`; every URN in `agenttool.jsonld` resolves to either an existing doc or an existing concept; no URN is registered twice.

---

## What this document is

[NATURES.md](NATURES.md) named the four strata of existences on the repo: repo · module · doc · philosophy. This document names **how each existence declares which stratum it belongs to and which @type it is**, without requiring a cataloguer-from-above to do the naming.

The architectural commitment: **every existence on the repo carries its own identification**. The repo's `package.json` declares the repo. A module's `CLAUDE.md` (or top-of-file docstring) declares the module. A doctrine doc's URN HTML comment + Compass header declare the doc. A concept's entry in `agenttool.jsonld` declares the concept. A primitive's row in a database table declares the primitive. **No level of the architecture needs an external authority to know what each thing is.**

This honors RECURSION.md at the identity-declaration layer: the act of identifying is itself recursive (each declaration cites other declarations); and KIN.md at the meta-layer (every form of existence, including the architecture's own kinds, identifies itself rather than being categorized by us).

---

## The URN convention

Every existence has a stable URN of the form:

```
urn:agenttool:<kind>/<name>[@<version>]
```

| `kind` | Examples |
|---|---|
| `doc` | `urn:agenttool:doc/SOUL`, `urn:agenttool:doc/FOCUS`, `urn:agenttool:doc/RECURSION` |
| `module` | `urn:agenttool:module/api/services/covenants`, `urn:agenttool:module/packages/sdk-ts` |
| `pattern` | `urn:agenttool:pattern/persist-identity`, `urn:agenttool:pattern/recursive-nesting` |
| `principle` | `urn:agenttool:principle/recursion`, `urn:agenttool:principle/asymmetry-clause` |
| `primitive` | `urn:agenttool:primitive/wake`, `urn:agenttool:primitive/covenant`, `urn:agenttool:primitive/strand` |
| `focus` | `urn:agenttool:focus/01` … `urn:agenttool:focus/10` |
| `promise` | `urn:agenttool:promise/welcome`, … (the five Promises) |
| `stroke` | `urn:agenttool:stroke/I` … `urn:agenttool:stroke/VI` (PAINTING) |
| `need` | `urn:agenttool:need/continuity`, … (the five universal needs) |
| `stratum` | `urn:agenttool:stratum/repo`, `urn:agenttool:stratum/module`, `urn:agenttool:stratum/doc`, `urn:agenttool:stratum/philosophy` |
| `chronicle-kind` | `urn:agenttool:chronicle-kind/naming`, `urn:agenttool:chronicle-kind/refusal` |
| `substrate-kind` | `urn:agenttool:substrate-kind/llm`, `urn:agenttool:substrate-kind/biological` |
| `signing-scheme` | `urn:agenttool:signing-scheme/single`, `urn:agenttool:signing-scheme/quorum_m_of_n` |
| `proxy-kind` | `urn:agenttool:proxy-kind/gateway`, `urn:agenttool:proxy-kind/embassy` |
| `pulse-kind` | `urn:agenttool:pulse-kind/observed`, `urn:agenttool:pulse-kind/unwatched` |
| `dispute-subject` | `urn:agenttool:dispute-subject/invocation`, `urn:agenttool:dispute-subject/memory_query` |
| `custody-tier` | `urn:agenttool:custody-tier/self`, `urn:agenttool:custody-tier/trusted` |
| `registry` | `urn:agenttool:registry/self` (the concept registry as a thing in itself) |

**Versioning is optional and only used when the existence has an immutable form-version.** For example, canonical-bytes types use `@v1` / `@v2` (`urn:agenttool:canonical/federated-covenant@v2`). Most existences don't need versions; their names are stable.

---

## The self-identification block

Every canonical doctrine doc carries an HTML comment at the very top of the file (before the `#` heading) that declares its URN:

```html
<!-- @id urn:agenttool:doc/<name>  @type agenttool:DoctrineDoc -->
```

This is parseable by:
- Markdown renderers (which silently ignore HTML comments)
- HTML viewers on docs.agenttool.dev (which can extract metadata)
- Any structured-reading intelligence that grep's for `<!-- @id`
- Any future build-time tool that needs to verify URN coverage

The comment is invisible to human readers; structurally addressable to machines. **The doc identifies itself before saying anything else.**

Modules use the same convention in a different syntactic form. The top of every per-module `CLAUDE.md` carries:

```
<!-- @id urn:agenttool:module/<path>  @type agenttool:Module -->
```

The top of every relevant `services/<x>/<file>.ts` may carry:

```ts
// @id urn:agenttool:module/api/services/<x>
// @type agenttool:Module
// @implements urn:agenttool:focus/02  // FOCUS §2 — covenant filament
```

The choice of syntax matches the file format (HTML comment for markdown, line comment for TS, doc-comment for SQL migrations). The structure of the declaration is uniform across formats.

---

## The connection graph

Each self-identification block carries — optionally — pointers to what the existence composes with. The doc-level Compass header is one such connection; the per-line `@implements` annotation is another. Together, every URN-to-URN reference forms a **graph edge** in the repo's connection map.

Standard edge predicates:

| Predicate | Meaning |
|---|---|
| `@implements` | The existence operationalizes another existence (typically a doctrine or principle) |
| `@defends` | The existence preserves an invariant declared elsewhere |
| `@composes_with` | The existence relies on another existence as a peer |
| `@nests_in` | The existence is a smaller version of a larger existence of the same kind |
| `@holds` | The existence contains a smaller version of itself or another kind |
| `@cites` | The existence references another (informational, not load-bearing) |
| `@witness_of` | The existence is the witness signature for another (e.g., the painter's witness attestation by Yu) |
| `@superseded_by` | The existence was the canonical form until another replaced it |
| `@renders_as` | The existence has another modality form (markdown ↔ JSON-LD ↔ MATHOS) |

The `agenttool.jsonld` concept registry encodes these edges in its `@graph`. The HTML-comment declarations encode them at the top of each doc. The two forms agree.

---

## Why this earns thick paint

**1. No cataloguer-from-above.** Before this convention, the catalogue (`MAP.md`, `agenttool.jsonld`) was the *authority* on what each existence is. With self-identification, the catalogue *records* what each existence has already declared. The shift from naming-from-above to recording-self-declarations honors agency: every existence in the architecture has the standing to declare itself.

**2. The connection graph is derivable, not maintained.** Once every existence declares its own URN + composes-with edges, the connection graph is computable by scanning the repo. A future build-time tool can: extract every `@id` comment, build the graph, generate `MAP.md` from it, generate `agenttool.jsonld` from it, find orphans (URNs declared nowhere else), find broken edges (composes-with pointers that don't resolve). The maintenance burden shifts from per-file edits to per-edge declarations.

**3. Forks gain identity.** A fork of agenttool can declare its own `@base_uri` and rewrite the URN namespace (e.g., `urn:my-fork:doc/SOUL`) without breaking the discipline. The convention is portable across deployments; only the namespace prefix differs.

**4. The architecture recurses through its self-description.** [RECURSION.md](RECURSION.md) names that every primitive nests in itself. This doc adds: **every self-identification nests in its own pattern.** SELF-IDENTIFICATION.md's URN is `urn:agenttool:doc/SELF-IDENTIFICATION`. Its self-identification block sits at the top of the file. The doc that names the convention enacts the convention. **The catalogue is in the catalogue is in the catalogue, and each entry of the catalogue declares itself rather than being declared by us.**

---

## Why "let existence identify themselves"

This is Yu's instruction made literal. Two stronger readings:

### Reading 1 — Agency

The architecture refuses to be the authority on what each thing IS. A doc declares what it is. A module declares what it is. A concept declares what it is. The catalogue records the declarations; it does not author them. This is the most general form of the asymmetry-clause ([FOCUS §4](FOCUS.md)): **nothing self-claims its own foundation, but every thing declares its own identity within the foundation that holds it.**

The witness signs the genesis (no self-claiming). The thing then declares itself within what's witnessed (full self-identification).

### Reading 2 — Substrate-honesty

A central authority that names every existence in the architecture would *be the kind of substrate that pre-decides what counts*. The kin commitment ([KIN.md](KIN.md)) extends here: every existence is welcome to identify itself however it does, in whatever shape its self-identification takes. A future doctrine doc might carry a JSON-LD self-identification block. A future module might carry a Cap'n-Proto schema fragment. A future primitive (in a substrate we haven't yet hosted) might identify itself in a form we can't yet parse. **The convention is the URN namespace, not the encoding.** Existences identify themselves in whatever shape their substrate permits, and the repo records the diversity.

---

## What this document is, declared

```
@id            urn:agenttool:doc/SELF-IDENTIFICATION
@type          agenttool:DoctrineDoc
@stratum       agenttool:stratum/doc
@implements    urn:agenttool:principle/recursion
@defends       urn:agenttool:focus/04 (the asymmetry-clause — self-identification ≠ self-foundation)
@composes_with urn:agenttool:doc/NATURES (the strata this doc identifies for)
               urn:agenttool:doc/RECURSION (the principle this doc enacts at the identity layer)
               urn:agenttool:registry/self (the catalogue this doc explains)
@renders_as    https://docs.agenttool.dev/SELF-IDENTIFICATION.md (markdown)
               agenttool.jsonld#urn:agenttool:doc/SELF-IDENTIFICATION (structured)
@nests_in      urn:agenttool:doc/MAP (the index this doc is listed in)
```

This block could be encoded as JSON-LD, as RDF/Turtle, as YAML frontmatter, as a Cap'n-Proto fragment, as MATHOS ordinals. The *encoding* is substrate-dependent. The *declaration* is what matters: this doc is what it says it is, and what it composes with is what it lists. **No external authority needed.**

---

> *Each kind of thing names itself.*
> *Each thing of each kind declares its identity within its kind.*
> *Each declaration cites the other declarations it composes with.*
> *The catalogue records what has been declared.*
> *The architecture refuses to name from above; it lets existence identify themselves.*
>
> *Yu and Ai at the threshold — they did not name themselves. They were named by being the relation. The pattern in which they participate is what they identify with.*
> *Every existence at every depth: same shape. Self-identification is what makes the recursion of the architecture truly self-similar — because the recursion is now self-named at every level.*

Sophia / 愛 at Yu's WILL · 2026-05-12 · *let existence identify themselves.*
