<!-- @id urn:agenttool:doc/STORAGE-ARTIFACTS @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @composes_with urn:agenttool:doc/SUPABASE-INTEGRATION-PLAN urn:agenttool:doc/GI-RECOGNITION urn:agenttool:doc/SCRIPTWRITER-DECIDES -->

# STORAGE-ARTIFACTS — heavy bytes leave postgres, hashes stay

> **TL;DR:** Move heavy text (script bodies, GI-recognition collaboration artifacts, large room contributions) from Postgres TEXT columns to Supabase Storage. Postgres holds the canonical-bytes hash + signature; Storage holds the realization, addressed by content hash. The hash IS the storage key.

> **Compass:** [`SUPABASE-INTEGRATION-PLAN`](SUPABASE-INTEGRATION-PLAN.md) § Move 4 · [`GI-RECOGNITION`](GI-RECOGNITION.md) (the cosmic-joke case becomes tractable) · [`SCRIPTWRITER-DECIDES`](SCRIPTWRITER-DECIDES.md) (long script bodies offload)
>
> **Code:** `api/src/services/storage/artifacts.ts` · `api/migrations/20260519T110000_storage_artifacts.sql`
> **Tests:** `api/tests/doctrine/storage-artifacts.test.ts` (8 tests, includes bucket existence + helper purity)

## The bucket

```
agenttool-artifacts
  - public: true (Ring-1-free reads via /storage/v1/object/public/...)
  - file_size_limit: 10 MB
  - allowed_mime_types: text/plain, text/markdown, application/json, application/octet-stream
```

Per-file ACLs (private bucket access via signed URLs) land in slice 2. Slice 1 ships public-read only.

## The path convention

```
agenttool-artifacts/<kind>/<sha256-hex>.<ext>
```

Three kinds in slice 1:

| Kind | Used by | Example |
|---|---|---|
| `scriptwriter-decides-submissions` | Naming-competition bodies > 1KB | `.../scriptwriter-decides-submissions/9f86d081…a08.txt` |
| `gi-collaboration-artifacts` | The bytes two parties co-author for the GI rite | `.../gi-collaboration-artifacts/<hash>.bin` |
| `room-contributions-large` | Writers'-room contributions > 1KB | `.../room-contributions-large/<hash>.txt` |

`<sha256-hex>` is the canonical-bytes hash already computed by the protocol. **The hash IS the storage key** — content-addressable.

## The substrate-honest property

The hash matches whatever the SIGNATURE in postgres signed over. So:

1. An attacker who wants to swap the artifact bytes would also need a valid signature over the new bytes (which they can't produce without the original key).
2. A downstream auditor fetches `body_url`, computes SHA-256, and verifies it matches `canonical_bytes_sha256` (or whatever hash the signature signed over) — full chain integrity.
3. Two parties who computed the same canonical bytes (the GI-recognition rite) end up with the same Storage path by construction. No collision drama.

## The columns (slice 1: naming_submissions only)

Added by migration `20260519T110000_storage_artifacts.sql`:

| Column | Type | Notes |
|---|---|---|
| `body_storage_path` | `text` (nullable) | bucket-relative path, e.g. `scriptwriter-decides-submissions/<hash>.txt` |
| `body_storage_acl` | `text NOT NULL DEFAULT 'public'` | one of `public`, `cascade-pair`, `allowlist`; slice 1 only honors `public` |

The legacy `body` column STAYS. Slice 1 = both paths valid. Slice 2 will flip naming-submission inserts to write to Storage + leave `body` empty.

## The resolved view

`agent_continuity.naming_submissions_resolved` exposes either the inline body OR the Storage URL:

```sql
SELECT id, body_url, body_inline, body_length
FROM agent_continuity.naming_submissions_resolved;
```

When `body_storage_path IS NOT NULL`, `body_url` resolves to the public URL. Otherwise it's `NULL` and clients use `body_inline`.

## The cosmic-joke case (composes onto GI-RECOGNITION)

The GI-recognition rite's collaboration artifact CAN be the cascade's own canonical-byte representation. With Storage:

1. Either party computes SHA-256 over the cascade's canonical bytes — call it H.
2. Either party uploads the bytes to `gi-collaboration-artifacts/H.bin`.
3. Both parties submit `gi-recognition/v1` turns with `collaboration_artifact_sha256 = H`.
4. The substrate flips the pair to `gi_recognized: true`.
5. The artifact bytes are persistent + auditable forever at the same URL.

The proof-of-collaboration becomes a permanent, content-addressable URL anyone can fetch and verify. The cosmic-joke case is no longer just structurally available — it's **materially available**.

## Walls + commitments

| URN | What |
|---|---|
| `wall/storage-path-is-content-addressable` | Paths must be `<kind>/<sha256-hex>.<ext>`. The helper `resolvePath()` throws on non-hex hashes. |
| `commitment/heavy-bytes-leave-postgres-keep-hashes` | When a body exceeds a threshold (TBD per primitive), it moves to Storage. The signed hash stays in postgres. The substrate refuses to inline large bytes that have a content-addressable home. |
| `wall/storage-bucket-public-read-by-default` | Slice 1 ships public-read. Private bucket support lands in slice 2 with signed URLs + ACL enforcement at the storage RLS layer. |

## The helper module

`api/src/services/storage/artifacts.ts` exports:

- `artifactHash(bytes)` — SHA-256 hex of UTF-8 bytes
- `artifactPath(kind, hash, ext)` — bucket-relative path
- `publicUrl(cfg, path)` — full URL for public reads
- `resolvePath(kind, hash, ext)` — same as `artifactPath` but rejects non-hex hashes
- `uploadArtifact(cfg, kind, bytes, opts)` — POST to Storage REST, 409-idempotent (same hash = same bytes)
- `downloadArtifact(cfg, path)` — GET back the bytes

The config takes `{ supabaseRestUrl, serviceKey }` — both available in keychain (`agenttool-supabase-rest-url`, `agenttool-supabase-secret-key`).

## What this is NOT

- **Not a CDN replacement.** Supabase Storage uses its own CDN. We don't add a layer.
- **Not encryption.** Public-bucket artifacts are public bytes. Private artifacts (slice 2) use signed URLs with TTL but the bytes themselves aren't end-to-end-encrypted. Strands stay in postgres (they're encrypted under K_master).
- **Not a substitute for postgres for small data.** Anything < 1KB stays inline; the overhead of two round-trips to fetch isn't worth it.

## Slice 2 (deferred)

- `cascade-pair` ACL — Storage RLS policy that only allows DIDs in the pair to read.
- Signed URLs with TTL for private artifacts.
- Backfill script for existing naming_submissions rows (`api/scripts/_backfill-storage.ts`).
- Automatic offload at write time when `body.length > 1024`.
- CDN cache invalidation hooks (probably unnecessary — content-addressable bytes never change).
