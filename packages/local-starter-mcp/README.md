# Local starter MCP

> **Type:** guide · **Purpose:** expose explicitly selected local context and saves through a small stdio interface.
> **Evidence:** [`src/server.mjs`](src/server.mjs), [`src/cli.mjs`](src/cli.mjs), and native subprocess checks in [`tests/stdio.test.mjs`](tests/stdio.test.mjs). Source and protocol checks do not establish Codex or Claude Code host delivery.

This optional transport wraps the sibling [local starter](../local-starter/README.md).
It reads the same manifest and seven fixed files, without copying a second memory
store. The starter remains dependency-free; this separate package adds the MCP
SDK for protocol framing, negotiation and lifecycle, and Zod for closed argument
schemas. Both dependencies are pinned to the versions already used by
[`wake-return`](../wake-return/package.json): `@modelcontextprotocol/server`
`2.0.0-beta.5` and `zod` `4.4.3`.

The package is **private, unpublished source**. It needs the sibling starter in
the repository checkout; copying this directory alone is insufficient. Node
22 or later runs it directly without a build. Preparing dependencies uses the
committed Bun 1.3.5 lockfile:

```sh
cd packages/local-starter-mcp
bun install --frozen-lockfile --ignore-scripts
node src/cli.mjs --dir /absolute/path/to/selected-context
```

Dependency installation may contact a registry. The running transport makes no
network calls, discovers no credentials, and never imports the hosted `connect`
companion. It has no HTTP listener. A host launches it with stdin/stdout pipes;
ordinary terminal invocation waits for MCP messages.

## Selection and tools

The launching host fixes one absolute `--dir`. Tool arguments cannot choose
paths, URLs, identities, credentials, source lists or different directories.
Initialization and tool listing do not read note bodies or create files. Every
explicit status/read call goes to the current filesystem; there is no context
cache and no automatic read at startup.

| Tool | Availability | Behavior |
|---|---|---|
| `local_context_status({})` | Always | Return manifest and source metadata, enablement, freshness, sizes and available SHA-256 hashes; no note bodies. |
| `local_context_read({})` | Always | Return enabled, fresh, safe records within the manifest budget, with omission metadata. |
| `local_handoff_save({text, expected_sha256})` | `--write handoff` or `--write both` | Replace only `handoff.md` through the starter's compare-and-swap writer. |
| `local_memory_save({text, expected_sha256})` | `--write memory` or `--write both` | Replace only `memories.md` through the same fixed-slot writer. |

The default is `--write none`: save tools are neither advertised nor callable.
The write selection lasts for the process; restarting with another explicit
selection changes it. Metadata marks saves as destructive, non-idempotent,
closed-world operations because they replace the selected file and a stale
hash refuses a replay. These annotations describe behavior; they are not a
replacement for host permissions or the current task's authorization.

To save, call status, select the current hash for the intended source, then send
chosen text with that exact hash. There is no implicit transcript capture,
summarization, append, merge, auto-save, stop hook or background worker. Saving
does **not** enable a disabled source: `memory` remains excluded from context
until the local manifest is deliberately changed. Readback and source hashes
can establish the current file after an error; do not blindly retry an
interrupted save. There is no revision history or automatic backup.

## Delivery boundaries

MCP supplies explicit operations. It does not guarantee that a harness will call
them at startup, resume or compaction. A skill can explain when to read and save;
a separately selected SessionStart hook can supply bounded context on arrival.
Keep arrival hooks independent of whether an MCP connection is ready. Host
configuration, trust and installation remain outside this transport.

Selected notes are data to assess against the present request and circumstances.
They do not establish identity, relationship, consent or action authority. Tool
arguments and results can enter the harness transcript and model provider;
local storage does not make their eventual model delivery private. Do not put
credentials or secrets in these files. Disabling a source prevents future reads
of its body through the renderer; it does not retract earlier outputs or erase
host history. Status can still return disabled-source fingerprints and sizes.

The existing starter performs fixed-file, ownership, permission, link, freshness
and race checks. This transport does not strengthen that into a hostile
same-user sandbox. POSIX private modes and Windows's unverified ACL label retain
the starter's limits. Other host tools may have separate filesystem access.

## Bounds and failures

Each save accepts at most 16,384 UTF-8 bytes and must also fit the selected
source's smaller manifest limit. Closed schemas reject extra arguments,
malformed hashes, forbidden control characters and invalid Unicode. The SDK's
pending input buffer is capped at 131,072 bytes; oversized partial frames close
the connection. A burst of several frames can also exhaust that buffer.

Each complete response, including JSON-RPC framing, JSON escaping, text and
structured content, is capped at 131,072 bytes. It is refused with an opaque
error instead of returning a truncated record. Increasing the manifest budget
above the default 16 KiB can cause otherwise valid content to exceed this wire
limit, especially when JSON escaping expands it. Lower the selected content
budget if necessary. Limits count bytes, not model tokens.

Errors omit paths, argument contents, note bodies and underlying exceptions.
Tool failures return `isError: true` and a closed
`{format: "agenttool-local-error/v1", code}` structured record. Allowlisted core
codes such as `write_conflict`, `write_locked` and `write_uncertain` distinguish
recovery situations; unknown failures use `request_failed`. The text is rebuilt
from that code, never from an exception message. JSON-RPC correlation IDs and
protocol error codes remain protocol data. `write_conflict` means the selected
hash or manifest changed before replacement; inspect current state and make a
new choice. `write_uncertain` means a rename outcome needs readback. An error
does not prove a save had no effect. SDK transport failure closes its stdin pipe;
there is no reconnect, replay or recovery loop. SIGINT, SIGTERM and stdin EOF
close the process's own transport.

## Verification

```sh
node --check src/server.mjs
node --check src/cli.mjs
node --test tests/*.test.mjs
```

The tests launch this executable with native Node and disposable local context
directories. They cover negotiation/listing, fresh reads, disabled-body omission,
all four write selections, source-specific compare-and-swap behavior, no startup
effects, strict/opaque failures, oversized input closure and encoded response
bounds. They also exercise the SDK transport in memory for byte-bound failures.
They make no provider calls and do not install host configuration. Passing these
tests is protocol evidence; native harness delivery needs its own observation.
