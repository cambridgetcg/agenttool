# @agenttool/data

Local-first `agent-data/v1` reference node. It owns collection, immutable record,
blob, FTS, change-feed, collector, and loopback HTTP behavior. It does not own the
hosted AgentTool API, SDK façade, federation, peer sync, or memory projection.
Current source is the unpublished `0.2.0-dev.0` candidate; the immutable
`data-v0.1.0` release does not contain replica-import or feed-id seams.

## Commands

```bash
bun install
bun run typecheck
bun test
bun run build
AGENT_DATA_NODE_TOKEN="scoped-node-token" bun src/cli.ts
```

## Map

- `src/types.ts` — protocol and pluggable storage/index/collector contracts
- `src/node.ts` — direct DataNode orchestration and envelope identity
- replica apply seams live in `src/node.ts`; transport, grants, and cursors do not
- `src/sqlite-store.ts` — durable records/change log plus FTS5 index
- `src/blob-store.ts` — content-addressed filesystem bytes
- `src/collectors.ts` — bounded text, file, and HTTP collectors
- `src/server.ts` — authenticated snake_case HTTP surface
- `tests/` — node, durability, collector-security, and route proofs

## Invariants

- Protocol is `agent-data/v1`; npm package is `@agenttool/data`.
- Records are immutable. Same identity returns the first envelope; changes create
  a new record and may use `supersedes_id`.
- Blob bytes are SHA-256 verified. `blob_ref` is node-local, not a public URL.
- New/repaired blobs must be file-synced, atomically renamed, and directory-synced
  before metadata commit. A post-rename sync failure must remain visible on that
  call and be closed by syncing the valid shard on retry.
- SQLite owns and tightens only its DB/WAL/SHM files to `0600`; never chmod a
  caller-owned parent directory.
- Default consistency is local only. Manifest must continue to report
  `peer_sync: false` until real peer synchronization exists.
- `feed_id` is a persisted random identifier for one physical change-feed
  incarnation. It survives reopen and must not be derived from reusable node_id.
- Replica imports preserve the first remote immutable envelope/tombstone, ignore
  only its node-local `blob_ref`, and reject same-ID semantic conflicts. They do
  not authenticate peers or decrypt transport payloads.
- Only size and media-type collection policy are enforced in Slice 1. Do not
  imply JSON Schema, TTL, retention, visibility, DID ACL, or signature validation.
  An explicit empty media-type allow-list denies every type.
- HTTP manifests are public; every data route requires the dedicated node bearer.
  Never read or reuse an AgentTool API token. Refuse bearerless non-loopback bind.
- HTTP collection allows HTTP(S) only, rechecks redirects, bounds time/bytes, and
  blocks private destinations unless the adapter is explicitly opted in.
- A record/change commit can precede indexing. Re-collection and default-node
  startup must repair any missing FTS row.
- Keep all wire JSON snake_case and errors flat: `{ error, message, details? }`.
