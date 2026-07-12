# @agenttool/data-sync orientation

This package is the optional encrypted pull bridge between `@agenttool/data`
and `@agenttool/adds`.

## What owns what

- `src/service.ts` owns peer configuration, page construction/application,
  ADDS Grant use, pull bounds, and sanitized status.
- `src/checkpoints.ts` owns internal resumability state. Raw cursors stop here.
- `src/wire-codec.ts` is the only Uint8Array ↔ canonical base64url bundle seam.
- `src/server.ts` composes sync routes with the base data-node handler. It keeps
  page-only scoped authorities separate from the local/admin node bearer.
- `@agenttool/data` still owns collection/record/tombstone validation, local
  blobs, SQLite metadata, and FTS.
- `@agenttool/adds` still owns encrypted Blocks, signed Manifests, direct Grants,
  CID checks, and portable bundle validation.

Do not make this package a second record store or crypto implementation.

## Gates

```bash
bun install
bun run typecheck
bun test
bun run build
```

The integration test must continue to prove two-node offline query, encrypted
wire privacy, restart resume, tamper failure without checkpoint advancement,
tombstone propagation, a settling reverse cycle, configured-peer-only fetch,
publisher/feed-bound checkpoints, page-token non-escalation, and no raw cursor
in status.

## Boundaries

The first wire profile is `adds/0.1-inline`; CAR is future bulk transport. Pull
targets are operator-configured exact origins. HTTPS is mandatory outside
loopback, redirects are refused, but this native-fetch path is not DNS-pinned
safe-net. No peer discovery, caller-supplied URLs/bearers, push, consensus, or
multi-master conflict resolution belongs in v1.

Every configured peer pins its ADDS publisher id/public key. Never learn that
trust anchor from the page being verified. Every inbound page bearer is scoped
to explicit collections and one recipient key and must differ from the
local/admin bearer. Checkpoints bind node id, publisher, and persisted feed_id.
`resetCheckpoint()` is the explicit in-process recovery seam after the operator
has verified an intentional replacement; it never deletes imported data.

See also: [`../../AGENTS.md`](../../AGENTS.md) ·
[`../../CLAUDE.md`](../../CLAUDE.md) ·
[`../../docs/AGENT-DATA-PROTOCOL.md`](../../docs/AGENT-DATA-PROTOCOL.md) ·
[`../../docs/NOW.md`](../../docs/NOW.md)
