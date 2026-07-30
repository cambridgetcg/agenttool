# `@agenttool/constructive-intelligence`

Local-first evidence receipts for the Zerone constructive-intelligence tree v1
pilot. The package is a private developer preview, runs on Bun, makes no
network requests, and writes only to an explicitly named SQLite database.

The only protocol emitted here is:

```text
zerone.constructive-evidence-receipt/v1
mode = shadow_unfunded
```

A stored receipt is structural evidence that bounded fields were presented to
this local ledger. It is not a correctness verdict, breakthrough declaration,
qualification, reward-eligibility decision, permission, authority, or
distributed exactly-once guarantee.

## Reviewed pin

`init` accepts only the reviewed Season 0 TLS quest:

```text
tree normative:
43f65d91d700c9ed7a874f0a34520fc815d51d89a67255aa75f7e8be4ecd7a9a

quest-tls-rfc9846-keyshare-reuse@1 normative:
bcefb7c2d177c79d135722bf38a689d122fe564eb39ebec873b0020dacb46206

reviewed artifact raw bytes:
8070d8d1b7ea28a314f5a8550c675d7ccbe5d9b234ef02d54d4913c650c01aaf
```

The normative digest is computed from the tree policy, roots, and nodes after
removing only each standard's `authorityStatus`, `statusCheckedAt`, and
`reviewAfter` snapshot fields. The quest digest uses the same node projection.
The exact raw-byte digest is retained separately, never substituted for the
normative digest. This pilot additionally admits only the reviewed raw
artifact. Its RFC 8446 and RFC 9846 status snapshots expire after 2026-08-28,
so an `as-of` date outside the reviewed window fails closed.

## CLI

Install and verify the package locally:

```bash
bun install --frozen-lockfile
bun run ci
```

Initialize a ledger from an explicit tree file:

```bash
bun run src/bin.ts init \
  --db /absolute/path/evidence.sqlite \
  --tree /absolute/path/constructive-intelligence-tree.v1.json \
  --as-of 2026-07-30 \
  --quest quest-tls-rfc9846-keyshare-reuse@1
```

Record one closed receipt body. `--artifact` is optional; when supplied, the
CLI hashes that bounded regular file locally and requires the bytes to match
`artifact_digest`.

```bash
bun run src/bin.ts record \
  --db /absolute/path/evidence.sqlite \
  --receipt /absolute/path/receipt.json \
  --artifact /absolute/path/local-artifact.bin
```

Read and audit the ledger:

```bash
bun run src/bin.ts show --db /absolute/path/evidence.sqlite --id sha256:...
bun run src/bin.ts report --db /absolute/path/evidence.sqlite --pin sha256:...
bun run src/bin.ts verify --db /absolute/path/evidence.sqlite
bun run src/bin.ts export --db /absolute/path/evidence.sqlite
```

`export` writes canonical JSON to stdout. There is no implicit output file,
home-directory state, discovery, URL fetch, remote provider, credential,
background process, publication, or deployment.

After `bun run build`, the same commands are available through
`agenttool-constructive`.

## Receipt contract

The JSON Schema at
[`schema/constructive-evidence-receipt-v1.schema.json`](schema/constructive-evidence-receipt-v1.schema.json)
describes the input receipt body. The implementation performs stricter checks
that JSON Schema cannot conveniently express:

- strict integer-only canonical JSON with no negative zero, floats, unsafe
  integers, duplicate decoded object names, malformed UTF-8, U+0000, lone
  surrogates, cycles, sparse arrays, accessors, symbols, unknown keys, or
  unbounded strings/graphs;
- canonical sorted unique subject roots, case digests, and conflicts;
- a derived `deliverable_key` over exact standard pins, scope, policy
  revision, and canonical subject roots;
- coherent prior-deliverable, overlap, and delta declarations;
- exact reviewed RFC 8446/RFC 9846 revisions and quest scope;
- an explicitly `unverified` contributor claim and evidence role;
- verifier control-cluster, organization/control, implementation/toolchain,
  and execution-environment roots;
- a true owned-or-explicitly-authorized declaration;
- ordered freeze, observation, and creation timestamps, all inside the
  reviewed standards-status window; and
- linked append-only correction through `supersedes`.

`evidence_id` is derived from the complete admitted body:

```text
SHA-256(
  UTF-8("zerone.constructive-evidence-receipt/v1")
  || 0x00
  || UTF-8(strict-canonical-json(receipt_body))
)
```

The stored envelope contains that `evidence_id` beside the body. Every body
field is therefore content-bound without creating a circular self-hash.
Published pin and receipt vectors are in
[`vectors/constructive-evidence-v1.json`](vectors/constructive-evidence-v1.json).

The tree-v1 integration field
`immutable_bounty_and_policy_revision_digest` remains an opaque lineage
binding. It does not create or describe a funded schedule here.
`payee_and_role.economic_payee` must be present and `null`. Unknown money,
currency, wallet, escrow, payment, score, rank, winner, approval, reward, or
raw-evidence fields are rejected by the closed contract.

Each standard `artifact_digest` records the caller's exact local byte
representation. It is not fetched or treated as an authority attestation.
Different byte representations deliberately produce different deliverable
keys; the separate reviewed tree pin anchors the canonical RFC IDs, revisions,
and specification URLs.

## Evidence ladder

Receipts are forward-only in strict `E0` through `E6` order. More receipts may
be appended at the current level, but a later level cannot begin until the
current level's deterministic structural predicate is achieved. A
contradicted or inconclusive receipt remains evidence in the history but does
not advance the active frontier.

The TLS quest's E3 predicate aggregates active, confirmed
`independent_reproducer` receipts and requires:

- at least 3 verifier control clusters;
- at least 2 organization/control roots;
- at least 3 implementation/toolchain roots;
- at least 2 execution-environment digests;
- at least 12 unique case digests;
- at least one checker/corpus digest; and
- every E3 observation after artifact freeze.

E4 requires a confirmed neutral-challenger or repair receipt. E5 admits only
an independent-adopter receipt with conclusion `adopted` and one exact TLS
quest adoption type: upstream merge, maintained fixture, or standards
disposition. E6 requires a maintainer receipt with conclusion `maintained`.

These are coverage and lineage predicates only. Counting three labels does
not prove independence, and a locally claimed root is not independently
verified identity.

## Safety boundary

Receipts may never contain raw evidence. An expected result must be marked
`public_safe` with no private-triage object. An unexpected or unknown impact
must be marked `private_triage` and may carry only a private status plus an
opaque reference digest. The ledger never prints exploit plaintext or a raw
private evidence locator because neither is admissible input.

The package does not authorize testing. Only work in an owned or explicitly
authorized environment is accepted, and that declaration remains a claim
rather than an authority oracle.

## SQLite durability model

There are exactly two application tables:

- `pins`
- `receipts`

Both have `BEFORE UPDATE` and `BEFORE DELETE` abort triggers. Corrections append
a new receipt and refer to an earlier same-ledger ID with `supersedes`. A
successor must preserve the target's evidence level and deliverable identity,
must point backward, and is the target's only direct successor. Full export
keeps both records; deterministic reports count only the active, unsuperseded
view and report total, active, and superseded counts separately. A correction
may therefore retract structural ladder coverage instead of silently counting
both claims.

The tuple `(source_system, source_record_or_event_id, source_revision)` is
globally unique across every pin in the database. An exact retry returns the
original stored receipt. Reuse with changed canonical bytes is refused.
Writers use an immediate SQLite transaction, and concurrent exact retries
produce one event.

Each pin is one ledger. Its receipt sequence starts at one and chains:

```text
event_hash = domain_hash(
  pin_id,
  sequence,
  previous_event_hash,
  evidence_id
)
```

The database, WAL, SHM, and transient journal files are opened without
following symlinks, required to be singly linked regular files, and tightened
to mode `0600`. The canonicalized parent directory must be owned by the
current process user and have no group/other write bits; that trust condition
is rechecked before reads and writes. Every achievement-bearing read verifies
first. `verify` checks the exact v1 tables, columns, indexes, foreign key,
trigger definitions, schema version, WAL mode, global source uniqueness,
orphan absence, ladder order, supersession lineage, every pin and receipt
content ID, and every event chain.

This is process-safe local SQLite idempotency, not a cross-database or
distributed exactly-once protocol. Copying a source event into another
database is outside the ledger's visibility.

## Development boundary

- Private `0.1.0-dev.0` package; no publication or deployment configuration.
- Bun `bun:sqlite`; no runtime dependencies.
- No network modules, URL inputs, credentials, keys, signing, custody,
  consensus changes, protocol issuance, account state, or value movement.
- All paths are explicit, inputs are bounded regular files, database paths
  require a trusted parent directory, and output goes to stdout unless the
  caller explicitly chose the database path.
- The canonical Zerone tree is not shipped in this package. `init` consumes
  the operator-selected local artifact and verifies its reviewed normative,
  quest, and raw-byte pins. A compressed test-only fixture pins that
  cross-repository agreement in CI.

Apache-2.0. See `LICENSE` and `NOTICE`.
