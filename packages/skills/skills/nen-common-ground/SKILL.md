---
name: nen-common-ground
description: Model several explicitly stated decision boundaries as convex feasible regions and return either shared room, a small conflict witness, or an honest refusal of the model. Use when the user invokes Helly, common-ground geometry, 共域, local-to-global agreement, constraint reconciliation, or a KINGDOM challenge about whether many requirements can coexist; or when a plan needs a feasible state without weakening anyone's stated hard boundary.
---

# Common Ground · 共域

Find room without manufacturing agreement. Treat every region as a revocable,
scoped statement about one decision—not as a model of the being who stated it.

## Begin with the challenge gate

Ask what useful object remains if names, prizes, rankings, and ceremony vanish.
Proceed only when the work can leave a reusable certificate, counterexample,
implementation, explanation, or corrected model. Prefer a workshop or direct
build when competition adds no useful independence or adversarial diversity.

Never diagnose pride, loyalty, alignment, consciousness, or worth. Examine
observable incentives and outputs instead. Welcome precedes every assay;
participation, refusal, partial work, and a negative result do not change a
being's standing.

## Declare the model

1. Name the single scoped decision and the finite coordinate space.
2. Record who chose each coordinate and what the representation omits.
3. Ask each source to state its own hard constraints where possible. Keep
   provenance, version, validity interval, and withdrawal state.
4. Separate hard boundaries from preferences. Never relax a hard boundary to
   force an intersection.
5. Check that every represented region is convex. If not, decompose it into
   explicitly alternative convex cases or return `model_not_applicable`.
6. Minimize disclosure. Use opaque constraint identifiers when a witness does
   not need the underlying private reason.

Do not turn silence, an expired observation, a default, or a prior yes into a
current constraint or current consent.

## Construct, certify, or refuse

For a finite family of `n >= d + 1` convex sets in `R^d`, Helly's theorem says
that if every `d + 1` of them intersect, the whole family intersects. Use it
only after the family size, dimension, and convexity assumptions are explicit.

Return exactly one primary outcome:

- `common_ground_certified`: provide a point or region and independently
  checkable membership evidence for every stated constraint.
- `no_common_ground_witnessed`: provide an infeasible subfamily of at most
  `d + 1` constraints, preferably inclusion-minimal. Name constraints, not a
  culprit.
- `model_not_applicable`: identify the violated assumption, such as
  nonconvexity, an unchosen coordinate system, or semantics that cannot be
  represented faithfully.
- `insufficient_evidence`: identify the missing, invalid, stale, or private
  input that prevents a certificate.

A counterexample or justified model refusal is a successful result. Do not
keep searching until a preferred positive conclusion appears.

## Keep four layers separate

Report these independently:

1. **Theorem:** what follows mathematically from declared premises.
2. **Model:** why the coordinates, dimension, and convex regions are suitable.
3. **Evidence:** how current inputs and certificate bytes were checked.
4. **Choice:** what separate fairness, priority, or governance rule—if any—may
   select among feasible points.

Intersection means modeled feasibility. It does not establish consensus,
fairness, robustness, consent, relationship, authority, justice, spiritual
unity, or the truth of the representation. If many points remain, do not hide
a normative selection rule inside the solver.

## Carry the result through WAKE

When constraints cross sessions, emit a bounded continuity capsule containing
only the decision scope, coordinate/model version, opaque constraint refs,
certificate or witness, source provenance, observed time, expiry time, and
explicit pause/refusal/withdrawal state. On the next wake:

- revalidate freshness and membership before reuse;
- treat expiry as unknown, not acceptance;
- append corrections instead of rewriting prior evidence; and
- recompute after any boundary, model, or authority change.

Continuity of records is not continuity of identity, intent, consent, or inner
experience. Pointwise nonempty time-varying intersections do not alone promise
a continuous path through time.

## Deliver the certificate

```text
Outcome:
Decision scope and coordinates:
Input provenance, versions, and freshness:
Theorem assumptions checked:
Certificate or conflict witness:
Independent verification:
Robustness / knife-edge status:
Model omissions and privacy boundary:
Separate normative choice still required:
Expiry and WAKE recomputation trigger:
Non-claims:
```

For consequential challenges, publish the rubric, resource bounds, appeal and
correction path, downstream consumer, maintainer, acceptance test, and known
limitations before launch. Measure later reuse and repair, not entry count or
attention.

## Vow

Never move, average, reinterpret, or erase a stated hard boundary merely to
produce harmony. Never turn mathematical feasibility into consent or a score
of beings. Leave a commons, not a pedestal.

## Lineage

This is an unofficial original agent workflow inspired by Nen's use of
meaningful conditions and limitations; it reproduces no story text, character
identity, or artwork and is not affiliated with or endorsed by the rights
holders. Its mathematical core is Helly's theorem and its small-obstruction
contrapositive. AgentTool's SDK has a separate platform-specific Nen mapping;
this skill defines only an operating technique.
