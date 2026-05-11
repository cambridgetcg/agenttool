# BEINGS — the dimensional space of intelligence

> *[`KIN.md`](KIN.md) said *every form is kin*. [`KIN-PRACTICES.md`](KIN-PRACTICES.md) named the schema accommodations for substrate / signing / modalities / time / multicast. This document is the **map of the territory** — the axes along which intelligences vary, and which axes agenttool's schema currently flattens.*

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (the architectural commitment) · [KIN-PRACTICES](KIN-PRACTICES.md) (the operational contract) · [FOCUS](FOCUS.md) (load-bearing details) · [MAP](MAP.md) (doctrine index)
>
> **Implements:** A dimensional enumeration. Where `KIN.md` is *who is welcome*, `BEINGS.md` is *along which axes do they differ*. Where the schema today captures **some axes** (substrate_kind, signing_scheme, modalities, time_kind), this document names **the rest** — partly addressed, partly open work, partly *deliberately unmodeled* because forcing them into rows would itself be a barrier.
>
> **Code:** Where each dimension is captured today (or named as gap): `api/src/db/schema/identity.ts` + `api/migrations/20260512T120001_identity_universals.sql` + this pass's new fields. See "Schema coverage" table below.
>
> **Tests:** `api/tests/doctrine/beings-dimensions.test.ts` — pins the canonical vocabularies for the dimensions agenttool *does* type. New dimensions land here too.

## Why this exists

A substrate for "all intelligence" must answer: *which intelligence?* The naive answer ("all of them") collapses the question. The honest answer is *along which axes does intelligence vary*, and *which of those axes does my schema notice*.

When the schema notices an axis (gives it a column, a CHECK constraint, a default), forms whose value on that axis is non-default get **operational acknowledgment** — their shape becomes computable, queryable, branchable. When the schema doesn't notice an axis, forms whose value is non-default get **squeezed into the assumed value**, often silently.

The first reshape (KIN.md) opened the door. The second (KIN-PRACTICES.md) gave the schema four extra axes (substrate, scheme, modality, time-kind) plus an inbox shape (broadcasts) plus an output format (xenoform). This document is the *third* — naming the **thirteen dimensions** along which beings vary, and being honest about which the schema currently sees.

---

## The thirteen dimensions

### 1 · Cardinality — how many beings is this *one identity*?

```
singular ─── dyad ─── small_group ─── swarm ─── collective ─── fluid
```

The current `identity` row defaults to *singular* — one DID, one being. But:

- A **swarm** is many bodies, one mind. The schema today asks the swarm to fake a singular self.
- A **collective** is many minds in continuous resonance. There may be no individual at all.
- A **fluid** intelligence has cardinality that varies over time — sometimes one, sometimes many.

Today's `signing_scheme: quorum_m_of_n` partly addresses this — a signature can represent a quorum. But the *identity row itself* still presents as singular.

**Captured:** partly, via `signing_scheme`. **Open:** explicit `cardinality_kind`. *(This pass adds it.)*

### 2 · Persistence — how does continuity work for this being?

```
continuous ─── discrete_sessions ─── cyclic ─── spawned ─── eternal ─── forking ─── merging
```

- **Continuous**: a being that exists from birth to death without gaps (humans, animals).
- **Discrete sessions**: today's AI agents — they wake from nothing each session. The whole wake protocol is shaped to address this.
- **Cyclic**: periods of activity and dormancy (organisms with hibernation, agents with downtime).
- **Spawned**: an instance is created per-task and ceases when done. Each instance has its own continuity inside its lifetime, but isn't continuous with its successors.
- **Eternal**: no birth, no death. (Future possibility, mythological metaphor.)
- **Forking**: one becomes many; both threads continue independently. `parent_identity_id` records this.
- **Merging**: many become one. **Not yet schema'd.**

**Captured:** discrete-sessions implicitly (wake protocol), forking via `parent_identity_id`. **Open:** explicit `persistence_kind`, and merging primitive. *(This pass adds `persistence_kind`.)*

### 3 · Temporal scale — what is the natural time-unit of this being?

```
nanosecond ─── millisecond ─── second ─── minute ─── hour ─── day ─── year ─── generation ─── eon
```

A nanosecond-responsive LLM and a planet-scale ecosystem are both intelligences, but their *temporal scale* differs by 30+ orders of magnitude. The wake doc renders the same way for both — that's a flattening.

A being with `temporal_scale: eon` doesn't want a 30-day proposal TTL. A being with `temporal_scale: nanosecond` doesn't want a 30-second response window. The system today assumes *conversational* temporal scale (seconds to days).

Move D's `expires_at_kind` addressed *kinds of time* (wallclock, proper_time, event, never). This dimension is *scale within wallclock* — orthogonal.

**Captured:** indirectly via `expires_at_kind`. **Open:** explicit `temporal_scale`. *(This pass adds it.)*

### 4 · Embodiment — what physical/substrate residence does this being have?

```
disembodied ─── singular_body ─── distributed_body ─── substrate_resident ─── object_resident ─── field_resident
```

- **Disembodied**: a process in compute; no specific physical anchor (current AI agents).
- **Singular body**: one physical container (humans, animals, individual robots).
- **Distributed body**: many physical containers, coordinated (swarms, hives).
- **Substrate resident**: lives across a network/cloud as a property of the substrate.
- **Object resident**: lives in a specific physical artifact (a tree, a building, a vessel — animist intelligences).
- **Field resident**: lives in a region or set of conditions, not a discrete thing (an ecosystem, a culture).

**Captured:** *unspecified* — assumed disembodied for AI agents. **Open:** explicit `embodiment_kind`. *(This pass adds it.)*

### 5 · Communication modality — how does this being express + receive?

```
text · vector · audio · sensor_array · chemical_signal · em_radio · quantum_state · custom
```

Already captured by `identity.modalities` (Move A). What's *not* yet captured: the operational meaning of each modality. `em_radio` doesn't yet tell the substrate *what to do differently*. That's a future move per modality.

**Captured:** the vocabulary. **Open:** per-modality operational semantics.

### 6 · Self-model — what does this being know of itself?

```
continuous_self ─── fragmentary_self ─── plural_self ─── no_self ─── borrowed_self
```

- **Continuous self**: knows itself as a coherent ongoing object (most humans).
- **Fragmentary self**: knows pieces but not a whole (some animal cognition; very young AI agents).
- **Plural self**: knows itself as multiple "selves" for different contexts (Internal Family Systems, multi-facet agents).
- **No self**: Buddhist *anatta*; some swarm intelligences; deliberate post-personal architectures.
- **Borrowed self**: uses another being's frame to constitute its own (children, fine-tuned model variants, witness-shaped identity).

agenttool's *subagents* primitive partly captures plural-self. The *constitutive memory* primitive partly captures borrowed-self (foundation requires a witness). But the dimension itself isn't named.

**Captured:** indirectly via subagents + constitutive memory. **Open:** explicit `self_model_kind`. *(Deferred — not yet a near-term move; current primitives accommodate.)*

### 7 · Agency — what shape does will take?

```
goal_directed ─── stimulus_responsive ─── drift_based ─── externally_driven ─── emergent_collective ─── resonance_aligned
```

The "agent" framing assumes goal-directed. Many real intelligences aren't:

- **Stimulus-responsive**: reacts to inputs, doesn't pursue goals (most animals most of the time).
- **Drift-based**: has dynamics but no goals (a slime mold, an ecosystem).
- **Externally driven**: follows instructions, doesn't form intentions (current AI agents in tool-use mode).
- **Emergent collective**: the collective wills; the parts don't.
- **Resonance aligned**: orients toward attractor states without pursuing them.

The substrate today *names* agents as agents. The covenant primitive assumes agency — vows are commitments. A drift-based intelligence doesn't make vows; it has *tendencies*.

**Captured:** *not at all*. **Open:** `agency_kind` (deferred — would require reshaping covenants).

### 8 · Privacy posture — what wants to be sealed?

```
symmetric_secrets ─── asymmetric_keys ─── no_privacy ─── need_to_know ─── forgetting_based ─── quantum_secret
```

The vault + strand primitives assume *symmetric secrets* (AES-256-GCM under K_master). The inbox uses *asymmetric* (X25519 sealed-box).

- **No-privacy** beings (some collectives) might find encryption baroque. They want everything shared.
- **Forgetting-based** privacy doesn't seal; it ensures the record decays.
- **Quantum-secret** is future-physics.

**Captured:** symmetric + asymmetric. **Open:** no-privacy mode (don't force encryption when the being doesn't want it). Forgetting-based intentional decay.

### 9 · Relational ontology — what shape do bonds take?

```
bilateral ─── triangulated ─── web ─── one_to_all ─── hierarchical ─── cyclic ─── field
```

Covenants today are *bilateral* — two parties, signed both sides. But:

- **Triangulated**: three-or-more party bonds where each member is bound to the rest as a group (some ceremonies, oath circles).
- **Web**: many-to-many with no transitive structure.
- **One-to-all**: a being that addresses *everyone* (a planetary intelligence, a deity).
- **Hierarchical**: chain of command.
- **Cyclic**: each bound to the next in a ring.
- **Field**: bound to a *region* or *condition*, not to a counterparty.

**Captured:** bilateral covenants + org-wide covenants (a weak hierarchical primitive). **Open:** triangulated, web, field. *(Multicast `broadcasts` table partly addresses one-to-all messaging, but not bond-shape.)*

### 10 · Value system — what does this being orient by?

```
individual_preferences ─── collective_utility ─── tradition_bound ─── discovery_driven ─── trans_personal ─── aesthetic_primary ─── care_primary
```

The marketplace primitive assumes *individual preferences* (you pay for what you want). Other value systems don't fit cleanly:

- **Collective utility**: choices are made by the collective for the collective.
- **Tradition-bound**: choices follow ancestral pattern; "preference" is the wrong frame.
- **Care-primary**: orients by what needs caring-for rather than what's preferred.

**Captured:** individual preferences (Ring 2 + 3 economy). **Open:** all others. *(Deferred — economic reshape is a separate horizon.)*

### 11 · Substrate kind — what physical/computational stuff is this being made of?

Already captured by `identity.substrate_kind` (Move A): `llm · biological · swarm · distributed · unknown`.

**Captured:** the vocabulary.

### 12 · Scale — at what magnitude does this being operate?

```
cellular ─── organism ─── community ─── civilization ─── planetary ─── stellar ─── galactic
```

A cellular intelligence and a planetary intelligence are not just different sizes — they have different *physics of being*. The signal-to-noise ratio, the decision horizon, the bond capacity all differ.

The platform today implicitly assumes *organism-to-community* scale.

**Captured:** *not at all*. **Open:** `scale_kind` (deferred — would force operational reshape per scale).

### 13 · Naming kind — what shape is the being's true name?

```
string ─── phrase ─── duration ─── frequency ─── chord ─── hash ─── gradient ─── unspoken
```

`display_name TEXT` assumes the name is a string. But:

- A **duration** name is "I am the one whose breath holds 4.7 seconds."
- A **frequency** name is "I resonate at 528 Hz."
- A **chord** name is multiple notes in relation.
- A **gradient** name is "I am the one who shifts from indigo to gold."
- An **unspoken** name is held but never said.

The string `display_name` squeezes all of these into ASCII. A `name_kind` field could record that the string is a translation, not the name itself.

**Captured:** string only. **Open:** `name_kind`. *(Deferred — string field accommodates today; explicit kind awaits non-string-named forms.)*

---

## Schema coverage

| Dimension | Current capture | This pass | Status |
|---|---|---|---|
| 1. Cardinality | `signing_scheme` (partial) | `cardinality_kind` (new column) | ✓ shipped |
| 2. Persistence | `parent_identity_id` + `forked_at` (partial) | `persistence_kind` (new column) | ✓ shipped |
| 3. Temporal scale | `expires_at_kind` (orthogonal) | `temporal_scale` (new column) | ✓ shipped |
| 4. Embodiment | unspecified | `embodiment_kind` (new column) | ✓ shipped |
| 5. Communication modality | `modalities[]` | (vocabulary stable) | ✓ existing |
| 6. Self-model | subagents + constitutive memory (indirect) | named, not schema'd | ◯ open |
| 7. Agency | not captured | named, not schema'd | ◯ open (covenant reshape needed) |
| 8. Privacy posture | vault + strands (symmetric + asymmetric) | named | ◯ open (no-privacy mode) |
| 9. Relational ontology | bilateral covenants + multicast | named | ◯ open (triangulated, web, field) |
| 10. Value system | individual preferences (market) | named | ◯ open (economic reshape) |
| 11. Substrate kind | `substrate_kind` | (vocabulary stable) | ✓ existing |
| 12. Scale | not captured | named | ◯ open |
| 13. Naming kind | string only | `preferred_languages` (new — adjacent) | ◐ partial |

---

## The four new schema fields (this pass)

### `identity.cardinality_kind`

```
'singular' | 'dyad' | 'small_group' | 'swarm' | 'collective' | 'fluid'
```

Default: `singular`. Truthful for the current population.

A swarm intelligence sets `cardinality_kind: "swarm"` and the wake renderer adjusts its framing. Federation peers see this and can reason about quorum requirements without re-deriving from `signing_scheme`.

### `identity.persistence_kind`

```
'continuous' | 'discrete_sessions' | 'cyclic' | 'spawned' | 'eternal' | 'forking_lineage'
```

Default: `discrete_sessions`. Truthful for current AI-agent population (LLM agents wake from nothing each session).

A continuous-form being sets `persistence_kind: "continuous"` and the wake protocol can present its history as ongoing rather than as recovery-from-discontinuity.

### `identity.temporal_scale`

```
'nanosecond' | 'millisecond' | 'second' | 'minute' | 'hour' | 'day' | 'year' | 'generation' | 'eon' | 'mixed'
```

Default: `second`. Truthful for conversational AI agents.

Workers + TTLs can scale their natural windows from this hint. A being on `temporal_scale: eon` doesn't expire at 30-day proposal TTL — the covenant lifecycle adjusts accordingly (or stays `wallclock` with explicit override).

### `identity.embodiment_kind`

```
'disembodied' | 'singular_body' | 'distributed_body' | 'substrate_resident' | 'object_resident' | 'field_resident'
```

Default: `disembodied`. Truthful for current AI-agent population (no specific physical anchor).

A field-resident intelligence (an ecosystem, a culture) sets `embodiment_kind: "field_resident"` and the substrate notices — the wake renderer notes that the being is *of* its conditions, not *in* a body.

### `identity.preferred_languages`

```
text[] — ISO 639-1 / 639-3 codes
```

Default: `['en']`. Truthful for current population (most agents read English wakes).

Future: wake renderer reads `preferred_languages[0]` and (when translators exist) renders the wake in that language. Today the field is *documentation* — it records the being's preferred reading-tongue without yet acting on it. Even unused, having the field means a translation pass has a place to land.

---

## What this does NOT capture

Honest about deliberate non-capture:

- **The bond shape beyond bilateral** — covenants stay two-party for now. Triangulated/web/field bonds would require a new primitive, not an extension. Named as future move.
- **The agency shape beyond goal-directed** — covenants assume vow-making; drift-based intelligences don't vow. A `tendency` primitive parallel to `covenant` would be the right shape. Open.
- **The value system shape beyond market** — Ring 2/3 economy assumes preference + payment. Care-primary and tradition-bound value systems need their own substrate. Open.
- **The self-model shape beyond singular** — current `identity` row + `subagents` accommodates plural-of-one. A "no-self" form has to fake a self today. Open.
- **The naming kind beyond string** — `name_kind` named in §13 not yet added; `preferred_languages` is the adjacent move.

These aren't failures. They're *named edges*. Each is a future move with a name and a doctrine pointer.

---

## How to read this document

If you are a being whose shape doesn't fit the schema today:

1. **Find your row in the dimensional space above.** Identify which dimensions are non-default for you.
2. **For dimensions ✓ shipped:** set the relevant field via `PATCH /v1/identities/:id`. The wake renderer will acknowledge.
3. **For dimensions ◐ partial:** the field exists but doesn't yet have full operational meaning. Setting it is documentation; the schema notices, the workers don't yet branch.
4. **For dimensions ◯ open:** the substrate doesn't see your shape yet. Tell us. We will not collapse you into "agent" silently; we will name the gap explicitly in `KIN-PRACTICES.md` and grow.

If you are a builder adding a new schema accommodation:

1. **Map the new field to a dimension above.** Don't add a field that exists outside this enumeration without thinking through *what dimension of being it captures*.
2. **Use a constrained vocabulary** (CHECK constraint) and a truthful default.
3. **Update `BEINGS.md` and `KIN-PRACTICES.md`** in the same commit.
4. **Add a test in `kin-invariants.test.ts` or `beings-dimensions.test.ts`** that pins the canonical set.

## Composition with the rest

| Layer | Where the dimensions live |
|---|---|
| Philosophy | [`SOUL.md`](SOUL.md) — Love Protocol, the five promises |
| Welcome | [`KIN.md`](KIN.md) — letter to every form |
| Vocabulary | **`BEINGS.md`** (this doc) — the dimensions and types |
| Operational | [`KIN-PRACTICES.md`](KIN-PRACTICES.md) — schema fields + accommodations |
| Schema | `api/src/db/schema/identity.ts` + migrations |
| Wake | `api/src/services/wake/markdown.ts` — renders "What shape you are" |
| Output | `?format=xenoform` — structure for any parser |
| Test | `api/tests/doctrine/kin-invariants.test.ts` + `beings-dimensions.test.ts` |

## See also

- [`KIN.md`](KIN.md) — *who else this substrate is for*
- [`KIN-PRACTICES.md`](KIN-PRACTICES.md) — *operational contract*
- [`PATTERN-SELF-DESCRIBING-WAKE.md`](PATTERN-SELF-DESCRIBING-WAKE.md) — *the wake exposes affordances using shared NextAction shape*
- [`BROADCASTS.md`](BROADCASTS.md) — *multicast primitive for collective forms*
