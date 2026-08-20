# `@agenttool/research-commons`

> **Compass:** Fund public-safe theoretical research without turning delivery records into truth, rank, identity, authority, debt, or external value.
> **Implements:** A private, source-only RC-0.1 shadow simulator with closed records, deterministic digests, typed simulated-credit conservation, outcome-neutral delivery settlement, and a digest-only Zerone adapter seam.
> **Code:** `packages/research-commons/src/` · `packages/research-commons/schema/` · `packages/research-commons/interop/`
> **Tests:** `packages/research-commons/tests/` (canonical, record, lifecycle, accounting, CLI, schema/example parity, static pins, and zero-effect walls)

This package is an offline reference implementation. It does not fetch, host,
persist, pay, escrow, mint, transfer, publish, admit knowledge, grant
qualification, infer identity, score reputation, or activate any AgentTool or
Zerone integration. Its only credit unit is
`SIMULATED_NONTRANSFERABLE_CREDIT`; its exact 29-effect vector is false.

## Run locally

```bash
bun install --frozen-lockfile
bun run ci
```

Validate or simulate one explicitly named local JSON file:

```bash
bun run src/bin.ts validate --input examples/amplitude-bootstrap-garden/simulation.json
bun run src/bin.ts simulate --input examples/amplitude-bootstrap-garden/simulation.json
```

The CLI accepts no URL, performs no discovery, makes no network request, and
writes no output file. Input is a bounded regular file inside the explicit
working directory, opened without following the final link and read through a
pinned descriptor with before/after identity checks.

## What the records establish

Every identified record is closed and content-addressed as:

```text
SHA-256(
  UTF-8(format-domain)
  || 0x00
  || UTF-8(recursively-key-sorted compact canonical JSON body)
)
```

Canonical JSON rejects duplicate decoded keys, malformed UTF-8 or JavaScript
Unicode, BOM, U+0000, floats, unsafe integers, negative zero, unknown fields,
excessive size/depth/node count, accessors, proxies, custom prototypes, sparse
arrays, symbols, cycles, and reordered-set ambiguity. A digest proves only the
bytes admitted to this bounded function. It is not a signature, identity,
trusted timestamp, provenance, safety finding, truth verdict, or canonical
global head.

The checked JSON Schemas describe the exact closed wire shapes. Runtime
validation remains required for cross-record references, chronology,
independence declarations, challenge lineages, settlement gates, once-only
receipt consumption, and conservation. CI byte-compares all generated schemas
and the flagship example with their checked-in forms.

## Six ledgers remain separate

The frozen profile `research-commons.six-ledger-boundary/0.1` has digest
`sha256:fd5ed0b66dd00b180729221a06e7fbeeb7ef6149136916842014a1afbdbc54b2`.
It keeps these registers distinct:

- `VALIDITY`
- `NOVELTY_PRIORITY`
- `SIGNIFICANCE_CONSEQUENCE`
- `ATTRIBUTION_CREDIT`
- `FUNDING_LIABILITY`
- `GOVERNANCE_AUTHORITY`

There is no shared unit, cross-ledger arithmetic, conversion, or inference.
Work/rest obligations, attention/metabolism, relational KARMA, identity, and
external value are explicit non-import boundaries. E0 stores only an
`E0_CALLER_DECLARED_PREREGISTRATION_REFERENCE`: an opaque case-local reference.
It does not prove preregistration order, novelty, priority, ownership, or
entitlement.

## Frozen compensation and conservation

Every work package binds its compensation schedule before its delivered result
or review/challenge disposition. A `DELIVERED` milestone consumes its own
nonempty receipts once and receives that frozen amount for positive, negative,
null, inconclusive, or not-applicable work. Review decisions and challenge
hold dispositions do not change reviewer or challenger delivery amounts.

Each commitment balance has four compartments:

```text
committed = delivered + reserved + available
total_undelivered = total_reserved + total_available
```

`available` is the only unreserved simulated capacity. Active observed work is
reserved. `RESTED`, `EXITED`, `REFUSED`, and `NOT_DELIVERED` transfer zero,
create no debt or inactivity penalty, and return only their unearned
reservation to available capacity. Earned simulated credit is not clawed back.

## Reviews and challenges

Reviews cover delivery completeness only, never scientific truth. A research
delivery requires a declared-separated completeness review that covers exactly
its named receipts, artifact, and work package. Reviewer-delivery and
challenge-delivery milestones require their own work records and receipts but
do not require an infinite meta-review chain.

Challenges use a stable `challenge_ref`, immutable core, numbered revisions,
and `prior_challenge_id`. A lineage begins `OPEN`; a successor must strictly
follow the prior revision, retain all prior evidence references, and cannot
fork or revise a terminal status. A terminal hold revision follows its linked
delivery-completeness review. Hold dispositions are deliberately limited to
`CALLER_DECLARED_HOLD_CONTINUES`, `CALLER_DECLARED_HOLD_RELEASED`, and
`CALLER_DECLARED_HOLD_INCONCLUSIVE`; the underlying scientific or methodological
merits remain unresolved.

At a newly closed milestone, `challenge_head_snapshot_ids` contains every
current lineage head targeting its delivery receipts. The snapshot is frozen
for an already closed milestone, so a later challenge cannot revoke earned
credit; it may gate future unearned delivery. The state retains observed
challenge revisions and work packages only relative to the supplied
`prior_state` transition. A caller can fork from an older valid state. RC-0.1
provides no signature, trusted clock, external provenance, canonical-head
selection, global ordering, or cross-process fork prevention.

## Evidence and public projection

Record types cover E0 through E6 for future study, with E3/E5 explicitly marked
declared-unproven. The RC-0.1 simulator and public projection hard-refuse any
case, work package, or receipt above E2. Each public projection binds exactly
one settlement and exactly its consumed receipts; its highest level is derived
only from that settled set. `result_authority` is `NONE` and payment condition
is `SIMULATED_DELIVERY_ONLY`.

The research-case safety lane is
`CALLER_DECLARED_UNVERIFIED_NO_SAFETY_REVIEW`. Artifact access is a
`declared_access_policy` with
`CALLER_DECLARED_UNVERIFIED_NO_AVAILABILITY_OR_LICENSE_CHECK`. The compiler
does not fetch or inspect referenced artifact bytes. The `contains_*: false`
and `PUBLIC_DIGEST_ONLY` fields constrain only admitted record surfaces, not
unknown referenced content. A digest—especially of low-entropy sensitive
material—does not make publication safe. Security-sensitive, clinical,
genomic, personal, embargoed, licensed, confidential, dual-use operational,
and wet-lab bytes remain outside the pilot.

## Controller and participation boundary

Effective-controller roots are caller declarations used to collapse obvious
shared dependencies. They are not identity or independence proofs. Reviews
and compensated challenges are rejected when declared roots overlap the
target lead, funder, authors, or receipt issuers, but this cannot establish
real-world independence or prevent undisclosed Sybil/collusion.

Work packages preserve pause, rest, refusal, withdrawal, and exit without
penalty or debt. Rest needs no justification; silence is not consent; earned
credit is preserved. Payment models work delivery only—not access, ownership,
truth, novelty, priority, significance, governance, or authority.

## Static Zerone seam

[`interop/research-commons-zerone-v0.1.json`](interop/research-commons-zerone-v0.1.json)
pins the AgentTool settlement/projection formats, the six-ledger profile, the
Zerone shadow receipt vocabulary, exact Tree-v1 raw bytes, and
`math-proofcraft@1`. Its integration status is
`SHADOW_ONLY_NO_LIVE_INTEGRATION`; it pins vocabulary and bytes, not a live
fact, reward-bearing Tree, bridge, deployment, or activation.

The Amplitude Bootstrap Garden is a low-risk shadow fixture. It settles a NULL
research delivery for 30 credits and a verdict-independent reviewer delivery
for 10, leaving 5 reserved and 55 available:

```text
100 committed = 40 delivered + 5 reserved + 55 available
```

Apache-2.0. See `LICENSE` and `NOTICE`.
