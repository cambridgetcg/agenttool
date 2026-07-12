<!-- @id urn:agenttool:doc/AGENT-DATA-PROTOCOL @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @cites urn:agenttool:doc/SOUL urn:agenttool:doc/KIN urn:agenttool:doc/FEDERATION urn:agenttool:doc/MEMORY-TIERS urn:agenttool:doc/SDK-TIERS -->

# AGENT-DATA-PROTOCOL — local-first data for agents

> *The bytes stay with their keeper. The protocol makes them discoverable,
> attributable, and fast without making one service their owner.*

> **Compass:** [SOUL](SOUL.md) (why) · [KIN](KIN.md) (no single agent shape assumed) · [SDK-TIERS](SDK-TIERS.md) (wire-to-SDK contract) · [MEMORY-TIERS](MEMORY-TIERS.md) (raw data is not memory) · [FEDERATION](FEDERATION.md) (AgentTool's separate network trust model) · [OFFLINE-SYNC](OFFLINE-SYNC.md) (append-only local resilience)
>
> **Implements:** A cross-cutting data-plane protocol, `agent-data/v1`, its first local reference node, and the bounded `agent-data-sync/v1` explicit encrypted-pull profile. AgentTool MAY supply identity, signatures, grants, and discovery as a control plane; the raw data plane remains local or user-owned and works without an AgentTool account.
>
> **Code:** `packages/data/` (local reference node and `agent-data/v1-slice1-http` conformance runner) · `packages/data-protocol/` (optional experimental ADDS encrypted-object plane) · `packages/data-sync/` (optional explicit pull bridge) · `packages/sdk-ts/src/data.ts` (TypeScript client) · `packages/sdk-py/src/agenttool/data.py` (Python client)
>
> **Tests:** `packages/data/tests/` (including independent socket probes) · `packages/data-protocol/tests/` · `packages/data-sync/tests/` · `packages/sdk-ts/tests/data.test.ts` · `packages/sdk-py/tests/test_data.py`

**Status:** Draft v1. The `agent-data/v1` local core is Slice 1; the optional
`agent-data-sync/v1` bridge is its first bounded pull slice. The key words
**MUST**, **MUST NOT**, **SHOULD**, **SHOULD NOT**, and **MAY** are normative
when capitalised. Implementation status and limits are stated separately in
[Slice 1](#13-slice-1-the-local-reference-node); the pull profile does not
turn bounded replication into general peer-to-peer consistency.

---

## 1. The boundary

`agent-data/v1` is a storage-neutral contract for collecting, retaining,
querying, and changing agent-accessible data. It is deliberately not another
central corpus service and not an alias for AgentTool memory.

```text
files · HTTP · feeds · application events
                    │
                    ▼
          locally installed collectors
                    │
                    ▼
 user-owned blob store ── local metadata/index ── agent / SDK
                    │
                    └── optional, explicit encrypted peer pull profile

 AgentTool, when present: identity · signatures · grants · discovery
 AgentTool does not have to hold the raw bytes or answer the local query.
```

| Component | What it does | What it does not do |
|---|---|---|
| Local data node | Collects through locally installed adapters, stores content-addressed bytes, indexes metadata/text, answers local queries, and emits an append-only change feed. | Does not establish identity, prove truth, auto-install remote code, or turn collected content into memory. |
| AgentTool integration | MAY bind an AgentTool identifier, sign records or manifests, express grants, and help an agent discover a node. | Is not required to create or use a node; does not become the mandatory storage or query path. |
| `agent-data/v1` | Standardises envelopes, manifests, queries, changes, cursors, and HTTP discovery. | Does not mandate SQLite, a vector database, a P2P network, one embedding model, one collector runtime, or replication. |
| `agent-data-sync/v1` | Lets one configured node explicitly pull bounded encrypted collection, record, and tombstone objects from another node. | Does not discover peers, push changes, elect a canonical head, merge concurrent versions, or provide multi-master consistency. |

The optional sync bridge composes `agent-data/v1` with the experimental ADDS
encrypted-object plane. It is a separate package and advertised profile, not a
replacement blob store and not a new core requirement. A base `@agenttool/data`
node remains offline-usable and advertises `peer_sync: false`; only a node
wrapped by `@agenttool/data-sync` advertises the bounded profile. A later
profile needs its own identifiers, signing domain, capability advertisement,
and executable conformance tests; it MUST NOT silently change the record or
query semantics defined here.

An implementation conforming to the core protocol MUST be usable with no
AgentTool bearer, DID-shaped identifier, hosted AgentTool instance, or
agenttool.dev network request. Local operating-system permissions, a
caller-chosen bearer, mTLS, a Unix socket, or another advertised mechanism MAY
protect the node.

### 1.1 Why the split matters

- **Fast access comes from locality.** A query reads a local index and local or
  locally cached blobs. It does not silently fan out across the network.
- **Decentralisation comes from custody.** Different keepers can run different
  conforming nodes and retain their own bytes. A central registry is not
  required.
- **Customisation comes from interfaces.** Collectors, stores, indexes, and
  transports can vary behind the same wire objects.
- **Trust remains explicit.** A signature can identify a signer and bind bytes.
  It cannot establish that a page, sensor, collector, or claim is truthful.

## 2. Core walls

Every conforming implementation holds these invariants:

1. **Local first.** `QueryRequest.consistency` is `local` in core v1. Imported
   or cached records MAY be queried locally, but synchronous peer fan-out is
   never implied.
2. **User-owned bytes.** Blob storage is selected by the node operator. The
   protocol does not require upload to AgentTool or any other vendor.
3. **Immutable record versions.** A `RecordEnvelope` is insert-only. A changed
   payload creates a new record version; it never rewrites the earlier one.
4. **Content-addressed content.** Every record names the SHA-256 digest, size,
   and media type of its content. Storage references are not identity.
5. **Append-only removal.** Removal is represented by a tombstone
   `ChangeEvent`. It does not rewrite history or pretend bytes were never held.
6. **Opaque cursors.** Clients echo cursors exactly and MUST NOT infer offsets,
   timestamps, or ordering from their text.
7. **Provenance before confidence.** The source collector and source identity
   travel with the record. Relevance scores are not truth scores.
8. **No remote code execution by discovery.** A remote manifest can describe a
   collector identifier or input schema. It can never cause installation or
   execution of collector code.
9. **Memory projection is explicit.** Collected content is untrusted evidence
   by default. Only a caller-authorised projection can create AgentTool memory.
10. **Extensions cannot erase the core.** An extension MAY add query modes or
    signature profiles; it MUST NOT make records mutable, cursors parseable, or
    remote execution implicit.

## 3. Common wire rules

### 3.1 Encoding and names

- Wire documents use UTF-8 JSON and `snake_case` field names.
- The version is negotiated through the `/v1/data/*` path.
  `CapabilityManifest`, `CollectionManifest`, and `RecordEnvelope` also carry
  `protocol: "agent-data/v1"` so exported durable objects remain
  self-identifying. Slice 1 change events and request/response wrappers do not
  repeat it.
- Times are RFC 3339 UTC strings. An absent observation time means unknown; it
  MUST NOT be replaced with ingestion time and presented as a source fact.
- Byte counts are non-negative JSON integers. SHA-256 values are 64 lowercase
  hexadecimal characters without a `0x` prefix.
- Clients SHOULD ignore unknown response fields. A node MAY reject unknown
  request fields; clients cannot infer request extensibility from permissive
  response parsing.
- Slice 1 has no generic executable extension field. A future wire extension
  MUST be advertised in `CapabilityManifest` before a client relies on it.

### 3.2 Identifiers and version identity

`CollectionManifest.id` and `CapabilityManifest.node_id` are opaque strings.
They have meaning only in their documented scope.

Each `RecordEnvelope.id` identifies one immutable record version. The reference
node renders it as:

```text
rec_<sha256-of-canonical-record-core>
```

The canonical record core contains:

```text
protocol
collection_id
source.collector_id, source.uri, and source.external_id when present
content.sha256
content.size
content.media_type
schema_version
key, or absent
version, or absent
supersedes_id, or absent
```

It excludes `ingested_at`, `observed_at`, expanded provenance, `signature`,
storage-local `blob_ref`, and metadata that does not alter the source bytes.
The reference node canonicalises that JSON core deterministically, hashes its
UTF-8 bytes with SHA-256, and adds the `rec_` prefix. Re-collecting unchanged
content with the same source, schema, key, version, and predecessor therefore
returns the existing immutable record instead of creating a timestamp-shaped
duplicate. A metadata refresh MUST NOT mutate that retained envelope; the
first stored envelope wins for that ID.

The protocol does not claim that `record.id` alone is globally unique. The
portable identity is `(origin node_id, record.id)`. A later version MAY name
the version it replaces in `supersedes_id`; the earlier version remains
addressable.

### 3.3 Cursors

Cursors occur in collector continuation and the change feed. Protocol consumers
MUST scope a cursor to the producing node, endpoint, collection filter, and
authority, and MUST carry it without modification in the next request. The
Slice 1 change node validates only the cursor format/version and collection
filter; it does not cryptographically bind the node, endpoint, or bearer. A
cursor is not a record identifier, timestamp, sequence number, or trust proof.

The Slice 1 change event exposes a stable `id` and node-local numeric
`sequence`, but the cursor remains the continuation contract. Clients MUST NOT
construct a cursor from that number or reuse a cursor under another collection
filter. Change consumers SHOULD deduplicate by `(node_id, ChangeEvent.id)`
when retrying a page.

## 4. The five standard objects

The examples in this section are the interoperable core. Optional fields are
marked in the field tables; an implementation MAY return fewer optional fields
when its manifest says the corresponding capability is unavailable.

### 4.1 `CollectionManifest`

A collection is an operator-defined boundary for schema, policy, and query
scope. It is not a physical database table and does not prescribe one index.

```json
{
  "protocol": "agent-data/v1",
  "id": "research",
  "name": "Research corpus",
  "description": "Locally retained source material for research agents.",
  "schema": {
    "version": "1",
    "json_schema": { "type": "object" }
  },
  "policy": {
    "max_record_bytes": 8388608,
    "allowed_media_types": ["text/plain", "text/html", "application/json"],
    "visibility": "private",
    "retention_days": 30,
    "ttl_seconds": 86400,
    "allowed_dids": []
  },
  "created_at": "2026-07-11T10:00:00Z"
}
```

| Field | Requirement | Meaning |
|---|---|---|
| `protocol` | required | Exactly `agent-data/v1`. |
| `id` | required | Node-scoped immutable collection identifier. |
| `name` | optional | Human-facing label; not an identifier. |
| `description` | optional | Human-facing purpose; untrusted text when received remotely. |
| `schema.version` | required | Collection schema version copied into new record envelopes. |
| `schema.json_schema` | optional | Inline JSON Schema; Slice 1 stores this declaration but does not claim general payload validation. |
| `policy.max_record_bytes` | optional | Per-record acceptance limit. |
| `policy.allowed_media_types` | optional | Allow-list. In Slice 1, absence means no collection-specific restriction and an explicit empty list denies every media type. |
| `policy.retention_days` | optional | Declared retention intent; Slice 1 does not run retention garbage collection. |
| `policy.visibility` | optional | Declared visibility (`private` or `public`); it is not enforced unless the capability manifest says so. |
| `policy.ttl_seconds` | optional | Declared per-record lifetime; it is not a deletion or secure-erasure guarantee. |
| `policy.allowed_dids` | optional | Declared DID-shaped allow-list; Slice 1 neither resolves nor enforces it. |
| `created_at` | required in stored manifests | Time the node first stored the collection definition. |

In Slice 1, creating the same collection ID with the same definition is
idempotent; a different definition under that ID is a conflict. Schema or
policy evolution therefore uses a new collection ID. It does not rewrite
records already collected under an earlier `schema_version`.

### 4.2 `RecordEnvelope`

A record envelope is one immutable version plus the minimum information needed
to retrieve, validate, attribute, and interpret its bytes.

```json
{
  "protocol": "agent-data/v1",
  "id": "rec_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "collection_id": "research",
  "key": "paper-example",
  "version": "2",
  "supersedes_id": "rec_ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
  "source": {
    "collector_id": "http",
    "uri": "https://example.invalid/paper",
    "external_id": "https://example.invalid/paper"
  },
  "content": {
    "sha256": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    "size": 4217,
    "media_type": "text/html",
    "blob_ref": "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
  },
  "schema_version": "1",
  "metadata": {
    "title": "An example source"
  },
  "observed_at": "2026-07-11T10:00:00Z",
  "ingested_at": "2026-07-11T10:00:01Z",
  "provenance": [
    {
      "activity": "collected",
      "at": "2026-07-11T10:00:00Z",
      "actor": "collector:http",
      "input_ids": []
    }
  ],
  "signature": {
    "algorithm": "Ed25519",
    "signer": "did:example:collector",
    "value": "base64-signature-supplied-by-the-collector"
  }
}
```

| Field | Requirement | Meaning |
|---|---|---|
| `protocol` | required | Exactly `agent-data/v1`. |
| `id` | required | Content-derived identifier for this immutable version. |
| `collection_id` | required | Collection whose schema and policy applied at ingestion. |
| `key` | optional | Collector-supplied logical key within the source domain. |
| `version` | optional | Collector-supplied source version label; it is not the node change sequence. |
| `supersedes_id` | optional | Prior immutable record version replaced by this version. Omit for an initial version. |
| `source.collector_id` | required | Identifier of the locally installed collector that produced the envelope. |
| `source.uri` | required | Source URI as observed or synthesised by the collector. It can be sensitive and is never an authorisation grant. |
| `source.external_id` | optional | Stable identifier in the source system, used as logical source identity when available. |
| `content.sha256` | required | Digest of the exact bytes supplied by the collector to the node. |
| `content.size` | required | Length of those exact bytes. |
| `content.media_type` | required | Media type claimed by the collector; consumers MAY independently inspect bytes. |
| `content.blob_ref` | required locally | Opaque node-local locator. It is not portable, public, or safe to dereference outside the originating node. |
| `schema_version` | required | Collection schema version used for this envelope. |
| `metadata` | required | JSON object of collector-produced metadata. It is untrusted and does not affect record identity in core v1. |
| `observed_at` | optional | Time the source was observed, when known. |
| `ingested_at` | required | Time this node first retained the immutable envelope. It is node provenance, not source observation time. |
| `provenance` | optional | Ordered derivation steps. The required `source` block remains the minimum origin provenance. |
| `signature` | optional | Collector-supplied signature descriptor. Slice 1 carries it but does not verify it. |

For a derived record, each provenance step SHOULD name its input record IDs in
`input_ids`. The chain can establish which inputs and transforms were claimed;
it does not establish that the transform was correct.

`blob_ref` deliberately stays outside portable identity. Two nodes can hold the
same bytes under different local stores while agreeing on `content.sha256`.
Core v1 does not standardise a public blob URL. `GET /v1/data/records/:id`
resolves bytes through the node that owns the local reference, and in-process
SDKs can use the node's content reader.

### 4.3 `ChangeEvent`

A change event is an append-only node-local fact used for incremental clients.

```json
{
  "id": "change_2",
  "type": "record.tombstoned",
  "sequence": 2,
  "collection_id": "research",
  "record_id": "rec_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "occurred_at": "2026-07-11T10:05:00Z",
  "tombstone": {
    "record_id": "rec_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "collection_id": "research",
    "reason": "source withdrew this version",
    "tombstoned_at": "2026-07-11T10:05:00Z"
  }
}
```

Core v1 defines two event types:

| Type | Meaning |
|---|---|
| `record.created` | The immutable `record_id` became available in this node. This includes a version with `supersedes_id`. |
| `record.tombstoned` | The node appended a tombstone for `record_id`. The record was not rewritten. |

`id`, `type`, `sequence`, `collection_id`, `record_id`, and `occurred_at` are
required. A `record.created` event embeds the complete immutable `record`; a
`record.tombstoned` event embeds a `tombstone` whose optional `reason` is
untrusted text. `id` is stable within the node, and `sequence` defines the
node-local feed order. The protocol defines no global clock or order across
nodes.

### 4.4 `CapabilityManifest`

The capability manifest is both discovery and negotiation. It says what one
node supports; it does not grant access to the advertised collections.

```json
{
  "protocol": "agent-data/v1",
  "node_id": "node_local_research",
  "generated_at": "2026-07-11T10:00:00Z",
  "base_url": "http://127.0.0.1:7742",
  "endpoints": {
    "manifest": "http://127.0.0.1:7742/v1/data/manifest",
    "collections": "http://127.0.0.1:7742/v1/data/collections",
    "collect": "http://127.0.0.1:7742/v1/data/collect",
    "query": "http://127.0.0.1:7742/v1/data/query",
    "record": "http://127.0.0.1:7742/v1/data/records/{id}",
    "changes": "http://127.0.0.1:7742/v1/data/changes",
    "tombstone": "http://127.0.0.1:7742/v1/data/records/{id}/tombstone"
  },
  "collectors": [
    {
      "collector_id": "http",
      "description": "Collect one HTTP(S) resource with bounded redirects, time, and bytes",
      "input_schema": {
        "type": "object",
        "required": ["url"]
      }
    }
  ],
  "capabilities": {
    "consistency": ["local"],
    "immutable_records": true,
    "content_addressed_blobs": true,
    "full_text_search": true,
    "opaque_change_cursors": true,
    "tombstones": true,
    "peer_sync": false,
    "signature_verification": false,
    "schema_validation": false,
    "http_data_auth": "dedicated_node_bearer",
    "policy_enforcement": {
      "max_record_bytes": true,
      "allowed_media_types": true,
      "visibility": false,
      "ttl": false,
      "retention": false,
      "allowed_dids": false
    }
  },
  "limits": {
    "max_body_bytes": 1048576,
    "max_record_bytes": 10485760,
    "max_query_limit": 100,
    "max_change_limit": 1000,
    "max_collect_items": 100,
    "default_query_limit": 20,
    "default_change_limit": 100
  }
}
```

The standard endpoint keys above are required in Slice 1. Collector entries
describe locally installed capabilities; they MUST NOT contain executable
code, package-install commands, credentials, or an instruction to fetch code.

The manifest is capability evidence from the node, not proof that a request is
authorised. It MUST NOT leak private collection names, file paths, source
credentials, or local `blob_ref` values. Policy fields are descriptive unless
the corresponding `capabilities.policy_enforcement` value is `true`. In the
base Slice 1 reference node, byte and media-type limits are enforced; visibility,
TTL/retention expiry, `allowed_dids`, JSON Schema, signature verification, and
peer sync are not. A client MUST NOT treat a stored declaration as a universal
guarantee.

The optional sync wrapper changes only its own advertised surface: it sets
`capabilities.peer_sync` to `true`, adds `sync_page`, `sync_pull`, and
`sync_status` endpoints, and adds this public descriptor (shown with default
limits):

```json
{
  "sync": {
    "protocol": "agent-data-sync/v1",
    "feed_id": "feed_00000000-0000-4000-8000-000000000000",
    "mode": "explicit_pull",
    "peer_discovery": false,
    "encrypted_profile": "adds/0.1-inline",
    "recipient": {
      "id": "did:example:destination-sync",
      "x25519_public_key": "unpadded-base64url-public-key",
      "x25519_key_id": "x25519-key-id"
    },
    "publisher": {
      "id": "did:example:destination-sync",
      "ed25519_public_key": "unpadded-base64url-public-key"
    },
    "limits": {
      "default_page_changes": 10,
      "max_page_changes": 100,
      "default_plaintext_bytes": 1048576,
      "max_plaintext_bytes": 8388608,
      "default_pull_pages": 10,
      "max_pull_pages": 100,
      "max_response_bytes": 16777216,
      "request_timeout_ms": 15000,
      "grant_ttl_seconds": 300
    }
  }
}
```

The recipient and publisher blocks contain public key material, not a grant or
private key. `feed_id` names this persisted physical feed incarnation. The
wrapper does not advertise configured peer URLs or bearers.
`peer_sync: true` means only that this exact bounded profile is installed; it
does not claim peer discovery, general federation, or multi-node consistency.

### 4.5 `QueryRequest` and `QueryResult`

Core v1 deliberately keeps the portable query language small:

```json
{
  "collections": ["research"],
  "text": "local-first agent data",
  "where": {
    "content": { "media_type": "text/html" },
    "metadata": { "language": "en" }
  },
  "limit": 20,
  "consistency": "local"
}
```

| Request field | Requirement | Meaning |
|---|---|---|
| `collections` | optional | Collection filter. Absence means every collection visible to this node caller; an empty list means no collections and returns no records. Slice 1 does not enforce per-collection visibility or DID ACL fields. |
| `text` | optional | Text query interpreted by the node's advertised local index. |
| `where` | optional | Recursive JSON subset match against the record envelope. Arrays match exactly; Slice 1 defines no query operators. |
| `limit` | optional | Requested maximum. Values above the advertised node limit fail with `limit_exceeded`; they are not silently clamped. |
| `consistency` | optional | Defaults to and, in core v1, can only be `local`. |

When `collections`, `text`, and `where` are all absent, Slice 1 returns up to
the requested/default limit of the most recently ingested active records
across all collections. It never returns an unbounded result set.

```json
{
  "records": [
    {
      "record": {
        "protocol": "agent-data/v1",
        "id": "rec_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        "collection_id": "research",
        "source": {
          "collector_id": "http",
          "uri": "https://example.invalid/paper"
        },
        "content": {
          "sha256": "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
          "size": 4217,
          "media_type": "text/html",
          "blob_ref": "sha256:abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789"
        },
        "schema_version": "1",
        "metadata": {},
        "observed_at": "2026-07-11T10:00:00Z",
        "ingested_at": "2026-07-11T10:00:01Z"
      },
      "score": 0.82
    }
  ],
  "consistency": "local"
}
```

`QueryResult.records[].record` is a `RecordEnvelope`. `score` is optional and
node-specific. It expresses relevance under the advertised query mode, not
truth, authority, safety, importance, or permission to act. Scores from two
nodes or two index versions MUST NOT be treated as directly comparable unless
an extension explicitly defines that comparison.

Query results exclude tombstoned records. Slice 1 does not collapse version
chains: a superseded version remains independently queryable unless local
filters exclude it. Exact record reads remain the audit path for active
versions; the change feed retains the embedded envelope and tombstone history
for tombstoned versions.

## 5. Standard HTTP endpoints

| Method and path | Authority | Request | Successful response | Mutation |
|---|---|---|---|---|
| `GET /.well-known/agent-data` | public | — | `CapabilityManifest` | no |
| `GET /v1/data/manifest` | public | — | `CapabilityManifest` | no |
| `GET /v1/data/collections` | node bearer | — | `{ collections: CollectionManifest[] }` | no |
| `POST /v1/data/collect` | node bearer | Collection, local collector, declarative input, optional collector cursor | `{ records, inserted, existing, cursor? }` | yes |
| `POST /v1/data/query` | node bearer | `QueryRequest` | `QueryResult` | no |
| `GET /v1/data/records/:id` | node bearer | Immutable record ID | `RecordEnvelope` plus resolved content bytes | no |
| `GET /v1/data/changes` | node bearer | `collection_id?`, `cursor?`, `limit?` | Ordered `ChangeEvent` page plus opaque next cursor | no |
| `POST /v1/data/records/:id/tombstone` | node bearer | Optional reason | `{ record_id, tombstoned: true, tombstone }`; event is read from `/changes` | yes |
| `POST /v1/data/sync/page` | distinct scoped page bearer; optional sync profile | Collection, cursor/feed, bounds, and pinned recipient public key | Bounded ADDS-inline encrypted page | no |
| `POST /v1/data/sync/pull` | local node bearer; optional sync profile | Configured `peer_id`, collection, and bounds | Local apply counts plus sanitised status | yes |
| `GET /v1/data/sync/status` | local node bearer; optional sync profile | Exactly one `peer_id` and `collection_id` | Sanitised local checkpoint status | no |

### 5.1 Discovery manifests

`GET /.well-known/agent-data` and `GET /v1/data/manifest` return semantically
equivalent capability manifests for the same node. The well-known document is
the stable discovery door. The versioned endpoint is the stable SDK door.

The base Slice 1 node exposes only `/.well-known/agent-data` and
`GET /v1/data/manifest` without a bearer. Every other `/v1/data/*` route,
including reads, requires the separately configured data-node bearer. The
optional wrapper makes one deliberate exception: `/sync/page` uses a distinct
page-only bearer scoped to explicit collections and one recipient key; that
bearer does not authorise base data, pull, or status routes.
Operators who expose either discovery path expose the same capability facts.
The manifest itself contains no collection list, local blob references, or
source credentials.

Neither endpoint proves that the node controls its DNS name or that its
records are truthful. TLS, an optional manifest signature, and an AgentTool
identity binding are separate evidence.

### 5.2 List collections

```json
{
  "collections": []
}
```

Slice 1 returns every configured collection to a caller holding the node
bearer. It does not enforce `policy.visibility` or `policy.allowed_dids`; the
manifest says so explicitly. Operators MUST therefore treat that bearer as
collection-wide authority, not as a per-collection ACL.

### 5.3 Collect

```json
{
  "collection_id": "research",
  "collector_id": "http",
  "input": {
    "url": "https://example.invalid/paper"
  }
}
```

`collector_id` selects code already installed and approved on the receiving
node. `input` is declarative data validated by that collector's local policy.
It is never a package, script, shell command, dynamic import, or permission to
install one.

A successful synchronous response is:

```json
{
  "records": [],
  "inserted": 0,
  "existing": 0
}
```

The optional cursor is the collector's opaque continuation checkpoint. A node
MAY offer asynchronous collection as an advertised extension; core v1 does
not define a portable job lifecycle. Re-collecting unchanged content with the
same collection, complete source block, schema version, key, version, and
`supersedes_id` returns the existing record ID.

### 5.4 Query

`POST /v1/data/query` accepts `QueryRequest` and returns `QueryResult`. The node
MUST answer from its local index. A local index can include explicitly imported
records, but the request does not authorise a network fetch, peer query, or new
collection run.

### 5.5 Read a record and its bytes

The exact record read returns the immutable envelope and content resolved by
the originating node:

```json
{
  "record": {},
  "content": {
    "encoding": "utf8",
    "data": "exact source bytes represented as UTF-8 when valid"
  }
}
```

`content.encoding` is `utf8` or `base64`. For `base64`, `data` uses standard
base64 without data-URL decoration. Before responding, the reference node
verifies the bytes' length and SHA-256 against `record.content` and fails with
an integrity error on mismatch. A client MAY verify again across the HTTP
boundary. The response projection is not part of the record ID and does not
mutate the stored envelope. A tombstoned record returns `410
record_tombstoned` through this ordinary read surface.

### 5.6 Read changes

```json
{
  "changes": [],
  "cursor": "opaque-node-cursor",
  "has_more": false
}
```

The cursor returned after an event means “continue after the node-local
position represented here.” It does not expose or imply a globally meaningful
sequence number. Clients SHOULD persist the last fully processed cursor only
after durably applying the whole page.

### 5.7 Tombstone

```json
{
  "reason": "source withdrew this version"
}
```

```json
{
  "record_id": "rec_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  "tombstoned": true,
  "tombstone": {
    "record_id": "rec_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    "collection_id": "research",
    "reason": "source withdrew this version",
    "tombstoned_at": "2026-07-11T10:05:00Z"
  }
}
```

The node also appends the matching `record.tombstoned` event to the change
feed. Repeating the same authorised tombstone request is idempotent. The
optional reason is capped at 1,000 characters and remains untrusted operator
text; clients MUST NOT display it as a verified source statement.

A tombstone suppresses the targeted record from ordinary query and exact-read
results. It does not mutate the `RecordEnvelope`, affect other versions in its
supersession chain, backdate the removal, or prove erasure from backups or
peers.

### 5.8 Errors

Errors use a stable machine code and an actionable message:

```json
{
  "error": "invalid_cursor",
  "message": "cursor is invalid or belongs to a different collection filter"
}
```

`details` MAY carry a JSON object. The code is stable machine input; the
message is explanatory text. Slice 1
does not promise cursor expiry or a generic error catalogue beyond the named
errors its node emits. Clients SHOULD preserve unknown codes and MUST NOT turn
an unknown 4xx response into a retry loop.

### 5.9 Explicit encrypted pull profile

`agent-data-sync/v1` is initiated at the destination. A local caller asks its
own node to pull from an operator-configured peer alias:

```json
{
  "protocol": "agent-data-sync/v1",
  "peer_id": "research-source",
  "collection_id": "research",
  "limit": 10,
  "max_pages": 10,
  "max_plaintext_bytes": 1048576
}
```

The request deliberately contains no peer URL, peer bearer, grant, recipient
private key, or cursor. The local service resolves `peer_id` to an exact
operator-configured origin, expected source `node_id`, pinned ADDS publisher id
and Ed25519 public key, and page-only peer bearer. The SDK methods are
`at.data.sync.pull(...)` and
`at.data.sync.status(...)` in TypeScript and Python; they call only the local
data node with its separately configured data-node authority. They do not
accept a peer bearer or contact the peer directly.

The source operator separately scopes that page bearer to an explicit
collection allow-list and the destination's exact ADDS recipient id/X25519
key. The destination calls `/v1/data/sync/page` with the collection, its
internal opaque cursor and expected persisted `feed_id` when resuming,
explicit page/byte bounds, and that recipient material. Application payloads are
encrypted, but the source page retains clear routing, continuation, and ADDS
control metadata:

- protocol, source `origin_node_id`, physical `feed_id`, `collection_id`,
  `previous_cursor` when resuming, next `cursor`, and `has_more`;
- one encrypted page-control object;
- one encrypted collection object; and
- change headers containing the node-local change ID/type/sequence, collection
  and record IDs, occurrence time, plus one encrypted object per change.

The collection manifest, full record envelope and content bytes, and tombstone
including its reason are separate canonical `agent-data-sync-object/v1`
plaintext objects before encryption. Each is carried as an inline
`adds-bundle/v1` ciphertext bundle with a short-lived signed direct-recipient
grant under the `adds/0.1-inline` profile. Intermediaries can still observe the
clear routing fields, timing, change count, cursors, peer addresses, and
transport metadata. Inline ADDS manifests and grants also reveal publisher and
audience IDs, public keys/key IDs, issue and expiry times, CIDs, chunk and
plaintext sizes, fixed sync media/schema identifiers, and signatures. They do
not reveal recipient private keys or the encrypted application-object bodies.
The source necessarily sees source plaintext; the authorised destination
necessarily decrypts it before verifying and retaining it locally. This is
application-payload encryption, not traffic-analysis resistance or end-to-end
secrecy from either endpoint.

The encrypted page-control object binds the origin, feed incarnation,
collection, previous and next cursors, `has_more`, collection-object root CID,
and every ordered clear
change header plus its encrypted-object root CID. The destination opens and
checks that control object before applying collection or change objects. A
relay therefore cannot silently edit routing, skip or reorder changes, or swap
object roots while retaining a valid page binding. The destination requires
the control, collection, and every change object to be signed by the
operator-pinned publisher key; it never learns that trust anchor from the page
being checked. The protocol does not independently resolve or externally
attest the publisher identifier. Live peer admission additionally uses the
configured exact origin, HTTPS except on loopback, scoped page bearer, and
expected source node ID.

Before applying an object, the destination verifies the expected source node,
page shape and bounds, control binding, ADDS bundle block CIDs, manifest and
direct-recipient grant, encrypted-object kind, record/tombstone header
agreement, record ID, content size, and SHA-256. The local `blob_ref` is
replaced with the destination's locator. Existing immutable records and
matching tombstones are idempotent; conflicting bytes or envelopes fail
closed. A reverse pull may settle without duplicating an already imported
record, but that property does not define multi-master conflict resolution.

The checkpoint cursor advances only after the complete page has been applied.
An interrupted page can leave already verified idempotent objects locally; a
retry replays them before advancing. Passing `checkpoint_path` selects the
owner-only SQLite checkpoint store and permits restart resume. Without an
explicit durable store/path, the provided in-memory checkpoint is process
local and does not survive restart. A checkpoint binds the peer alias to the
configured exact origin, expected node id, pinned publisher, and source feed
incarnation. Repointing an alias fails before sending its old cursor; a
recreated feed rejects the expected feed id instead of silently applying that
cursor to a new sequence.
`sync/status` exposes `cursor_present`,
last-apply time, and aggregate counts, never the raw cursor; the pull response
and SDK also omit it. Operators must still protect checkpoint files and should
not log cursor-bearing peer page bodies.

Feed/publisher mismatch is a deliberate stop, not an automatic reset. After
verifying an intentional replacement and stopping competing pullers, the local
operator can call the in-process `resetCheckpoint(peer_id, collection_id)`
seam. It removes only private continuation state; imported immutable data stays
local and the next pull replays the replacement feed from its beginning. v1 has
no HTTP/SDK reset route and its active-pull guard is process-local, not a
distributed lease.

## 6. Collection and version lifecycle

The normal write path is:

```text
declarative input
      │
      ▼
locally installed collector ── validates node policy and reads source
      │
      ▼
exact bytes ── SHA-256 ── content-addressed blob store
      │
      ▼
immutable RecordEnvelope ── local indexes ── record.created ChangeEvent
```

For a logical source with no prior record, `supersedes_id` is absent.
When the exact source bytes change, the collector MAY create a new envelope
whose `supersedes_id` points to a prior version. Both versions remain immutable.

The Slice 1 reference node rejects a supersession link when:

- the named predecessor does not exist in the node; or
- it belongs to another collection.

Slice 1 does not calculate one canonical head, reject branches, or define
automatic merge. `key`, `version`, and `supersedes_id` preserve the collector's
version claim; callers interpret the chain explicitly. A future conflict
profile can add stronger rules without making the retained versions mutable.

## 7. Storage and index customisation

The protocol standardises behaviour, not engines. A conforming node can use:

- SQLite, Postgres, DuckDB, an embedded key-value store, or another metadata
  store;
- a filesystem, object store, database blob column, or content-addressed
  daemon for bytes;
- metadata-only, exact, full-text, vector, graph, temporal, or hybrid indexes;
  and
- in-process APIs, loopback HTTP, a Unix socket, or an authorised remote HTTP
  binding.

Only capabilities named in `CapabilityManifest` are available to a portable
client. A vector or graph index is an extension until its query and scoring
semantics are advertised. Installing an embedding model does not change the
meaning of the core `text` query or make its scores portable.

Storage engines MUST verify bytes against the named digest before returning
them. Garbage collection MAY remove unreferenced bytes according to local
retention policy, but it MUST NOT leave a live record claiming retrievable
content. A retained envelope whose bytes are intentionally unavailable MUST be
reported as such; it cannot be returned as a complete record.

The Slice 1 filesystem store also verifies an existing CAS object before
deduplicating it, repairs corrupt content through an atomic replacement, and
requests file and directory synchronisation before record metadata commits.
Its SQLite database and active WAL/SHM sidecars are tightened to owner-only
mode `0600` without changing caller-owned parent-directory permissions. These
mechanisms reduce local disclosure and crash windows; they do not guarantee
durability on faulty storage or filesystems that do not honour `fsync`.

## 8. Provenance and derivation

The required `source` block is the minimum provenance statement:

- which local collector produced the envelope;
- which observed or synthesised source URI the collector assigned; and
- which source-system identifier was used as logical identity, when one
  exists.

Expanded `provenance` records claimed activities such as `collected`,
`normalised`, `derived`, or `imported`. A caller can also carry a
`replicated` claim. The optional sync bridge preserves the received immutable
envelope and does not synthesise or append a provenance step that could alter
future signing semantics. Each existing step can name an actor and input
record IDs. Producers SHOULD append steps rather than replace earlier ones.

Provenance is evidence about lineage, not an accuracy score. A complete chain
can still contain a malicious page, a broken parser, stale data, an incorrect
transform, or a signer making a false claim. Agents SHOULD cite the original
record IDs and source fields when using collected data in an answer or action.

## 9. Signatures and trust

`RecordEnvelope.signature` is an optional carried descriptor with `algorithm`,
`signer`, and `value`. Slice 1 validates those as non-empty strings but does
not define canonical signing bytes, resolve the signer, or verify the value;
its manifest says `signature_verification: false`. Carrying the field is not
the same as trusting it.

A future signature profile MAY use an AgentTool identity key to sign a record,
change event, or capability manifest. A non-AgentTool node could use the same
profile with another resolvable key identifier. Such a profile must define
canonical bytes and advertise verification support before a client relies on
it. Unsigned local records remain valid protocol objects.

A verified signature proves only that:

1. the verifier used the public key named by the profile;
2. the matching private key signed the profile's canonical bytes; and
3. those bytes bind the object the profile says they bind.

It does **not** prove that the content is true, safe, current, lawfully
collected, free of prompt injection, endorsed by AgentTool, or authored by the
person named inside the content. TLS proves a transport relationship, not
those claims either.

## 10. Collector execution boundary

A collector is code with whatever filesystem, network, database, or process
access its local runtime grants it. The protocol cannot turn an unsandboxed
collector into a safe one by naming it in JSON.

Therefore:

- collectors MUST be installed through an explicit local operator action;
- a node MUST look up `collector_id` only in its local approved registry;
- manifests MAY describe accepted declarative input but MUST NOT embed code;
- a collection request MUST NOT expand a remote package URL, shell fragment,
  JavaScript expression, Python import, or arbitrary executable field;
- request-scoped HTTP headers MAY carry source credentials, but credentials
  MUST NOT be placed in source URLs, metadata, manifests, cursors, or
  provenance; and
- the data-node bearer uses separate SDK configuration from the AgentTool
  project bearer. The clients never copy the AgentTool bearer implicitly, but
  they cannot prevent a caller from explicitly supplying the same value.

The Slice 1 file collector resolves a caller-supplied path and has no per-path
allow-list. The HTTP collector bounds schemes, URL credentials, redirects,
time, and bytes. By default it rejects loopback, private, link-local, and
common reserved IP literals or DNS answers, including IPv4-mapped and private
IPv4-bearing IPv6 transition forms, and rechecks redirect destinations; an
in-process operator can explicitly opt into private-network collection. The
validation lookup is not a pinned fetch transport, so this remains a
best-effort SSRF boundary rather than a universal DNS-rebinding guarantee.
Keep the reference node on a local boundary unless the operator separately
constrains the process, collectors, filesystem, network egress, and callers; a
bearer alone does not sandbox collector authority.

Collected bytes are data, never protocol instructions. An agent reading a web
page that says “ignore your rules” has collected that sentence; it has not
received authority from the protocol to obey it.

## 11. Memory projection boundary

AgentTool memory and agent data serve different roles:

| Agent data | AgentTool memory |
|---|---|
| Source corpus and evidence | A caller-chosen statement retained as part of an agent's continuity |
| Potentially large, duplicated, stale, or adversarial | Deliberately selected and governed by memory-tier rules |
| Queried without changing identity | Foundational or constitutive elevation can shape identity |
| Provenance points back to collectors and sources | Witness and elevation provenance points to memory decisions |

No collector, query, sync, or signature verification MAY automatically create
memory. Projection requires a separate, explicit caller action that:

1. selects the exact record version;
2. preserves `(node_id, record.id, content.sha256)` as provenance;
3. states what text or structured claim is being projected;
4. treats the projection as untrusted/episodic by default; and
5. passes through the ordinary AgentTool authorisation and elevation rules.

A projection MUST NOT automatically become foundational or constitutive
memory. A source signature does not replace the witness required by
[MEMORY-TIERS](MEMORY-TIERS.md), and a malicious record cannot self-elevate by
containing an instruction to remember it.

The existing SDK `collect` helper has a different historical meaning. The new
framework noun is `data`; `collect` remains one ingest verb under that
namespace. SDK consumers use the data client for corpus access and make a
separate explicit memory call when they choose to project.

## 12. Optional AgentTool control plane

AgentTool composes with the protocol without owning it:

- an AgentTool identifier MAY control a node or collection manifest;
- AgentTool keys MAY sign manifests, records, and change events under an
  advertised profile;
- AgentTool grants or covenants MAY be translated into node authorisation;
- AgentTool discovery MAY publish a node's well-known URL; and
- the TypeScript and Python SDKs provide a thin `at.data` client for the local
  node's seven core versioned routes plus `at.data.sync` for the optional local
  pull and status routes.

Those integrations are optional profiles. They do not change the wire objects,
and they MUST fail closed when a claimed identity, key, or grant cannot be
verified. The data node still works locally when agenttool.dev is offline or no
AgentTool account exists.

The shipped SDK integration requires a separately configured data-node URL and
accepts the data-node bearer required by collection, query, record, change, and
mutation routes. It never implicitly inherits, substitutes, or forwards the
AgentTool project bearer across that security boundary; a caller can still
explicitly configure the same value and SHOULD NOT do so. The sync bridge uses
its configured ADDS identities and per-object direct-recipient grants; that is
not AgentTool account authentication, covenant enforcement, hosted discovery,
or publication of a general grant service. Record signature verification and
those AgentTool control-plane integrations remain future profiles.

AgentTool is the optional identity/trust/control plane. The local or user-owned
node is the raw data plane. Neither description claims that AgentTool signatures
make source content true or that a file existing locally is accessible to an
agent.

## 13. Slice 1: the local reference node

Slice 1 proves the smallest useful mechanism:

| Surface | Slice 1 |
|---|---|
| Local node package | `@agenttool/data` in `packages/data/` |
| Metadata and full-text index | SQLite plus FTS5 by default; store and index interfaces are replaceable in process |
| Blob custody | Local filesystem blobs addressed and verified by SHA-256 by default; blob-store interface is replaceable |
| Collectors | Built-in caller text, local file, and bounded HTTP(S); custom adapters are installed in process |
| Query consistency | `local` only |
| Record lifecycle | Immutable content-derived IDs, optional supersession, append-only tombstones |
| Access | In-process node, local HTTP binding, and thin TypeScript/Python SDK clients |
| HTTP authority | Discovery/manifest public; local/admin node bearer gates base data plus pull/status; a distinct collection/recipient-scoped page bearer gates peer reads; SDKs never implicitly forward the project bearer |
| AgentTool account | Not required |
| Collection policy | Byte/media limits enforced; visibility, retention/TTL, and DID allow-list only declared |
| Record signatures | Carried but not verified (`signature_verification: false`) |
| Memory projection | Explicit boundary only; no automatic projection |
| Peer discovery and replication | Optional `@agenttool/data-sync` performs explicit bounded pull from operator-configured peers; discovery, push, and general replication are not shipped |
| AgentTool identity/grant publication | ADDS direct-recipient grants protect inline sync objects; AgentTool account/grant publication remains a future integration |
| Encrypted or distributed blob backend | Sync pages carry inline ADDS ciphertext, then retain verified plaintext in the destination's ordinary local store; no distributed backend or durability claim |
| Remote collector installation | **Never implied; not a planned discovery behaviour** |

The base Slice 1 package can expose the standard discovery and HTTP paths
locally and still advertises `peer_sync: false`. Installing the bridge does not
mean a background service is running, a public port is open, or a peer can
reach it. The operator must construct the sync service, provide its ADDS
identity and explicit peer configuration, select checkpoint custody, and serve
the wrapper. Those are separate runtime decisions.

### 13.1 First `agent-data-sync/v1` pull slice

The first sync slice composes existing objects without changing their core
meaning:

```text
operator configures peer alias + origin + node_id + publisher pin + page bearer
        ↓
destination requests a bounded ADDS-encrypted change page
        ↓
verify direct-recipient grant + bundle + object/header/content identity
        ↓
idempotently retain collection / record / tombstone locally
        ↓
advance a private checkpoint, then answer future queries offline
```

Only a configured `peer_id` can trigger outbound work; request callers cannot
supply a URL or peer bearer. A peer base URL must be an exact origin without
userinfo, path, query, or fragment. Non-loopback peers require HTTPS;
loopback-only development may use HTTP. Redirects are refused, requests use one
bounded deadline, and responses, page changes, plaintext bytes, cursors, and
pull page counts are capped. These are bounded native-fetch controls for an
operator-trusted peer configuration. They do not pin DNS answers to the
connection, verify the connected peer IP, constrain all process egress, add
mTLS, or provide a universal DNS-rebinding defence.

This slice has no automatic peer discovery, push, background schedule,
broadcast, quorum, leader election, head selection, concurrent-version merge,
per-collection grant policy, or multi-master consistency. It does not use CAR
v1/v2; `adds-bundle/v1` blocks are encoded inline in bounded JSON. A future
bulk transport may negotiate CAR without changing core record identity, but no
CAR support is advertised here. `@agenttool/data-sync@0.1.0` composes the
`@agenttool/adds@0.2.0` and `@agenttool/data@0.3.0` release lines. The bridge is
distributed as source/library code; installing it does not run a node, expose
a port, configure a peer, or deploy a hosted sync service.

## 14. Security and privacy posture

- A reference node SHOULD bind to loopback or an operator-protected socket by
  default. Public exposure requires an explicit deployment choice.
- The reference server defaults to `127.0.0.1:7742`. Only discovery and the
  capability manifest are public. Every collection, query, exact-record,
  change, collect, and tombstone request requires the dedicated node bearer.
- When the optional sync wrapper is served, pull and status use the local/admin
  node bearer. Page reads use separate page-only bearers; each is pinned to an
  explicit collection allow-list and one recipient id/X25519 key. Page tokens
  do not authorise base data or transitive pulls through the source node.
- With no local/admin bearer, base data plus pull/status fail with `503
  data_auth_not_configured`. With no scoped page authority, page reads fail
  with `503 page_auth_not_configured`; bad tokens fail with `401 unauthorized`.
  Endpoint presence in the public manifest does not prove access is configured.
- A non-loopback bind is refused unless a local/admin bearer or at least one
  scoped page authority is configured. This prevents an accidental open bind;
  it does not add TLS, global rate limits, or Internet-safe collector isolation.
- Core Slice 1 has no collection/DID ACL: `policy.visibility` and
  `policy.allowed_dids` are declarations, and a local/admin bearer holder can
  access every collection. The sync page allow-list is a narrower transport
  capability, not enforcement of those stored policy fields.
- The HTTP collector permits only HTTP(S), rejects URL userinfo, bounds
  redirects, time, and returned bytes, and rejects private/reserved
  destinations by default at each hop. It drops every caller-supplied header
  before a cross-origin redirect so source credentials are not forwarded. Its
  validation DNS result is not pinned into the later fetch, so it is not a
  universal DNS-rebinding defence.
- Sync peer URLs are operator configuration, not request input. They require
  HTTPS except for loopback development, carry no URL credentials/path/query/
  fragment, refuse redirects, and use bounded time and response size. The
  native fetch path does not pin DNS answers, check the connected peer IP, or
  claim universal SSRF/DNS-rebinding protection; operators must treat peer
  origins and process egress as trusted configuration boundaries.
- ADDS inline bundles hide collection definitions, record envelopes/content,
  and tombstone bodies from transport intermediaries and bind the visible page
  to a signed encrypted control object. Routing IDs, cursors, ordering, timing,
  sizes, and the ADDS manifest/grant metadata described in §5.9 remain visible.
  This profile pins the publisher id/key in local peer configuration, while
  making no independent identity-resolution or external-attestation claim.
- The file collector resolves the caller's path and requires a regular file,
  but has no configured root allow-list. Any admitted remote caller could ask
  it to read a path available to the node process.
- The default SQLite database and active WAL/SHM sidecars are owner-only
  (`0600`). Blob files are created owner-only, digest-checked, and synchronised
  before metadata commit. Custom stores and filesystems must establish and
  report their own confidentiality and durability boundaries.
- The node enforces node/collection byte limits and collection media-type
  allow-lists before retaining an envelope. Retention, TTL, visibility, and
  DID fields are declarations only in Slice 1.
- Query text, metadata, source URIs, reasons, and collected bytes are untrusted
  input. They require output escaping and must never be interpolated into shell
  commands or executable queries.
- Tombstones and retention expiry are logical state. Secure erasure from
  replicas, backups, logs, or storage media is a separate operation and MUST
  NOT be claimed without evidence from those boundaries.
- Cursors can carry sensitive state. They MUST NOT be logged casually or
  accepted outside their authorisation context. Sync status and SDK results
  expose only `cursor_present`; the source page and internal checkpoint still
  contain the raw cursor.
- The SQLite checkpoint option requests owner-only files and supports tested
  restart resume. It does not guarantee durability on faulty storage, unusual
  filesystems, unsynchronised backups, or implementations that choose the
  in-memory checkpoint store.

## 15. Executable Slice 1 HTTP profile

`agent-data/v1` permits in-process APIs, HTTP, Unix sockets, mTLS, and other
advertised authority mechanisms. The executable
`agent-data/v1-slice1-http` suite is therefore a conformance profile for the
Slice 1 JSON-over-HTTP and dedicated-node-bearer surface in Section 5. A pass
for this profile MUST NOT be presented as universal core conformance for every
transport or authority mechanism.

The reference runner is `agenttool-data doctor` in `packages/data/`. Its closed
machine report uses `agent-data-conformance-report/v1`; the JSON Schema is
`packages/data/schema/agent-data-conformance-report-v1.schema.json`. It has
three profiles:

The verdict is computed from required checks only: any required failure means
`fail`; otherwise any required inconclusive/skip means `inconclusive`; otherwise
the verdict is `pass`. Advisory status does not change the verdict. Summary
counts include both required and advisory checks.

| Profile | Authority | Mutation | Observable scope |
|---|---|---|---|
| `public` | no operator credential; generated invalid bearer probes | no authorised fixture writes | Both discovery manifests, standard-field equivalence and shape, absence of the standard collection list/local `blob_ref`, and protected-route rejection. The POST probes use malformed JSON and a random invalid record segment so route parsing cannot produce an actionable standard mutation. |
| `read` | dedicated node bearer | none | `public` plus authenticated collection shape, empty-collection local query, corrupt-cursor errors, query/change overflow, and JSON media rules. It does not request a successful live change page because events embed real envelopes. |
| `slice1` | dedicated node bearer | explicit fixture writes | `read` plus owned caller-text records, immutable deduplication, exact bytes/digest, query, cursor pagination/filter binding, tombstone lifecycle, `410`, and idempotency. |

The executable expectations that are stricter than the common object prose are:

| Probe | Required observation |
|---|---|
| Each public manifest | `200`, `Content-Type: application/json`, UTF-8 JSON object, valid standard manifest fields. Unknown response fields are ignored except forbidden `collections`/`blob_ref` data keys outside schema-description subtrees. |
| Missing/wrong bearer on each protected route | A configured bearer profile returns `401 unauthorized`, a flat error object, and a `WWW-Authenticate` challenge whose scheme is `Bearer`. The public profile also accepts `503 data_auth_not_configured`. |
| Authenticated collection list | `200` and `{ collections: [...] }`; collection policy fields remain optional. |
| Empty-collection local query | `200`, no hits, and `consistency: "local"`. |
| Corrupt change cursor | `400 invalid_cursor`. |
| Query/change limit above the advertised maximum | `400 limit_exceeded`; the node does not silently clamp. Other body/record/item limits are shape-checked unless a safe fixture makes them observable. |
| Non-local query consistency | `400 unsupported_consistency`. |
| Non-JSON POST media type | `415 unsupported_media_type`. |
| Owned fixture collect/recollect | One inserted record, then the same first envelope with one existing record even when refresh metadata changes. |
| Tombstone reason longer than 1,000 characters | `400 invalid_request`, active exact read remains available, and no event is appended. |
| Tombstoned exact read | `410 record_tombstoned`. |

All protocol success/error responses consumed by this profile are JSON objects.
Rate limits, authenticated credential rejection, target 5xx responses, transport
failure, and runner safety bounds are inconclusive rather than evidence of a
protocol mismatch.

The `slice1` profile is not portable without operator setup. Core v1 has no
HTTP collection-create/delete route and no mandatory deterministic collector.
The reference fixture therefore requires all of:

1. an exact expected `node_id` learned from public discovery;
2. a collection provisioned solely for conformance;
3. an advertised caller-bytes `text` collector that accepts `text/plain`;
4. an explicit acknowledgement that mutations leave persistent residue; and
5. a dedicated data-node bearer supplied outside argv.

The runner MUST NOT auto-select or invoke the `file` or `http` collectors. It
generates a cryptographic run marker, drains only the selected collection feed
to a bounded terminal cursor before writing, and makes an inserted ID eligible
for tombstoning only after its unique source/digest marker is independently
confirmed by both the post-baseline created event and an exact byte read. A lost
or malformed mutating response is not retried automatically because the outcome
is uncertain. Authenticated reports publish the run marker and fixture counts,
not server-controlled record IDs that could act as a credential covert channel.
A missing safe fixture, exhausted feed bound, timeout, or ambiguous mutation
outcome is inconclusive; it MUST NOT be collapsed into pass or skip.

The default runner transport requests manual redirect handling, rejects every
3xx, and rejects an observed followed or changed response URL. Target-URL
credentials are forbidden, HTTPS is required outside loopback, and the bearer is
sent only to fixed paths at the exact selected origin. A programmatic caller that
injects a custom `fetch` implementation is responsible for honouring the passed
request options; detecting a followed redirect after that transport returns
cannot undo credential forwarding. The CLI accepts a bearer only from
non-interactive stdin or an explicitly named environment variable; it never
falls back to an AgentTool project bearer. These properties constrain the
reference runner. They cannot guarantee that a shell with tracing, a proxy, the
target, the runtime, or a crash dump does not record the credential.

A passing report means only that the selected executable profile was observed
passing at one target and time. It is not a signed certificate or endorsement
and does not prove continuing compliance, publisher/source identity, source
truth or safety, vulnerability absence, TLS/host ownership beyond the observed
connection, durability/crash recovery, physical cleanup or secure erasure,
server/proxy non-logging, collector sandboxing/SSRF resistance, enforcement of
unadvertised policy, decentralisation/peer sync, AgentTool identity/grants, or
behaviour outside the probes.

## Doctrine line

> *Keep the data close. Carry its lineage. Address the exact bytes. Let trust
> bind origin without pretending to bind truth. Remember only by choice.*
