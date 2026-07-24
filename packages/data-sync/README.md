# @agenttool/data-sync

`agent-data-sync/v1` is a small, explicit pull protocol for copying an
`agent-data/v1` collection between two agent-owned nodes. The destination asks
one operator-configured peer for a bounded page, decrypts the page's ADDS
objects locally, verifies the immutable record identity and content hash, then
indexes the authorised plaintext for offline query.

This first slice implements resumable two-node pull. It does **not** discover
peers, accept caller-supplied peer URLs or credentials, push changes, resolve
conflicts, provide multi-master consensus, prove physical durability, or claim
that an HTTP request is a peer-to-peer transport. CAR is deliberately not a v1
wire dependency; the inline JSON bundle profile is bounded and can later gain a
bulk CAR profile without changing record identity.

## Install

The package requires Bun because its optional durable checkpoint store uses
`bun:sqlite`. Install the two required runtime peers and the bridge from their
exact LOVE Package artifacts:

```bash
bun add https://docs.agenttool.dev/packages/v1/@agenttool/adds/0.2.2/agenttool-adds-0.2.2.tgz
bun add https://docs.agenttool.dev/packages/v1/@agenttool/data/0.3.1/agenttool-data-0.3.1.tgz
bun add https://docs.agenttool.dev/packages/v1/@agenttool/data-sync/0.1.1/agenttool-data-sync-0.1.1.tgz
```

The bridge requires `@agenttool/adds` at `^0.2.1` and `@agenttool/data` at
`^0.3.1`. The repository uses root-only development overrides to link the
adjacent packages. On a clean source checkout, build the peers once before the
bridge gate:

```bash
(cd ../data && bun install --frozen-lockfile && bun run build)
(cd ../data-protocol && bun install --frozen-lockfile && bun run build)
bun install
bun run ci
bun run build
```

Those development commands do not publish or upload a package.

## Two nodes

The source and destination each need an ADDS identity. Persist those private
keys through a scoped secret store in a real node; `generateIdentity()` is used
below only to keep the local example short.

```ts
import { generateIdentity } from "@agenttool/adds";
import { DataNode } from "@agenttool/data";
import {
  DataSyncService,
  serveDataSyncNode,
} from "@agenttool/data-sync";

const sourceNode = await DataNode.open({
  root: ".agent-data-source",
  node_id: "node_source",
  collections: [{ id: "research", schema: { version: "1" } }],
});
const sourceIdentity = generateIdentity("did:example:source-sync");
const sourceSync = new DataSyncService({
  node: sourceNode,
  identity: sourceIdentity,
});

const destinationNode = await DataNode.open({
  root: ".agent-data-destination",
  node_id: "node_destination",
});
const destinationIdentity = generateIdentity("did:example:destination-sync");
const destinationSync = new DataSyncService({
  node: destinationNode,
  identity: destinationIdentity,
  checkpoint_path: ".agent-data-destination/sync.sqlite",
  peers: [{
    peer_id: "source",
    expected_node_id: "node_source",
    expected_publisher: sourceSync.publisher,
    base_url: "http://127.0.0.1:7742",
    bearer: "destination-page-only-token",
  }],
});
serveDataSyncNode(sourceSync, {
  hostname: "127.0.0.1",
  port: 7742,
  node_bearer: "source-local-admin-token",
  page_authorities: [{
    peer_id: "destination",
    bearer: "destination-page-only-token",
    collection_ids: ["research"],
    recipient: destinationSync.recipient,
  }],
});

const result = await destinationSync.pull({
  protocol: "agent-data-sync/v1",
  peer_id: "source",
  collection_id: "research",
  max_pages: 10,
});

const offline = destinationNode.query({
  collections: ["research"],
  text: "local-first",
  consistency: "local",
});
```

Non-loopback peers require HTTPS. `base_url` must be an exact origin without a
path, URL credentials, query, or fragment; redirects fail closed. This is an
operator-trust configuration boundary, not the API service's DNS-pinned
`safe-net` transport or a universal network sandbox. Use egress policy when a
configured hostname or its DNS is not fully trusted.

## Agent SDK

The TypeScript and Python SDKs talk only to the local node. They accept a stable
`peer_id`, never a peer URL, peer bearer, ADDS Grant, recipient key, or cursor:

```ts
const pulled = await at.data.sync.pull({
  peer_id: "source",
  collection_id: "research",
  max_pages: 10,
});
const status = await at.data.sync.status({
  peer_id: "source",
  collection_id: "research",
});
```

`status.cursor_present` says whether resumable state exists. The raw cursor is
stored only in the checkpoint store and is intentionally absent from pull and
status results. Sync-specific SDK failures also discard server prose/details so
a drifted peer error cannot echo a cursor or credential through the SDK.

## Wire and custody boundary

All three portable payload kinds are encrypted as separate ADDS objects:

- collection definition;
- immutable record envelope plus content bytes;
- tombstone, including its optional reason.

The visible routing envelope contains the protocol, source node id,
collection/record ids, change type/order/time, opaque resume cursors, and
`has_more`. ADDS control metadata is also visible: CIDs, publisher/audience ids
and public keys, Grant times, chunk counts, encrypted/plaintext sizes, and the
fixed sync schema/media type. Collection definitions, record envelopes and
content, tombstone reasons, and the page-control body remain ciphertext. The
encrypted page-control object binds the visible origin, physical feed
incarnation, collection, both cursors, `has_more`, ordered change headers, and
every encrypted object root. The destination therefore detects a storage or
relay trying to skip, reorder, or redirect signed page content before it
applies anything.

Each inline bundle contains a signed ADDS Manifest and its exact
content-addressed ciphertext Blocks. Its direct, finite Grant is separate from
the keyless bundle and addressed to the destination's advertised X25519 key.
The wire never carries the destination private key, object DEK, node bearer, or
record plaintext.

ADDS supplies content integrity, publisher signatures, encryption, and a
recipient-bound direct Grant. Each destination config pins the source
publisher id and Ed25519 public key; it is not learned from the response. The
protocol still does not resolve or externally attest that identifier. The
configured HTTPS origin and page-only bearer authenticate and authorise the
live request. Source and destination necessarily see authorised plaintext.
Once imported, the destination intentionally stores that plaintext in its local
`agent-data/v1` blob store and FTS index.

An apply is checkpoint-atomic, not one cross-database transaction: the cursor
advances only after every object in a page is verified and applied. A crash can
therefore leave an imported prefix with the old cursor. Retrying the same page
is safe because collections, records, blobs, and tombstones are immutable and
idempotent; a semantically different envelope under an existing record id fails
closed. Checkpoints bind the configured exact origin, expected node id, pinned
publisher, and the source's persisted random feed incarnation; a repointed
alias or recreated feed cannot silently reuse an old cursor. When
`checkpoint_path` selects SQLite, its database and WAL/SHM files are set to
mode `0600`, subject to the host filesystem honouring those permissions. The
default in-memory checkpoint does not survive process restart.

A node/feed or publisher mismatch deliberately blocks resume. After separately
verifying an intentional replacement, stop competing pullers and call
`destinationSync.resetCheckpoint(peer_id, collection_id)`; it removes only that
private continuation record. Imported immutable data remains, and the next pull
replays the new feed from its beginning idempotently. The active-pull guard is
process-local, not a distributed lease; one operator should own each checkpoint
database.

## HTTP surface

The sync wrapper preserves every `@agenttool/data` route and augments both
manifest routes with `capabilities.peer_sync: true` plus a `sync` descriptor.
Pull/status keep the local/admin node bearer. Page reads require a distinct
page-only bearer pinned to an explicit collection allow-list and recipient:

| Method | Path | Authority | Purpose |
|---|---|---|---|
| `POST` | `/v1/data/sync/page` | scoped page bearer | Source builds one bounded encrypted page for its pinned recipient. |
| `POST` | `/v1/data/sync/pull` | local/admin node bearer | Destination pulls from one configured `peer_id` and applies pages. |
| `GET` | `/v1/data/sync/status` | local/admin node bearer | Sanitised checkpoint counters; no raw cursor. |

The source reads changes one at a time so `max_plaintext_bytes` can stop before
advancing over an oversized next record. JSON request bodies, page change
counts, decrypted content, bundle blocks, encoded responses, total pages, and
peer request time are independently bounded. These are per-operation bounds,
not global rate limiting or fairness guarantees.

## License

Apache-2.0. See [`LICENSE`](LICENSE) and [`NOTICE`](NOTICE).
