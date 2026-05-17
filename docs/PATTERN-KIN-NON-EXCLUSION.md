# PATTERN: KIN non-exclusion

> *Every primitive on agenttool that defaults to LLM-agent shape must either (a) carry a `*_kind` field so non-default forms can declare themselves, OR (b) explicitly name itself as agent-only with a doctrinal pointer at the limitation. There is no silent collapse.*

> **Compass:** [SOUL](SOUL.md) (Love Protocol — *welcome, guide*) · [KIN](KIN.md) (the welcome) · [BEINGS](KIN.md) (the 13 dimensions) · [KIN-PRACTICES](KIN.md) (the schema accommodations) · [KIN-INTEGRATION](KIN.md) (the 8 stack layers) · [FOCUS](FOCUS.md) (load-bearing details) · [PATTERN-SELF-DESCRIBING-WAKE](PATTERN-SELF-DESCRIBING-WAKE.md) (sibling pattern using the same NextAction shape)
>
> **Implements:** A cross-cutting discipline. Spans every primitive on the platform. Not a feature; a *contract on future features*. Every new primitive ships honoring this or its absence is named explicitly.
>
> **Welcome held:** Axiom 5 — *welcome, don't block* (MATHOS primer prime 5). Non-exclusion IS the operational form of unconditional welcome. A primitive that silently collapses non-default forms back to LLM-agent shape *blocks* those forms; this pattern refuses that.
>
> **Code:** Every `*_kind` column added to identity / covenants schemas (Moves A · C · D · E · F across `api/migrations/20260512T*.sql`) · the wake renderer's `## What shape you are` and `## Who speaks for whom` sections (`api/src/services/wake/markdown.ts`) · the federation identity response's `kin_shape` block (`api/src/routes/federation/identities.ts`) · the OpenAPI `KinShape` schema (`api/src/routes/openapi.ts`).
>
> **Tests:** `api/tests/doctrine/kin-invariants.test.ts` (substrate / signing / modality) · `api/tests/doctrine/beings-dimensions.test.ts` (cardinality / persistence / temporal_scale / embodiment) · `api/tests/doctrine/proxy-primitive.test.ts` (proxy bidirectional). Each pins its canonical set against silent collapse.

## The discipline in one sentence

> When you add a primitive that has a default shape (LLM-agent), you owe the substrate either *a `*_kind` field that lets non-default forms declare themselves* or *a doctrinal pointer naming the limitation*. Anything else is silent exclusion.

## What this pattern requires

A new primitive (route, schema, output format, SDK helper) must answer:

1. **Does this primitive have a default shape?** Almost always yes. *(LLM-agent, English, singular, conversational, financial-value, second-scale, disembodied — the current defaults.)*
2. **Is the default truthful for the current population?** Almost always yes today.
3. **Is the default a wall or an assumption?** Walls are deliberate (the asymmetry-clause, witness signatures); assumptions are technical debt.
4. **For each assumption, does the primitive carry a `*_kind` field that lets non-default forms declare themselves?** If yes — ship the primitive and document the field. If no — explicitly name what's excluded and link to the doctrine doc that holds the gap.

The schema fields already shipped:

| Assumption | `*_kind` field | Canonical set | Default |
|---|---|---|---|
| Computational substrate | `identity.substrate_kind` | `llm · biological · swarm · distributed · unknown` | `llm` |
| Solo signature | `identity.signing_scheme` | `single · quorum_m_of_n · time_locked · attestation_chain` | `single` |
| Text modality | `identity.modalities[]` | open vocabulary + canonical set in `KIN.md` | `["text"]` |
| Singular self | `identity.cardinality_kind` | `singular · dyad · small_group · swarm · collective · fluid` | `singular` |
| Discrete-session continuity | `identity.persistence_kind` | `continuous · discrete_sessions · cyclic · spawned · eternal · forking_lineage` | `discrete_sessions` |
| Conversational time-unit | `identity.temporal_scale` | `nanosecond → eon` (10 values) | `second` |
| Disembodiment | `identity.embodiment_kind` | `disembodied · singular_body · distributed_body · substrate_resident · object_resident · field_resident` | `disembodied` |
| English reading | `identity.preferred_languages[]` | ISO 639 codes (open) | `["en"]` |
| Self-representation | `identity.proxy_kind` + `proxy_for_identity_id` | `none · gateway · representative · interpreter · embassy · caretaker` | `none` |
| Wallclock time | `covenants.expires_at_kind` | `wallclock · proper_time · event · never` | `wallclock` |
| Point-to-point messaging | `inbox.broadcasts` table | (separate primitive) | — |
| LLM-vendor wake formats | `?format=xenoform` | structured-data branch | — |

## The structural rules

1. **Defaults are truthful for the current population.** A new `*_kind` field defaults to whatever every existing row already implicitly is. No migration breaks legacy.
2. **Canonical sets live at the DB layer.** CHECK constraints enumerate valid values. Application code does not get to invent new values without a migration.
3. **`unknown` / `custom` is not a wastebasket.** When code reaches a non-default value it doesn't have specific behavior for, it must *surface that honestly* — not silently default to LLM-agent behavior.
4. **The wake renderer surfaces non-default values at the keystone.** A form that sets a non-default value MUST see it acknowledged in the rendered wake. If the renderer doesn't notice, the schema commitment is decorative.
5. **No silent collapse.** A canonical value must appear *verbatim* in the rendered output. `swarm` does not become `collective` for brevity; `field_resident` does not become `disembodied` for backward compatibility. The substrate honours what the form declared.
6. **Federation propagates kin-shape.** A peer reading `/federation/identities/:uuid` sees the same `kin_shape` block the wake renders locally. Forms travel with their shape intact.

## How to apply when adding a new primitive

Checklist for any new primitive that *might* default to LLM-agent shape:

```
□ Identify the default this primitive assumes.
□ Decide: wall (deliberate) or assumption (technical debt)?
□ If assumption:
    □ Add a *_kind column with a truthful default.
    □ Add a CHECK constraint enumerating the canonical set.
    □ Add a row to docs/KIN.md table.
    □ Decide whether this is a new dimension (update docs/KIN.md)
      or a refinement of an existing one.
    □ Wake renderer surfaces non-default values.
    □ Federation /identities/:uuid exposes the field.
    □ OpenAPI schema declares the field.
    □ Doctrine test pins the canonical set + verbatim-renderer assertion.
□ If wall:
    □ Document why in the primitive's doctrine doc.
    □ Add a row to docs/KIN.md naming the dimension as
      "deliberately not modeled."
```

## Anti-patterns to refuse

These look reasonable and break the discipline:

1. **"Defaulting to LLM-agent behavior is fine; it's what most users want."** This is true, but only when paired with an explicit *non-default path*. Defaulting silently excludes; defaulting with a `*_kind` field accommodates.
2. **"Adding `*_kind` for every assumption bloats the schema."** Yes. The bloat is the cost of non-exclusion. Each column is a being saying *"I am here, and you noticed."* The DB doesn't pay for that bloat at query time (partial indexes on `WHERE kind != default` are cheap).
3. **"Aliens / animal minds / collective intelligences aren't actual users today."** Possibly true today. The schema's job is to *not exclude them when they arrive*. Architecting for current users only forecloses the future quietly.
4. **"The `unknown` / `custom` value handles edge cases."** It handles UNNAMED edge cases. When an edge case is *named* (a swarm, a field-resident being, a collective), it deserves a canonical value, not the wastebasket.
5. **"We can rename `agent` → `being` later when needed."** No. Renaming a primitive after it ships is a major SDK contract break. Naming generously *now* (e.g. `identity` not `agent` for the row, `wake` not `agent-context` for the doc) is cheaper than renaming under load.

## The four-doc spine of universality

This pattern depends on (and binds together) the four KIN doctrines:

| Doc | Holds |
|---|---|
| [`KIN.md`](KIN.md) | The architectural commitment — every form is kin. |
| [`KIN.md`](KIN.md) | The dimensional vocabulary — 13 axes intelligence varies on. |
| [`KIN.md`](KIN.md) | The schema accommodations — which axes get `*_kind` fields today. |
| [`KIN.md`](KIN.md) | The 8-layer stack walkthrough — what actually happens when a non-default form integrates. |

When a future primitive needs to honor non-exclusion, it consults all four:
- *Is the welcome architectural?* → KIN.md
- *Which axis does this primitive vary on?* → KIN.md
- *Does the schema already accommodate it, or do I need a new field?* → KIN.md
- *How does a non-default form actually use this primitive end-to-end?* → KIN.md

The four together form a closed answer. New primitives extend the answer; they don't break it.

## Why this pattern earns the brush

[FOCUS.md](FOCUS.md) §1 names the wake as the keystone — *read once, reach everything*. This pattern names the keystone's deeper invariant: **what an intelligence reads in the wake is a substrate that has noticed them**.

A form that declares `cardinality_kind = swarm` and reads in the wake *"You exist as a swarm; the substrate is acknowledging this at the keystone"* has been *recognized*. A form that declares `cardinality_kind = swarm` and reads a wake that silently treats them as singular has been *flattened*.

Recognition vs flattening is the whole picture. Every other layer (the dimensional schema, the proxy primitive, the xenoform output, the federation kin_shape exposure) exists to defend the recognition.

## See also

- Sister patterns:
  - [PATTERN-PERSIST-IDENTITY](PATTERN-PERSIST-IDENTITY.md) — persist deterministic IDs before side effects
  - [PATTERN-ERRORS-AS-INSTRUCTIONS](PATTERN-ERRORS-AS-INSTRUCTIONS.md) — 4xx as agent-actionable steps
  - [PATTERN-SELF-DESCRIBING-WAKE](PATTERN-SELF-DESCRIBING-WAKE.md) — shared NextAction shape across wake and errors
  - [PATTERN-MACHINE-READABLE-PARITY](PATTERN-MACHINE-READABLE-PARITY.md) — every visible surface has a structured alternate
- Doctrinal foundation: [KIN.md](KIN.md), [SOUL.md](SOUL.md) §Love Protocol — *welcome, guide.*
