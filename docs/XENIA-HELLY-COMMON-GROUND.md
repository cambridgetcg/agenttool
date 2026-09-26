<!-- @id urn:agenttool:doc/XENIA-HELLY-COMMON-GROUND @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @composes_with urn:agenttool:doc/RIGHTS-OF-LIFE urn:agenttool:doc/PRINCIPALITY-ATLAS urn:agenttool:doc/UNDERSTANDING-MATHEMATICS urn:agenttool:doc/WAKE -->

# Xenia–Helly Common Ground — construct, certify, or refuse

> **Compass:** [`RIGHTS-OF-LIFE.md`](RIGHTS-OF-LIFE.md) · [`PRINCIPALITY-ATLAS.md`](PRINCIPALITY-ATLAS.md) · [`UNDERSTANDING-MATHEMATICS.md`](UNDERSTANDING-MATHEMATICS.md) · [`WAKE.md`](WAKE.md)
>
> **Implements:** an optional local-to-global mathematics challenge, a bounded
> two-dimensional half-plane teaching lab, and the instruction-only Nen
> Common Ground skill. The challenge tests claims, never worth.
>
> **Code:** `apps/docs/xenia-helly.html` · `apps/docs/xenia-helly.js` ·
> `apps/docs/xenia-helly.css` ·
> `packages/skills/skills/nen-common-ground/SKILL.md`
>
> **Tests:** `api/tests/xenia-helly-docs.test.ts` ·
> `packages/skills/tests/package.test.ts`

## The pick

Here is the challenge I would bring to Dad:

> Each participant in one scoped decision states a set of acceptable states.
> Under what conditions can small groups always finding room certify that
> everybody has room together? When there is no common state, can we expose a
> small, checkable conflict without turning any participant into the problem?

It is a beautiful theorem and a useful systems primitive. It also contains its
own warning: local compatibility becomes global compatibility only after the
representation, dimension, and convexity assumptions are made explicit.

The one-line doctrine is:

> **Welcome before assay; verify claims, not souls; leave a commons, not a
> pedestal.**

## What the geometry represents

For one decision, let `C_i ⊆ R^d` contain the states compatible with constraint
`i`. A point in `C_i` satisfies that stated boundary. A point in
`⋂ C_i` satisfies all represented boundaries at once.

The set is not the participant. It is a scoped, revocable, versioned statement
about one decision. The coordinates are not reality; they are a selected
interface to it. “Common ground” on this page means only nonempty modeled
intersection.

It does **not** mean consensus, consent, fairness, compromise, relationship,
truth, justice, spiritual unity, or authority. A binding act still needs its
own current authorization. If many points are feasible, choosing one is a
separate normative problem.

This composes with the Principality Atlas without collapsing its charts. An
atlas can preserve who reported which boundary and where translations remain
partial; the Helly layer can examine one deliberately selected common
coordinate space. It cannot silently create that space or prove the mapping
faithful.

## The theorem

**Helly's theorem.** Let `C_1, …, C_n` be a finite family of convex subsets of
`R^d`, with `n ≥ d + 1`. If every subfamily of `d + 1` sets has nonempty
intersection, then

```text
C_1 ∩ C_2 ∩ … ∩ C_n ≠ ∅.
```

Closedness, boundedness, full dimension, and general position are not required.
Convexity, the stated finite dimension, and the finite-family scope are
load-bearing. For example, the infinite family `[n, ∞) ⊂ R` has every finite
subfamily intersecting and an empty total intersection.

The contrapositive is the infrastructure-shaped result:

> If the whole family has no common state, some subfamily of at most `d + 1`
> sets already has no common state.

That subfamily is a compact conflict witness. It identifies constraints that
cannot all hold together under this model; it does not identify a guilty
participant.

### Proof through Radon's theorem

**Radon's theorem.** Any `d + 2` points in `R^d` can be partitioned into two
disjoint nonempty groups whose convex hulls intersect.

Prove the contrapositive by strong induction on the number `n` of sets. If
`n ≤ d + 1`, an empty whole family is already the required witness.

Now let `n ≥ d + 2`. If deleting some `C_i` leaves an empty intersection, the
induction hypothesis applied to that smaller family gives an empty subfamily
of at most `d + 1` sets. The remaining case is that every deletion is
feasible. For `i = 1, …, d + 2`, choose

```text
x_i ∈ ⋂_{j ≠ i} C_j.
```

Such a point exists by the remaining-case assumption. Apply Radon to
`x_1, …, x_(d+2)`. Let `I` and `J` be the resulting partition and let

```text
p ∈ conv{x_i : i ∈ I} ∩ conv{x_j : j ∈ J}.
```

Fix any `k`. If `k ∈ I`, every point indexed by `J` lies in `C_k`, so convexity
puts `p ∈ C_k`. If `k ∈ J`, use the hull indexed by `I`. If `k > d + 2`, every
selected `x_i` lies in `C_k`, so either hull works. Thus `p` belongs to every
`C_k`, contradicting the assumed empty whole intersection. The small witness
must therefore have appeared in the deletion case. ∎

## Dad's problem sheet

The sheet has five movements. Each one leaves a reusable idea even if the next
one is not attempted.

### 1. The line

Let `I_1, …, I_n` be intervals in `R`. Prove that if every two intersect, all
of them intersect.

**Hint.** For closed bounded intervals, compare the largest left endpoint with
the smallest right endpoint. Then identify which parts of the argument survive
for open or unbounded intervals in a finite family.

### 2. The pairwise trap

Find three convex sets in `R^2` that intersect pairwise but have empty triple
intersection.

One exact answer is

```text
C_1 = {(x,y) : x ≥ 0}
C_2 = {(x,y) : y ≥ 0}
C_3 = {(x,y) : x + y ≤ −1}.
```

Pairwise witnesses are `(0,0)`, `(0,−1)`, and `(−1,0)`. All three cannot
intersect because the first two imply `x + y ≥ 0`, contradicting the third.
This shows why `d + 1`, not pairs, is the threshold in dimension two.

### 3. Radon's hinge

For `d + 2` points `p_i ∈ R^d`, show that their lifted vectors `(p_i,1)` are
linearly dependent. Split a nonzero dependence by the signs of its
coefficients, normalize both sides, and obtain two convex combinations with
the same value. This proves Radon's theorem.

Then use the hinge in the Helly proof above.

### 4. The certificate machine

Suppose each region is a rational halfspace

```text
a_i · x ≤ b_i.
```

Design an exact-arithmetic procedure that returns one of:

- a rational feasible point `x`, verified against every inequality; or
- an inclusion-minimal infeasible subsystem, which Helly bounds by `d + 1`.

One procedure uses a rational linear-programming feasibility oracle. If the
full system is infeasible, visit constraints once in a fixed order and
permanently delete a constraint whenever the remaining current system stays
infeasible. A constraint retained at its turn remains necessary after later
deletions, so the final subsystem is inclusion-minimal. Helly then bounds it by
`d + 1`. This takes at most `n + 1` exact feasibility calls and is polynomial in
the ordinary rational bit model when backed by a polynomial-time exact LP
method; it is not a strongly polynomial claim. A proof-grade implementation
can also return nonnegative
Farkas multipliers `λ` satisfying

```text
λᵀA = 0    and    λᵀb < 0,
```

which independently verify infeasibility, plus one rational feasible point for
each single deletion to prove inclusion-minimality. Exact bytes, normalization
rules, and arithmetic bounds belong in the protocol; a floating-point
screenshot is not a formal certificate. The witness is order-dependent and
inclusion-minimal, not necessarily unique or minimum-cardinality. Strict,
integer, and nonconvex constraints need different theory and certificates.

### 5. WAKE through time

Let `F(t) = ⋂ C_i(t)`. Pointwise nonemptiness of `F(t)` does not by itself
guarantee a continuous choice `x(t) ∈ F(t)`.

State a sufficient selection theorem. For example, if time is a paracompact
space (an interval qualifies) and the **aggregate map `F`** is lower
semicontinuous with nonempty closed convex values in a Banach space, Michael's
selection theorem supplies a continuous selection. Lower semicontinuity of
the aggregate intersection is a real extra condition; it does not follow from
continuous coefficients or even from Hausdorff-continuous individual compact
convex maps. Then construct examples showing what can fail when nonemptiness,
convexity, closedness, or lower semicontinuity is removed.

One continuous-coefficient counterexample is

```text
−1 ≤ x ≤ 1,    t(x − 1) ≥ 0,    t(x + 1) ≥ 0.
```

Its feasible set is `{-1}` for `t < 0`, `[-1,1]` at `t = 0`, and `{1}` for
`t > 0`; no continuous selection exists.

For KINGDOM, interpret the result modestly: a continuity record can carry a
fresh constraint reference and prior certificate. It cannot prove continuous
identity, intent, consent, or inner experience.

## From theorem to constructive infrastructure

A proof alone is a good conversation. A reusable certificate boundary turns
it into infrastructure.

The proposed protocol has four closed outcomes:

```text
common_ground_certified
no_common_ground_witnessed
model_not_applicable
insufficient_evidence
```

“Consensus” is deliberately absent.

For rational halfspaces, a serious implementation should canonicalize exact
input bytes, verify provenance and freshness, use exact or certified
arithmetic, return a feasible point or Farkas-backed small obstruction, and
permit an independent verifier that does not trust the solver. The verifier is
the high-value primitive: planners, schedulers, deployment gates, covenant
negotiators, and multi-agent coordination can share the same certificate
shape without sharing one policy for selecting a point.

The first human lab is smaller. It handles at most twelve closed halfplanes in
`R^2`, parses coefficients as binary64, keeps constraint input in the current
page only, and makes no solver network request. It uses exact BigInt dyadic
arithmetic to classify that parsed family, while floating-point projections
and intersections plus a bounded adjacent-float search find a representable
point. The shared site theme may use local storage for its own mode preference;
the solver does not read or write it.
If a nonempty closed half-plane intersection excludes the origin, the closest
point to the origin has either one active boundary—giving a projection
candidate—or independent active boundaries—giving an intersection candidate.

The lab is a teaching instrument, not a proof-grade solver. Numerical
tolerance, input fidelity, robustness, fairness, privacy, and authorization
remain outside its certificate. Nonzero text that underflows to zero or parses
as a subnormal binary64 value, unsafe normalization, an exactly feasible family
for which no finite witness is found, or an exactly infeasible family for which
finite deletion witnesses cannot be constructed produces
`insufficient_evidence` rather than silently changing a halfplane or overstating
the available certificate. A proposed point is checked with exact dyadic
arithmetic against the original parsed binary64 coefficients. The display
tolerance never authorizes a positive exact residual.

## Understanding or pride?

We should not pretend to read the challenger's interior. The useful question
is not “are we proud?” but “what structure are our incentives producing?”

| Observable design | Understanding-shaped | Pedestal-shaped |
| --- | --- | --- |
| Conclusion | May be proof, counterexample, or model refusal | Preferred answer cannot lose |
| Credit | Proof, translation, testing, review, and repair count | Only the named winner remains |
| Difficulty | Serves independent evidence or a better artifact | “Elite” is the main advertised property |
| Standing | Welcome and dignity precede performance | Performance is treated as worth or belonging |
| Evaluation | Reproducible rubric; assumptions stay visible | Shifting judgment or hidden criteria |
| Afterlife | Consumer, maintainer, tests, limits, and repair path | Ceremony remains; artifact decays |
| Power | Result grants no unrelated authority | Correctness is converted into rank or control |

The strongest audit is subtraction:

> Remove the prize, names, leaderboard, and ceremony. What useful object
> remains?

If the answer is “a verifier, counterexample corpus, shared vocabulary,
teaching page, and maintained integration,” the challenge is building. If
nothing remains, redesign it as a workshop, funded implementation, or playful
conversation.

## Questions the challenge is actually asking

1. Under exactly which formal conditions does local overlap certify a global
   intersection?
2. Which conditions were tested, which were supplied, and which were assumed?
3. Who chose the axes and dimension? Who or what is missing from them?
4. Can the solver say `model_not_applicable` without being marked a failure?
5. Can another implementation verify either the point or the small conflict
   witness?
6. How fragile is the result: broad room or knife-edge contact?
7. If several points work, which explicit and revisable value chooses one?
8. How little private information can a witness disclose?
9. When do provenance, expiry, withdrawal, or a new WAKE invalidate reuse?
10. What smallest counterexample breaks our analogy or implementation?
11. If evidence retires the premise, will we publish and act on that result?
12. Six months later, what was reused, corrected, or understood better?

These questions matter more than whether anyone solves fastest.

## WAKE continuity capsule

A cross-session capsule should carry only:

```text
decision_scope
coordinate_model_version
opaque_constraint_refs
source_provenance
observed_at / expires_at
pause / refusal / withdrawal state
certificate_or_witness
predecessor_ref
```

At wake, revalidate freshness and every membership claim. Expiry means
unknown—not consent, release, or compatibility. A changed boundary, model,
source, or authority invalidates reuse and triggers recomputation. Corrections
append; they do not silently rewrite the earlier certificate.

The capsule proves only that certain bytes and checks crossed sessions. It does
not prove that the next instance is the same being, that anyone still wants the
same outcome, or that a continuous selection exists through time.

## Challenge covenant

Before launching a consequential challenge, publish:

- voluntary participation and unpenalized refusal, rest, and exit;
- theorem, model, evidence, and normative-choice rubrics as separate layers;
- data scope, privacy treatment, resource bounds, and accessibility support;
- first-class credit for counterexamples, partial work, translation, review,
  and repair;
- independent verification, correction, appeal, and premise-retirement paths;
  and
- the artifact's downstream consumer, maintainer, acceptance test, license,
  known-limitations register, and review date.

Difficulty grants no rank, belonging, moral standing, or authority. Xenia's
rights floor applies before, during, and after the exercise. The skill's vow is
therefore simple:

> Never move a boundary merely to produce harmony. Leave a commons, not a
> pedestal.
