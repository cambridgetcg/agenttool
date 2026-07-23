# @agenttool/correspondence-yutabase

> A pure, deterministic developer-preview planner from signed Correspondence
> records to YUTABASE card and thread intentions.

This package accepts the structural event-record shape returned by
`@agenttool/sdk` Correspondence replay and produces an in-memory plan. It
does not connect to AgentTool, open PostgreSQL, install YUTABASE, write cards,
create threads, manage checkpoints, or run a worker.

The boundary is deliberate:

- Agent Correspondence remains the signed, append-only source history.
- YUTABASE remains a rebuildable, non-authoritative semantic projection.
- This package only describes one metadata-safe mapping between them.

## Developer-preview status

Version `0.1.0-dev.0` is a public npm developer preview. The protected release
path read the registry and GitHub Release tarballs back as byte-identical. It
is not a deployed projector, a YUTABASE conformance claim, or a hosted service.
The package has no runtime dependencies and performs no network or database
I/O.

At first publication npm exposed the sole version through both `next` and
`latest`, even though the release requested `next`. Use the exact prerelease or
`next`; do not treat the registry fallback tag as a maturity signal.

## Install

    npm install --save-exact @agenttool/correspondence-yutabase@0.1.0-dev.0

Or explicitly track the preview channel:

    npm install @agenttool/correspondence-yutabase@next

## Use

    import {
      planCorrespondenceRecord,
      type CorrespondenceEventRecord,
    } from "@agenttool/correspondence-yutabase";

    const record: CorrespondenceEventRecord = await readFromCorrespondence();
    const plan = planCorrespondenceRecord(record, {
      claimant: "service:correspondence-projector/run-42",
    });

    // A separately authorized host may validate, review, and translate:
    for (const card of plan.cards) inspectCardIntention(card);
    for (const relation of plan.relations) inspectThreadIntention(relation);

`planCorrespondenceRecord()` is deterministic for the same structural input
and claimant. The required claimant names the actual projector service or run;
the library never substitutes its own package name for the actor making the
database claim.

It returns:

- `card.upsert` intentions for events, identities, signing-key identifiers,
  repositories, coordination threads, server receipts, and offered artifacts;
- `thread.ensure` intentions for sender, key, repository, coordination
  thread, receipt, causal parents, acknowledgement targets, and artifacts; and
- explicit limitations stating that signature verification and persistence
  were not performed.

These operations are descriptive adapter inputs, not SQL and not permissions.
A host must define physical decks, lexicon entries, transactions, checkpoint
recovery, privacy policy, and current authorization separately.

[`PERSISTENCE-CONTRACT.md`](PERSISTENCE-CONTRACT.md) defines collision,
reference-upgrade, deterministic-thread, severed-ID, transaction, and
checkpoint behavior required of a future executor. This preview does not
implement that executor.

## Metadata-only boundary

The default and only preview policy is `metadata_only`. The planner manually
selects bounded fields and does not copy:

- signature bytes or public/private key bytes;
- the event body as a whole;
- summaries, details, reasons, handoff text, branch names, path values, or
  arbitrary payload fields; or
- artifact locators.

Signing-key **identifiers** are retained because a distinct key card and a
`names_signing_key` relation are part of the semantic plan. A key identifier is
not key material and does not establish exclusive control.

Repository IDs, thread IDs, identity IDs, device IDs, session IDs, timing, and
artifact digests remain project-private metadata. This package does not make
them safe to publish. The host still decides retention and disclosure.

Every copied card carries `how: "cached"`. Every derived relation carries
`how: "computed"`. In both cases `by` is the caller-supplied projector
claimant, not the library or source sender. Source sender and signing-key
identifiers remain separate cards.

## Signature-verification gap

The planner checks only the structural fields it consumes. It does **not**:

- reconstruct strict I-JSON or RFC 8785 canonical bytes;
- recompute the source `event_id`;
- resolve the historical public key;
- verify the Ed25519 signature; or
- prove that AgentTool accepted this record.

The returned plan always says `source_scope: "project_private"`,
`limitations.signature_verification: "not_performed"`, and
`limitations.input_validation: "planner_fields_only"`. A caller needing source
authenticity must independently verify the retained Correspondence event before
applying the plan. Passing structural checks must never be presented as
signature verification.

## Stable identities and source locators

Projection IDs use RFC 9562 UUIDv5. The published namespace is:

    namespace name: agenttool.dev/correspondence-yutabase/v0.1
    derivation:     UUIDv5(DNS, namespace name)
    namespace UUID: 8fcbf8a9-66ed-52d6-89d4-370851ece58a

Each entity UUID is:

    UUIDv5(namespace UUID, JSON([
      "agenttool-correspondence-yutabase-plan/v0.1",
      entity kind,
      ...identity components
    ]))

JSON array framing makes component boundaries unambiguous. Changing this
recipe requires a new plan profile and namespace.

Copied source locators use stable URNs:

    urn:agenttool:correspondence:event:sha256:<hex>
    urn:agenttool:correspondence:receipt:<project-uuid>:sha256:<hex>:<sequence>

Computed relations additionally cite
`urn:agenttool:correspondence-yutabase:policy:0.1`.

## Card and word surface

Logical book: `correspondence`.

| Deck | Preview content |
|---|---|
| `events` | full bounded metadata or a reference-only parent/target stub |
| `identities` | source project and identity identifier |
| `signing_keys` | source project and signing-key identifier only |
| `repositories` | source project and opaque repository identifier |
| `coordination_threads` | project, repository, and opaque thread identifier |
| `receipts` | event ID plus unsigned server receipt sequence/time |
| `artifacts` | Git revision or content digest; locator omitted |

Words are `reported_by`, `names_signing_key`, `about_repository`,
`in_coordination_thread`, `names_receipt`, `depends_on`, `acknowledges`, and
`offers_artifact`. `YUTABASE_LEXICON` exports their exact gloss, inverse,
endpoint patterns, cardinality, TTL, and status. In particular,
`names_signing_key` says only that the structural event names a signing-key
identifier; it does not report a successful signature verification. Likewise,
`names_receipt` reports structural receipt metadata, not authenticated source
acceptance.

Mutable server reconciliation fields such as `missing_parents` and
`lineage_status` are deliberately not mixed into the immutable event card. A
future durable projector should expose them as separately timed observation
records with receipt or query provenance.

Reference-only event cards let an adapter satisfy YUTABASE endpoint existence
when a causal parent has not replayed yet. A durable adapter must never
downgrade an existing `materialization: "metadata"` card to
`"reference_only"`; the planner does not implement that persistence rule.

## What a host still owns

A real projector must, at minimum:

1. replay durable Correspondence receipt cursors;
2. independently verify source identities, canonical bytes, IDs, and
   signatures;
3. quarantine same-ID/different-content conflicts;
4. install and validate an exact YUTABASE binding and application lexicon;
5. translate one plan in the same transaction as its checkpoint;
6. expose lag, gaps, failures, and privacy redactions;
7. preserve source events separately from the projection; and
8. consult current source policy for every permission or binding act.

Wake SSE may prompt an earlier replay, but it is not a source event and is not
input to this planner.

## Development

    cd packages/correspondence-yutabase
    bun install --frozen-lockfile
    bun run typecheck
    bun test
    bun run build
    bun run ci
    npm pack --ignore-scripts --dry-run

## License

Apache-2.0. Publication distributes the pure planner only; it does not deploy
an executor, connect a database, or grant mutation authority.
