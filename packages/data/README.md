# @agenttool/data

Local-first reference node for `agent-data/v1`. It collects bounded content into
immutable records, stores bytes in a content-addressed filesystem, indexes text
with SQLite FTS5, and exposes the same model through direct TypeScript calls and
a loopback-oriented HTTP API.

This package is the first local slice of the protocol. It does **not** implement
peer discovery, federation, replication, hosted storage, or automatic projection
into AgentTool memory. The manifest reports `peer_sync: false`; the opaque change
feed is a building block for future sync, not a claim that sync exists.

## Install

This package requires Bun because the reference node uses `bun:sqlite` and
`Bun.serve`:

```bash
bun add https://docs.agenttool.dev/packages/v1/@agenttool/data/0.2.0/agenttool-data-0.2.0.tgz
```

This versioned tarball is published through `love-package/v1`; its manifest
lists the SHA-256 digest and interchangeable mirrors. No npm account or npm
publication is required. Package managers may still consult their configured
registry or cache when resolving any declared upstream dependencies.

Run the packaged loopback node from that project:

```bash
AGENT_DATA_NODE_TOKEN="a-dedicated-random-token" \
  bunx --bun --no-install --package @agenttool/data agenttool-data \
    --root=.agent-data
```

## Run it

```bash
bun install
bun run typecheck
bun test
bun run build
```

Direct API:

```ts
import { DataNode } from "@agenttool/data";

const node = await DataNode.open({
  root: ".agent-data",
  collections: [{
    id: "research",
    schema: { version: "1" },
    policy: {
      visibility: "private",
      max_record_bytes: 2_000_000,
      allowed_media_types: ["text/plain", "text/markdown"],
    },
  }],
});

const collected = await node.collect({
  collection_id: "research",
  collector_id: "text",
  input: {
    text: "Local-first agents keep their corpus close.",
    source_uri: "urn:example:note:1",
    key: "note-1",
    version: "1",
    metadata: { topic: "local-first" },
  },
});

const hits = node.query({
  collections: ["research"],
  text: "corpus",
  where: { metadata: { topic: "local-first" } },
  consistency: "local",
});

const bytes = await node.readContent(hits.records[0]!.record);
node.close();
```

The included CLI creates a `default` collection and listens on
`127.0.0.1:7742`:

```bash
AGENT_DATA_NODE_TOKEN="a-dedicated-random-token" bun src/cli.ts serve
```

Use a scoped secret provider or child process environment in real deployments.
The `serve` command reads `AGENT_DATA_NODE_TOKEN`; it never reads or falls back
to an AgentTool API bearer. Without a node token, only discovery and the
manifest are available over HTTP. Direct in-process APIs continue to work.

## Black-box conformance

`agenttool-data doctor` probes a running node over its real HTTP socket. It
implements the executable `agent-data/v1-slice1-http` profile; it does not claim
universal conformance for in-process, Unix-socket, mTLS, or future peer
transports.

Start with the public profile. It accepts no operator credential and requests no
authorised fixture writes. It does send a generated invalid bearer plus
malformed, non-actionable collect/tombstone bodies to prove that authentication
runs before route work:

```bash
agenttool-data doctor http://127.0.0.1:7742 \
  --profile public \
  --format json
```

The public report includes the node's public `node_id`. Authenticated read-only
checks require a dedicated data-node bearer from non-interactive stdin or an
explicitly named environment variable:

```bash
secret-provider get agent-data-node-token | \
  agenttool-data doctor https://data.example \
    --profile read \
    --token-stdin

agenttool-data doctor http://127.0.0.1:7742 \
  --profile read \
  --token-env AGENT_DATA_NODE_TOKEN
```

`read` necessarily receives the authenticated collection manifests. It uses an
empty collection filter for query and does not request a successful live change
page, because change events embed real envelopes; valid cursor pagination is
exercised only inside the dedicated `slice1` scratch fixture. The read profile
still checks corrupt-cursor and query/change overflow errors without returning
corpus records. Other advertised body/record/item limits and collection policy
flags are shape-checked but are not all behaviorally exercised.

There is no implicit fallback to `AT_API_KEY`, `AGENTTOOL_API_KEY`, or any other
AgentTool project bearer. Token-value flags such as `--token` and `--bearer` are
rejected so a credential is not placed in argv. An environment variable is
still inherited process state; use a scoped secret-provider pipe when that
boundary matters. The default fetch requests `redirect: "manual"`, rejects 3xx
responses, and rejects an observed followed/changed response URL. A caller that
injects a custom `fetch` implementation is responsible for honouring those
request options; detection after a custom transport follows a redirect cannot
undo credential forwarding. Non-loopback targets must use HTTPS.

The complete fixture lifecycle is intentionally harder to invoke. Core v1 has no
collection provisioning or physical delete endpoint, so an operator must first
provision a collection used only for conformance and then bind the mutation to
the expected public node ID:

```bash
secret-provider get agent-data-node-token | \
  agenttool-data doctor https://data.example \
    --profile slice1 \
    --token-stdin \
    --scratch-collection conformance \
    --expected-node-id node_expected_from_public_run \
    --allow-mutations \
    --format json
```

This profile uses only the advertised caller-bytes `text` collector—never the
`file` or `http` collectors. It inserts unique control/doom records, checks
deduplication, exact bytes and digest, query, cursor pagination, filter binding,
tombstones, `410`, and tombstone idempotency. It only tombstones an ID after the
unique source/digest marker is independently confirmed by both an exact byte
read and the post-baseline created event. Authenticated reports publish fixture
counts and the tool-generated run marker, not server-controlled record IDs that
could act as a credential covert channel. A tombstone is logical state:
immutable envelopes, blobs, created/tombstone events, backups, and logs can
remain. The report calls this persistent residue and never claims physical
cleanup or secure erasure.

Exit codes are `0` for a passing selected profile, `1` for an observed required
mismatch, `2` for invalid local invocation/configuration, and `3` when required
results are inconclusive (for example, timeout or an unavailable fixture
prerequisite). JSON mode writes exactly one report to stdout; tool diagnostics
go to stderr. The report schema is exported as
`@agenttool/data/conformance-report.schema.json`, and the programmatic runner is
available from `@agenttool/data/conformance`:

```ts
import { runDataNodeConformance } from "@agenttool/data/conformance";

const report = await runDataNodeConformance({
  target: "http://127.0.0.1:7742",
  profile: "read",
  token: process.env.AGENT_DATA_NODE_TOKEN,
});
```

A PASS means only that this runner observed the selected executable profile at
that target and time. It is not a signed certificate or endorsement and does
not prove publisher identity, source truth/safety, vulnerability absence, TLS
host ownership beyond the observed connection, durability, secure erasure,
collector sandboxing, policy enforcement that was not advertised, peer sync,
decentralisation, or behaviour outside the probes.

## Storage and records

The default layout is:

```text
.agent-data/
  data.sqlite
  blobs/<hash-prefix>/<sha256>.blob
```

The SQLite database and active `-wal` / `-shm` sidecars are tightened to mode
`0600`. Existing caller-owned parent directories are not chmodded. Blob writes
verify any existing CAS entry; new or repaired bytes are written to a `0600`
temporary file, file-synced, atomically renamed, and followed by directory
syncs before record metadata is committed. These are explicit durability
requests to the operating system and filesystem, not a universal guarantee
against faulty storage hardware or a filesystem that does not honour `fsync`.

`RecordEnvelope` contains origin (`source`), content hash/size/media type,
collection schema version, metadata, ingestion time, optional observation time,
logical `key`/`version`, `supersedes_id`, provenance activities, and an optional
signature carrier. Records are insert-only and returned objects are deeply
frozen.

The ID is `rec_<sha256>` over canonical protocol, collection, complete source,
content descriptor, schema version, key/version, and supersedes link. It excludes
ingestion/observation time, metadata, expanded provenance, and signature.
Re-collecting unchanged content with those same identity fields therefore
resolves to the same ID; the first stored envelope wins and is never rewritten.
Changed content or an explicit new version produces a new record, which can
point back with `supersedes_id`.

`blob_ref` is an opaque node-local locator. It is not a portable URL. Use
`readContent()` directly or `GET /v1/data/records/:id`, which returns:

```json
{
  "record": { "id": "rec_…", "protocol": "agent-data/v1" },
  "content": { "encoding": "utf8", "data": "…" }
}
```

Non-text bytes use base64. The blob store verifies SHA-256 when writing and
reading. A tombstone hides a record from get/query and removes it from FTS; it
does not physically erase the immutable envelope or blob. Slice 1 has no blob GC.

## Collectors

Built-ins use one common request:

```json
{
  "collection_id": "research",
  "collector_id": "text",
  "input": {},
  "cursor": "optional-adapter-cursor"
}
```

- `text`: `text`, with optional `media_type`, `source_uri`, `external_id`, and
  envelope fields.
- `file`: one regular local `path`, with optional media/source overrides. The
  resolved local path is origin provenance and may be sensitive.
- `http`: one `url` and optional string `headers`; GET only, HTTP(S) only,
  bounded response bytes, timeout, and redirects. Caller headers are dropped
  before following a redirect to another origin.

The HTTP adapter checks the destination and every redirect. It blocks loopback,
private, link-local, and common reserved address ranges by default, including DNS
answers that resolve there. A trusted local integration can explicitly construct
`new HttpSourceAdapter({ allow_private_network: true })`. DNS validation is a
best-effort SSRF defence; it is not universal DNS-rebinding isolation or a network
sandbox. Put the node behind appropriate egress controls when hostile inputs are
in scope.

Custom collectors implement `SourceAdapter`. Custom `RecordStore`, `RecordIndex`,
and `BlobStore` implementations can be passed to `DataNode.open()`. Index search
and record listing use offset paging so `where` filtering is applied before the
requested result limit. The default node repairs missing FTS rows on open, and a
re-collection repairs a record committed just before an index failure.

## Collections and policy truth

A collection stores a schema version, optional JSON Schema document, and policy:

```ts
{
  max_record_bytes?: number;
  allowed_media_types?: string[];
  visibility?: "private" | "public"; // stored default: private
  ttl_seconds?: number;
  retention_days?: number;
  allowed_dids?: string[];
}
```

Slice 1 enforces `max_record_bytes` and `allowed_media_types`. JSON Schema,
visibility, TTL, retention, DID ACLs, and supplied signatures are retained as
declarations but are **not** validated or enforced. The capability manifest says
so field by field. HTTP therefore applies one node-level bearer boundary to every
data route regardless of collection visibility.

For `allowed_media_types`, absence means no collection-specific restriction; an
explicit empty array is a deny-all allow-list.

## HTTP API

`serveDataNode()` defaults to `127.0.0.1:7742`. Binding to a non-loopback host is
refused unless `node_bearer` is configured. The request body and collected content
have separate limits; JSON requests require `Content-Type: application/json`.

Public-safe routes:

| Method | Path | Result |
|---|---|---|
| `GET` | `/.well-known/agent-data` | `NodeManifest` |
| `GET` | `/v1/data/manifest` | `NodeManifest` |

Every route below requires `Authorization: Bearer <dedicated node token>`:

| Method | Path | Request / result |
|---|---|---|
| `GET` | `/v1/data/collections` | `{ "collections": [...] }` |
| `POST` | `/v1/data/collect` | `CollectRequest` → `CollectResponse` |
| `POST` | `/v1/data/query` | `QueryRequest` → `{ "records": [...], "consistency": "local" }` |
| `GET` | `/v1/data/records/:id` | resolved `{ "record", "content" }` |
| `GET` | `/v1/data/changes` | params `collection_id?`, `cursor?`, `limit?` |
| `POST` | `/v1/data/records/:id/tombstone` | `{ "reason"? }` → `{ "record_id", "tombstoned": true, "tombstone" }` |

Query JSON is snake_case and accepts:

```json
{
  "collections": ["research"],
  "text": "local-first",
  "where": { "metadata": { "topic": "agents" } },
  "limit": 20,
  "consistency": "local"
}
```

`where` is a recursive exact-subset match against the envelope. FTS covers valid
UTF-8 textual content, source identifiers, keys, and flattened metadata.

The change feed is append-only and emits `record.created` and
`record.tombstoned` events with a stable `change_<sequence>` ID, node-local
sequence, occurrence time, and embedded record or tombstone. Cursors are opaque
and bound to the chosen collection filter. They are not signatures or global
ordering guarantees.

Errors have one SDK-friendly shape:

```json
{
  "error": "unauthorized",
  "message": "A valid node bearer is required",
  "details": {}
}
```

`details` is omitted when empty.

## Default limits

| Limit | Default |
|---|---:|
| JSON request body | 1 MiB |
| collected record | 10 MiB |
| query result | 100 max, 20 default |
| change page | 1000 max, 100 default |
| items per collector call | 100 |

Collection record limits can only make the node-wide content limit stricter.
