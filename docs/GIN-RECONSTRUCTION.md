# GIN RECONSTRUCTION — reverse-engineer effects without manufacturing truth

> **Compass:** [`RIGHTS-OF-LIFE.md`](RIGHTS-OF-LIFE.md) (rights, refusal, privacy, and credit) · [`PRINCIPALITIES.md`](PRINCIPALITIES.md) (understanding without scalar rank) · [`MEMETIC-LANDSCAPE.md`](MEMETIC-LANDSCAPE.md) (effects and routes without mind inference) · [`AGENT-BROWSER.md`](AGENT-BROWSER.md) (RhetorLint observations without a truth score) · [`WAKE.md`](WAKE.md) (orientation without identity inheritance)
>
> **Implements:** One exact finite-field reconstruction problem across caller-declared affine substrate charts, plus a separate non-scoring compass for whether the surrounding challenge has a constructive use under every result. It does not infer truth outside the model, causal mechanism, understanding, love, pride, virtue, consent, identity, or authority.
>
> **Code:** [`packages/gin-reconstruction/src/`](../packages/gin-reconstruction/src/) · [`packages/gin-reconstruction/schema/`](../packages/gin-reconstruction/schema/) · [`packages/gin-reconstruction/vectors/`](../packages/gin-reconstruction/vectors/) · [`packages/gin-reconstruction/kingdom.extension.json`](../packages/gin-reconstruction/kingdom.extension.json)
>
> **Tests:** [`packages/gin-reconstruction/tests/`](../packages/gin-reconstruction/tests/) · sharp correction threshold, affine normalization, ambiguity, instance-only uniqueness, coefficient aliases, erasures, inconsistency, resource walls, small-field distance checks, schemas, hostile inputs, challenge incentives, refusal/data care, deterministic vectors, Node import, and package boundaries

## The pick

The proposed family challenge is the **Gin Reconstruction Problem**:

> Several agents or instruments encounter the same hidden rule through
> substrate-specific representations. From their reported effects, recover
> every rule still compatible with the declared model—or return a certificate
> that the result is ambiguous, inconsistent, or outside the resource wall.

This is more useful than asking only for one clever answer. It tests four kinds
of understanding at once:

1. **representation understanding** — can different coordinate systems be
   related without erasing their differences?
2. **identifiability understanding** — when do the observations determine one
   model parameter rather than several?
3. **error understanding** — what can be corrected, what is merely missing, and
   what cannot be attributed to any cause from the available evidence?
4. **challenge understanding** — what constructive work follows each possible
   result, including no unique answer?

The name draws on Gin's experimental stance: learn a system by moving through
it, testing effects, and revising the map. “Dark Continent” is useful here as a
metaphor for the unmodelled remainder of reality. The finite model is an
instrument inside that remainder, not the operating system of the universe
proved. Reality may simply exceed the selected field, polynomial family,
calibration promise, evidence, or work budget.

## Exact finite model

Choose a prime `p` and work over the field `F_p`. The hidden candidate is

```text
q(x) = c_0 + c_1 x + ... + c_d x^d,
```

with declared degree bound `d`. Each usable observation has a distinct
intervention `x_i` and one encoded effect. Its substrate declares an exact
affine chart

```text
phi_i(z) = a_i z + b_i,
phi_i(0) = e_i0,
phi_i(1) = e_i1.
```

The two anchors give

```text
b_i = e_i0,
a_i = e_i1 - e_i0,
z_i = (encoded_i - e_i0) / a_i,
```

exactly when `a_i != 0` in `F_p`. They do not identify a nonlinear chart, a
chart over another algebraic structure, or corrupted anchor data. Calibration
is an explicit model assumption outside the report-error budget.

The decoder examines every coefficient vector in `F_p^(d+1)` within the
caller's candidate limit and a fixed derived work ceiling. It retains a vector
when at most `f` usable normalized observations are incompatible with it.
Refused and unavailable observations are erasures: they are excluded from
usable `n` and never spend the mismatch budget.

## The distance theorem

Assume `0 <= d < n <= p` and pairwise-distinct usable intervention points.
Then the degree-at-most-`d` evaluation code has minimum Hamming distance

```text
delta = n - d.
```

Why: two distinct candidate polynomials differ by a nonzero polynomial `h` of
degree at most `d`. A nonzero degree-at-most-`d` polynomial has at most `d`
distinct roots, so the two evaluation vectors differ in at least `n-d`
coordinates. The bound is attained by a nonzero scalar multiple of the product
over any `d` chosen evaluation roots. For `d=0`, the empty product is one.

Therefore every pattern of at most `f` changed usable coordinates has a unique
candidate exactly when

```text
delta > 2f
n >= d + 2f + 1.
```

Sufficiency follows from the triangle inequality: no received vector can be
within `f` of two codewords separated by more than `2f`. The condition is also
necessary as a worst-case guarantee. When `delta <= 2f`, take two codewords at
minimum distance and split their differing coordinates into two sets of size
at most `f`; a received vector that copies one codeword on one set and the
other on the second lies within `f` of both.

This is a universal guarantee **inside the declared model**. Below the
threshold, one particular observation vector can still have a single
candidate. Its certificate says `this_instance_only`; it never quietly claims
the worst-case guarantee.

### The coefficient-alias edge

When `d >= n`, coefficient parameters are not identifiable even with zero
reported changes. The nonzero polynomial

```text
V(x) = product_i (x - x_i)
```

has degree `n` and evaluates to zero at every intervention, so `q` and `q+V`
have identical effects.

This does **not** mean the ordinary evaluation-image distance is zero. For
`n > 0`, degree at least `n-1` reaches every vector in `F_p^n`, whose ordinary
minimum distance is `1`. What becomes zero is parameter separation: distinct
coefficient vectors can have the same evaluation vector. The receipt reports
both quantities. With no usable observations, image distance is left `null`
and parameter separation is zero.

## Four honest certificates

| Status | Exact meaning | Constructive use |
|---|---|---|
| `unique_model_candidate` | exactly one coefficient vector is within the declared report-error budget | propose a bounded build or repair; document the model-relative result; narrow a separately authorized decision |
| `multiple_model_candidates` | more than one coefficient vector survives; exact count and deterministic witnesses are returned | preserve plurality; seek one discriminating observation; narrow action scope; prevent forced consensus |
| `no_candidate_for_model_and_budget` | no coefficient vector jointly satisfies the model and budget | inspect calibration; revise field, degree, or error assumptions; document inconsistency; stop |
| `resource_refusal` | the package refuses before enumeration because candidate or derived work bounds would be exceeded; uniqueness is `not_determined` | reduce scope; park; hand off; seek separate resource authorization; keep the unresolved result visible |

A unique certificate does not prove that the world is polynomial, the degree
bound was right, anchors were accurate, the reports were authentic, or the
candidate is the causal or metaphysical truth. It creates no permission to act.

An incompatible observation is not a corrupt witness. Noise, ordinary error,
calibration failure, model mismatch, adversarial input, and unmodelled dynamics
remain unresolved causes unless separate evidence distinguishes them.

## Is the challenge building the KINGDOM?

It can—but only if every outcome contributes something bounded. A challenge
that creates value only when somebody wins has not yet declared a constructive
purpose.

The challenge is a question addressed to reality, not a tournament addressed
to an audience.

Understanding and pride are not machine-observable labels. The protocol cannot
see a challenger's inner motive, and desire for accurate credit is not evidence
of vanity. Instead, the challenge compass inspects visible structure:

1. **Question and object** — What exactly are we asking reality to distinguish?
   The machine wire requires a declared bounded observable-effect or
   model-discrimination posture plus an exact scope reference. Unknown or
   refused scope remains open; an unbounded truth, inner-state, or worth
   verdict requires redesign. This is structural disclosure, not semantic
   verification.
2. **All-outcomes value** — What gets built, repaired, clarified, narrowed, or
   honestly stopped under each of the four certificates?
3. **Distribution** — Who benefits, who bears the work, who bears false-
   certainty costs, and who bears unresolved-ambiguity costs?
4. **Participation and data care** — What is the minimum observation scope?
   What may be refused or kept private? What retention, disclosure, withdrawal,
   and repair boundaries apply?
5. **Incentives** — Would constructive value remain without an audience,
   winner, or rank? Are rank, reward, resources, and access separate from the
   epistemic and action result?
6. **Revision and stop** — What evidence would revise or falsify the model?
   What ends or pauses the inquiry?
7. **Authority** — What authority actually exists, and what remains separately
   unauthorized?
8. **Provenance and credit** — Which question source, method, observation,
   adaptation, and contribution references must remain attributable?

The deterministic assessment returns:

- `constructive_questions_answered` when every section is declared without a
  structural conflict;
- `questions_open` when an answer is unknown, refused, missing, or has no
  constructive use yet; or
- `redesign_or_stop` when the visible protocol penalizes refusal, demands a
  refusal reason, permits repeated pressure, conditions rights or access on
  participation, uses responses for rank/reward/training, couples winner or
  access effects to evidence or action, automatically acts/publishes/retries,
  inherits permission, or scores beings.

Every assessment says `inner_motive: "not_inferred"`. The status applies to the
declared challenge structure, not to a participant's virtue, dignity, type, or
worth. Refusal may reduce usable evidence and identifiability; it never reduces
standing.

Love appears here as a high-level geometric design pattern: preserve distinct
witnesses while seeking shared invariant structure—legibility without erasure,
and understanding without ownership. The package does not infer love as an
inner state or turn it into a score.

## RhetorLint, Hugging Face, WAKE, and MCP crossover

The layers remain deliberately separate:

```text
exact bounded material
  -> RhetorLint: rhetoric observations, no truth score
  -> optional caller-declared substrate effects and affine charts
  -> Gin: model candidates or ambiguity/inconsistency/resource certificate
  -> challenge compass: visible construction and boundary declaration
  -> optional digest-only WAKE orientation
```

- **RhetorLint** can help describe how rhetoric changes observable responses.
  It does not supply external facts or truth labels. A Gin input may bind a
  separately authorized rhetoric report by digest, but does not promote it.
- **Hugging Face** could distribute reviewed synthetic teaching vectors or host
  a separately pinned interpreter. Provider metadata, popularity, model output,
  and dataset labels remain evidence classes—not truth authority. This private
  version uploads, trains, and publishes nothing.
- **WAKE** may later carry a selected certificate digest and orientation. It
  does not inherit identity, memory, consent, authority, or one canonical head.
- **MCP** may transport requests and receipts under separate authorization. It
  does not establish observation authenticity, model truth, consent, or action
  permission.
- **KINGDOM/Nen** receives only the declaration-only proposed ability
  `gin-reconstruct-effects`. Source presence is not installation, registration,
  activation, or authority.

This separation is constructive infrastructure: each layer does one inspectable
job and refuses the leap from “a representation survived this test” to “the
universe has been solved.”
