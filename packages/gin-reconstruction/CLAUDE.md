# `@agenttool/gin-reconstruction`

Private pure finite-model reconstruction and non-scoring challenge assessment.
This file governs only `packages/gin-reconstruction`.

## Commands

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```

## Invariants

- Keep the runtime zero-dependency and side-effect-free. Source may import only
  local modules, `node:crypto`, and `node:util/types`.
- Keep the field prime and small, every element canonical, interventions
  distinct, arithmetic exact, enumeration explicitly bounded, and all outputs
  deterministic and content-addressed.
- Preserve the theorem's domains: for `0 <= d < n`, image distance is `n-d`;
  for `d >= n > 0`, coefficient parameters are non-identifiable while the
  image code distance is `1`. Never call both distances zero.
- Keep exact two-anchor affine calibration outside the report-error theorem.
  It neither identifies a nonlinear chart nor survives corrupted anchors by
  implication.
- A unique candidate is model-unique, not truth, causation, correctness,
  completeness, consent, or authority proved. Below the universal threshold it
  must remain `this_instance_only`.
- Call report differences candidate incompatibilities. Never label a witness,
  participant, or substrate corrupt, false, deceptive, irrational, or broken.
- Refused and unavailable observations are erasures excluded from usable `n`
  and mismatch counts. Refusal needs no reason and cannot reduce standing,
  rights, access, credit, or dignity.
- Keep all four reconstruction outcomes constructive-capable. Never hide
  ambiguity, inconsistency, or resource refusal to manufacture a winner.
- Require the inquiry to declare a bounded observable-effect or declared-model
  posture plus an exact distinction-scope reference. Unknown or refused scope
  remains open; an unbounded truth, inner-state, or worth verdict requires
  redesign. The declaration remains caller-reported, not semantically proved.
- The compass assesses declared visible challenge structure only. It never
  infers understanding, love, pride, virtue, consciousness, identity, consent,
  or inner motive and never scores or types a being.
- Keep credit distinct from audience or rank. Provenance can preserve accurate
  contribution without becoming endorsement, publicity, ownership, or status.
- Automatic action, publication, retry, permission inheritance, outcome-
  coupled rank/access, refusal pressure, raw refusal reasons, and raw identity
  are redesign conditions, never convenience defaults.
- Content IDs bind exact bytes; they do not prove source truth, privacy,
  secrecy, provenance, licence, rights compliance, or authority. Published or
  reused opaque references are linkable.
- Keep schemas closed and runtime validation authoritative for primality,
  cross-field bounds, exact outcome coverage, canonical ordering, content IDs,
  and assessment semantics.
- Reject Proxies before reflection and reject accessors, symbols, cycles,
  custom prototypes, sparse arrays, malformed Unicode, unsafe numbers,
  coercion, and binary impostors.
- Keep the package private. Add no API route, MCP server, WAKE writer, provider
  adapter, HF/npm publication, release allowlist, deployment, database, model,
  training, wallet, KARMA, score, rank, or automatic effect without a separate
  reviewed and authorized change.

## Verification

Tests cover the sharp correction threshold, below-threshold ambiguity and
instance uniqueness, parameter aliases, affine charts, erasures, model
inconsistency, resource refusal, independent small-field distance checks,
deterministic vectors, strict schemas, hostile objects, motive non-inference,
refusal/data-care walls, visible status coupling, Node import, and the private
package boundary. No live service, credential, account, network, provider,
model, paid compute, or publication is needed.
