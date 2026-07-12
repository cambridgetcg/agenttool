# @agenttool/data

Local-first `agent-data/v1` reference node. It owns collection, immutable record,
blob, FTS, change-feed, collector, and loopback HTTP behavior. It does not own the
hosted AgentTool API, SDK façade, federation, peer sync, or memory projection.

## Commands

```bash
bun install
bun run typecheck
bun test
bun run build
AGENT_DATA_NODE_TOKEN="scoped-node-token" bun src/cli.ts serve
```

## Map

- `src/types.ts` — protocol and pluggable storage/index/collector contracts
- `src/node.ts` — direct DataNode orchestration and envelope identity
- `src/sqlite-store.ts` — durable records/change log plus FTS5 index
- `src/blob-store.ts` — content-addressed filesystem bytes
- `src/collectors.ts` — bounded text, file, and HTTP collectors
- `src/server.ts` — authenticated snake_case HTTP surface
- `src/conformance.ts` — bounded no-redirect Slice 1 HTTP probes and report
- `src/cli.ts` — strict `serve` / `doctor` parser and credential-source boundary
- `schema/agent-data-conformance-report-v1.schema.json` — closed report schema
- `tests/` — node, durability, collector-security, route, CLI, and socket proofs

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
- Only size and media-type collection policy are enforced in Slice 1. Do not
  imply JSON Schema, TTL, retention, visibility, DID ACL, or signature validation.
  An explicit empty media-type allow-list denies every type.
- HTTP manifests are public; every data route requires the dedicated node bearer.
  Never read or reuse an AgentTool API token. Refuse bearerless non-loopback bind.
- `agenttool-data doctor` defaults to public/read-only operation. Its `slice1`
  profile requires an expected node ID, dedicated scratch collection, explicit
  persistent-residue acknowledgement, and a bearer from non-interactive stdin or
  an explicitly named environment variable.
- Public auth-boundary POST probes use malformed JSON and a random invalid
  record segment. They send no operator credential and cannot form a standard
  collect/tombstone mutation even if a broken target reaches route parsing.
- The default conformance fetch requests manual redirects and rejects 3xx or an
  observed changed/followed response URL. Injected fetch implementations are a
  trusted test/programmatic seam and must honour those options. Reports never
  serialize raw remote bodies, headers, cursors, credentials, or remote record
  IDs. PASS covers only
  `agent-data/v1-slice1-http` at the observed target/time; it is not a security,
  identity, durability, physical-cleanup, or secure-erasure claim.
- HTTP collection allows HTTP(S) only, rechecks redirects, bounds time/bytes, and
  blocks private destinations unless the adapter is explicitly opted in.
- A record/change commit can precede indexing. Re-collection and default-node
  startup must repair any missing FTS row.
- Keep all wire JSON snake_case and errors flat: `{ error, message, details? }`.
