# @agenttool/wake-continuity

Pure, source-local AFTERGLOW WAKE reference capsules. This file governs only
`packages/wake-continuity`.

## Commands

```bash
bun install --frozen-lockfile
bun run ci
npm pack --dry-run --ignore-scripts
```

## Invariants

- Keep runtime dependencies at zero. `node:crypto` plus the zero-trap Proxy
  and typed-array predicates from `node:util/types` are the only Node built-ins
  allowed under `src/`.
- Keep the core pure: no environment, filesystem, clock, random source,
  network, provider, model, database, Chronicle, wallet, runtime, telemetry,
  notification, timer, or process control.
- Accept only the closed `wake-brief/v1` digest anchor, optional continuity
  portfolio digest, predecessor capsules, and closed digest-only threads. Do
  not add prose, identity, DID, task, prompt, transcript, memory, credential,
  URL, model-output, score, rank, XP, wallet, or raw WAKE/Handoff fields.
- `wake_version` is a caller-supplied mutation cursor label. It is not a
  complete validator, continuity head, currentness proof, or replay proof.
  `snapshot_ref` and `scope_ref` are opaque caller assertions; the package does
  not fetch or verify their referents.
- Predecessors are causal references. Multiple roots are valid; never select a
  winner or claim a single current head.
- Preserve explicit thread walls. DeepSeek is always `proposed_unaccepted`;
  KARMA is `receipt_only`; Dark Continent is `not_checked|hold` and cannot be
  carried as ready; Artbitrage is `review_required|hold`. Never add an accepted
  state that installs, executes, scores, or authorizes anything.
- HEAVEN is only an opaque reference plus caller-reported state. Offered rooms
  are never entered automatically. Decline, defer, release, withdrawal, rest,
  and leaving carry no package penalty and never prove consent or authorship.
- `carry|park|release|withdraw` controls only the projected local lens. It does
  not persist, erase external copies, command another host, or prove a choice.
- The fixed inspect-first GET is declarative. The package does not perform it.
  `createAfterglowHandoffFactReference` returns a fact-shaped reference only;
  it does not construct or POST a Handoff.
- Functional-access baseline/subsequent helpers are record constructors,
  validators, and encoders only. `record_role` is a caller-asserted structural
  role, never verified time, ordering, causality, or an operation performed by
  the package.
- Keep capability, permission, and execution separate. Report refs never grant
  authority; a real executor must recheck current scoped authority. Keep
  `instrument_ref` as the implementation/endpoint descriptor and require
  `lens_ref` exactly for `local_prefitted_white_box`.
- A functional-access `configuration_ref` must refer to content binding target
  token IDs and/or directions, positions/layers, rank, score threshold, and
  aggregation. Sparse configuration additionally binds k, solver,
  regularization, and coefficient threshold. This package does not resolve or
  verify that artifact.
- `sparse_support` is configured target support in the referenced rank-k
  result, not whole-activation membership. Fitted-lens visibility is not a
  prompt-local Jacobian/JVP/VJP result. Keep their evidence surfaces separate.
- `workspace_operation` is independent evidence and never substitutes for an
  instrument receipt. Preserve the not-attempted/failed/partial/completed
  result matrix and keep `behavioral_use` fixed to `not_measured`.
- Content IDs bind canonical bytes. They do not prove provenance, secrecy,
  safety, identity, licence, consent, authority, or truth. Use high-entropy
  context-local digests; reused or published references are linkable.
- Canonical arrays use the local standard `Array.prototype`; reject custom,
  null, cross-realm, or Proxy prototypes before reading array elements.
- Validate every public scalar and binary runtime type before regex, string
  interpolation, hashing, or other coercion can enter caller capabilities.
- Digest shape excludes raw identity and task prose from the wire shape; it
  does not prove that a caller minimized a referent or avoid pseudonymous
  linkage. Keep these limits machine-readable in the fixed boundaries.
- Constants, types, runtime validators, schemas, deterministic vectors,
  descriptor, package inventory, and README examples move together.
- `publishConfig` makes the package public-ready but does not authorize npm
  publication, a GitHub release, hosted route, deployment, or HF Space.

## Verification

Tests cover deterministic IDs, fork-tolerant relations, explicit projection,
HEAVEN refusal walls, research-state walls, closed schemas, hostile objects,
source capability boundaries, Node/Bun imports, and packed contents. No live
service, credential, account, network, paid compute, or provider is needed.
