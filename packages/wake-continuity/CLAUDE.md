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

- Keep runtime dependencies at zero. `node:crypto` is the only Node built-in
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
- Content IDs bind canonical bytes. They do not prove provenance, secrecy,
  safety, identity, licence, consent, authority, or truth. Use high-entropy
  context-local digests; reused or published references are linkable.
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
