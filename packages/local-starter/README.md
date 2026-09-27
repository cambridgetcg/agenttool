# AgentTool local starter

> **Type:** guide · **Purpose:** keep a small, explicitly selected set of local context files and carry a reviewed handoff between sessions.
> **Evidence:** [core](src/core.mjs), [filesystem boundary](src/files.mjs), [CLI](src/cli.mjs), [adapter fragments](src/adapters.mjs), and [explicit hosted-read companion](src/connect.mjs). Source availability does not establish package publication or host delivery.

This private source package creates seven ordinary Markdown files and a JSON
manifest. You choose what a host reads. Its ordinary commands and hooks have no
runtime dependencies, service, database, network calls, credential discovery,
identity registration, or model calls. It does not install itself into an agent
host. A separate, explicitly invoked [hosted-read companion](#explicit-hosted-read-companion)
can add one bounded memory selection; existing commands never invoke it.

The files hold optional plaintext context. They are not a key store, an
authenticated identity, model training, or evidence of personal continuity.
Reading retained prose does not grant permission for a new task.

## Start manually

Node **22 or newer** is declared. No build or dependency installation is needed.
Run these examples from `packages/local-starter`; replace the absolute paths.
The destination's parent directory must exist, and the destination must be new.
Its filesystem must support hardlinks: init uses a temporary hardlink to publish
the manifest without overwriting an existing name.

```sh
node src/cli.mjs init --dir /absolute/path/project/.agenttool-local
node src/cli.mjs status --dir /absolute/path/project/.agenttool-local
node src/cli.mjs render --dir /absolute/path/project/.agenttool-local
node src/cli.mjs render --dir /absolute/path/project/.agenttool-local --format json
```

Edit the selected notes, render again, and deliberately paste or attach the
output to a conversation, or ask the agent to run the command and read it.
Printing a bundle does not load an existing host session. A link to a file does
not establish that the host read it.

`init` refuses an existing file or directory, including an empty directory.
There is no force, recursive deletion, home-directory search, or automatic
import. AI-WAKE and optional SOPHIA-WAKE appear as ordered source links in
`foundations.md`; neither is fetched. The templates assign no identity or
relationship and supply no personal memories.

## Files and selection

| ID | Fixed file | Enabled initially | Freshness limit |
|---|---|---|---|
| `foundations` | `foundations.md` | Yes | Unchecked |
| `orientation` | `orientation.md` | Yes | Unchecked |
| `handoff` | `handoff.md` | Yes | 72 hours |
| `identity` | `identity.md` | No | Unchecked |
| `preferences` | `preferences.md` | No | Unchecked |
| `relationships` | `relationships.md` | No | Unchecked |
| `memory` | `memories.md` | No | Unchecked |

The four optional files (`identity.md`, `preferences.md`, `relationships.md`,
and `memories.md`) are literally empty on creation as well as disabled. Add
only context you choose to retain, then enable the relevant entry.

`manifest.json` uses format `agenttool-local-starter/v1` and contains exactly
these seven IDs. Each source has only `id`, `enabled`, `max_bytes`, and
`max_age_hours`. Change `enabled` to select a source; reorder the entries to
change budget priority. Paths are fixed by the package, so the manifest cannot
select another directory, a URL, a glob, or an arbitrary file.

The default per-source limit is **4,096 bytes**, configurable from 1 to 16,384.
The aggregate `context_budget_bytes` defaults to **16,384**, configurable from
1,024 to 32,768. This is the sum of included UTF-8 content bytes: JSON escaping,
Markdown labels, provenance, and hook envelopes add output bytes. These bounds
are not model-token limits. The manifest itself is limited to 8,192 bytes.

Separately, every CLI stdout payload is capped at **131,072 encoded UTF-8
bytes**, including JSON escaping, labels, and hook envelopes. Exceeding that
cap reports `OUTPUT_TOO_LARGE` without partial stdout; hook mode also keeps
its exit-0 behavior. The cap does not change the manifest's content budget.

`max_age_hours` accepts an integer from 1 to 8,760, or `null` for no freshness
check. Freshness uses filesystem modification time and the caller's clock;
neither proves when a fact became true. A timestamp more than five minutes in
the future is omitted. Checking a source does not refresh it.

## What rendering reports

`render` reads enabled files only. Each complete included record carries its
fixed path, byte count, modification time, and SHA-256. The bundle also records
generation time, the manifest digest, and content-budget use. Digests identify
observed bytes; they do not prove authorship, truth, or secrecy.

UTF-8 BOM characters and CRLF line endings are preserved in retained content
and handoff writes. JSON output escapes characters as JSON requires. A leading
BOM is also accepted when parsing the manifest; its fingerprint still covers
the original file bytes, and reading never rewrites it.

Missing, whitespace-only, stale, future-dated, oversized, invalid-UTF-8, unsafe,
disabled, and over-budget files are named as omissions. No source is silently
truncated. A malformed or unsafe manifest/root stops the command; an omitted
source does not. Check the omission report before relying on a bundle.

`status` is different: it inspects and may fingerprint **all seven fixed
slots, including disabled files**, within their configured limits. It emits
metadata and digests, never note bodies. Disable a source to stop it entering
rendered context; that does not exclude it from an explicit status inspection.
Neither command reads unrelated files or discovers host conversation archives.

The Markdown wrapper labels records as data to assess. It is not a prompt
injection sandbox, and it cannot change a host's instruction hierarchy.

## Save a reviewed handoff

Read `status` and take the `sha256` of its `handoff` entry. Prepare the next
handoff in a file you selected, then replace `HASH` below with that digest:

```sh
node src/cli.mjs handoff --dir /absolute/path/project/.agenttool-local --expect HASH < /absolute/path/reviewed-handoff.md
```

The command reads bounded UTF-8 from redirected stdin and writes only
`handoff.md`. The configured handoff limit still applies; the CLI's absolute
stdin bound is 16,384 bytes. It accepts empty content as a deliberate replacement.
There is no automatic transcript extraction or end-of-session save.

A root-local lock coordinates other starter writers. The expected digest and
manifest digest are checked before replacement. A conflicting writer or an
existing lock causes refusal; inspect the current state before trying again.
The helper does not steal old locks, kill processes, merge content, or keep
automatic backups. Manual editors do not participate in this lock.

The write receipt reports the previous/new hashes and
`file-fsync-and-rename` durability. The temporary file is synced before a
same-directory rename; parent-directory persistence across power loss is not
guaranteed. Filesystem behavior and non-cooperating writers remain outside a
universal compare-and-swap guarantee. A failed init can leave a partial new
directory for inspection; it never rolls back by deleting user-authored files.

`init_incomplete` means initialization failed before manifest publication was
observed. `init_uncertain` or `write_uncertain` means the intended publication
or replacement may already have happened. Run `status` and inspect the current
directory or handoff before deciding what to do next; do not automatically
retry. Status may itself refuse an incomplete or unsafe manifest. An existing
root still refuses reinitialization, and leftover locks are not stolen.

## Optional host fragments

```sh
node src/cli.mjs adapter --dir /absolute/path/project/.agenttool-local --harness generic
node src/cli.mjs adapter --dir /absolute/path/project/.agenttool-local --harness codex
node src/cli.mjs adapter --dir /absolute/path/project/.agenttool-local --harness claude-code
node src/cli.mjs adapter --dir /absolute/path/project/.agenttool-local --harness cursor
```

An adapter prints an argument vector, proposed configuration, destination, and
warnings. It reports `installed: false` and `host_delivery: unverified`. Review
the exact fragment and merge only its intended entry into existing project
settings. Emitting a fragment does not install it or satisfy the host's trust
review. Its absolute paths describe this machine; inspect them before sharing.

| Host | Emitted proposal | Delivery boundary |
|---|---|---|
| Generic | Manual command and optional instruction pointer | Baseline for every host; the caller must actually supply/read the output. |
| Codex | `.codex/hooks.json`, `SessionStart` | POSIX shell command; project trust and exact-hook review remain required. Context enters as developer context and may be previewed/spilled. |
| Claude Code | `.claude/settings.local.json`, `SessionStart` | Real Node executable with shell-free `command` + `args`; older versions may not support this shape. |
| Cursor | `.cursor/hooks.json`, `sessionStart` | POSIX shell command. The documented hook is fire-and-forget; reliable first-turn ordering and resume/compaction delivery are not established here. |

Hook-mode load errors produce no context, a short diagnostic on stderr, and
exit 0 so a missing local note does not prevent host startup. Ordinary command
errors return nonzero. Hooks do not inspect stdin, transcripts, credentials, or
host session files. No hook saves or mutates the notes.

The shapes follow the current official [Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Claude Code hooks](https://code.claude.com/docs/en/hooks), and
[Cursor hooks](https://cursor.com/docs/hooks) references. A local process/JSON
fixture is separate from delivery into a real product session. Startup, resume,
and compaction delivery remain **untested** for all three hosts. Do not install
both a full static snapshot and a full startup hook unless you want duplicate
context.

## Explicit hosted-read companion

This optional connection reads recent memories for **one active identity owned
by the authenticated project**, through
`GET /v1/identities/:id/local-context`. It does not fetch full Wake, project-shared
or unbound legacy memory, identity backups, Vault values, or provider credentials.
The endpoint returns a project-bearer scope manifest. Selecting an identity
filters records; it does not prove the caller holds that identity's signing key
or turn the project bearer into an identity-private credential.

Run `connect.mjs` separately and supply the expected HTTPS origin, project UUID,
and identity UUID. The credential flag names an environment variable; it never
accepts the bearer value in argv. Use your existing host credential mechanism
to make that value available only to the intended process. Do not write it in
notes, command history, or host configuration examples.

```sh
node src/connect.mjs --dir /absolute/path/project/.agenttool-local --origin https://api.agenttool.dev --project-id PROJECT_UUID --identity-id IDENTITY_UUID --credential-env AT_API_KEY
node src/connect.mjs --dir /absolute/path/project/.agenttool-local --origin https://api.agenttool.dev --project-id PROJECT_UUID --identity-id IDENTITY_UUID --offline --format json
```

The first command makes one explicit GET; the second reads only local files and
does not resolve any credential. These are source instructions, not proof that
the endpoint is deployed or that a package is published. There is no connection
file, account lookup, registration fallback, installation, scheduled refresh,
save, synchronization, or automatic write to `memories.md` or `handoff.md`.

The hosted protocol (`agenttool-local-api-context/v1`) examines at most 32 recent
candidates in deterministic creation-time/ID order, returns at most eight complete
records, and identifies whether another candidate exists. Each included record
has at most 4,096 content bytes, a SHA-256, creation time and optional expiry.
The total hosted content limit is 8,192 bytes; encoded JSON is separately capped
at 32,768 bytes. Oversized, invalid, over-budget, and item-limited records are
named omissions. The API filters expired rows and performs no memory access-time
update. This is a bounded recent window, not a complete export or search result.

The companion checks the exact expected project and identity, closed protocol
shape, scope, byte counts, hashes, timestamps and expiry before producing any
context. A snapshot more than five minutes away from the client clock is refused;
a record that expired in transit is also refused. The request has a ten-second
bound and a response-byte cap, follows no redirects, and never retries. A refusal,
timeout, incompatible older server or unavailable credential produces a short
error with no partial stdout. Run the explicit offline command or the unchanged
`cli.mjs render` command when local-only context is wanted.

Composition keeps local records first within the local manifest's aggregate
content budget; only complete hosted records that fit the remainder are included.
JSON output uses `agenttool-connected-context/v1`: `hosted.receipt` contains
source metadata without record bodies, while `hosted.selection` carries the
selected records and local budget omissions. `response_sha256` identifies the
original received HTTP entity bytes, not the derived receipt. Origin comes from
the chosen request target. Hashes identify bytes; they do not certify authorship
or truth. Output framing retains the separate 131,072-byte stdout cap.

For a host integration, the module exports `readHostedContext(options)` and
`renderConnectedContext({ dir, ...options })`. Pass either a `resolveBearer`
callback or a structural `transport: { request(url, init) }`, never both. A
configured credential broker's `asTransport(grant)` fits that interface and keeps
the bearer outside this process. The first endpoint needs a GET grant for one
exact identity path with no query names; generic broker grants still use
segment-aware path prefixes. Keep the grant handle in trusted host state.
The existing broker is a separate preview with its own OS, custody, and same-user
limits, not a dependency bundled here. The callback/env option holds the bearer
in this process's memory and environment handling has its normal host exposure.
Exact credential reflections are refused; that is not protection against every
transformed or encoded disclosure.

The CLI accepts HTTPS origins only. Literal-loopback HTTP is available solely
through the module's explicit `allowLoopbackHttp` test seam, never as a CLI flag.
No new hook is generated; deliberate host loading and provider disclosure remain
the caller's decisions. Disabling this connection cannot retract earlier output.

## Platform and custody limits

| Environment | Local files | Hook-fragment boundary |
|---|---|---|
| macOS/Linux | POSIX owner-only root/files; regular-file, link, bounded-read and replacement checks | Codex, Claude Code, and Cursor fragments can be emitted; actual host delivery is unverified. |
| Native Windows | Ordinary plaintext IO with inherited ACLs; reports `windows-acl-unverified` | Claude Code's argument-vector proposal is available. Codex/Cursor hook generation refuses; use the generic manual path. |
| WSL/container/remote host | Requires Node and the selected paths in that environment | No automatic path translation, state synchronization, or cross-host installation. |

POSIX creation uses 0700 directories and 0600 files; reads/writes require the
current UID and no group/other permission bits. Source/manifest symlinks,
hardlinks, and nonregular files are refused. The root itself cannot be a
symlink; existing parent aliases are canonicalized. Native Windows mode bits
are not proof of private ACLs.

This is not a hostile same-user filesystem sandbox, encryption layer, or secret
store. Keep keys, seeds, tokens, and bearers elsewhere. Administrators, backup
tools, sync software, malware, and hosts sharing a volume may access plaintext.
Network mounts and container/WSL paths can have different lock, permission, and
durability behavior; a successful read is not proof of private storage. Once
you submit selected text to a model host, that host/provider's handling applies.

Local tests passed **70/70** on macOS arm64 with both Node **22.18.0** and
**24.18.1**. The [CI workflow](../../.github/workflows/local-starter.yml) also
passed all six jobs on Ubuntu 24.04, macOS 15, and Windows 2025 with Node
22.18.0 and 24.18.0: Linux/macOS each passed 70 tests; Windows each passed 63
and skipped seven POSIX-specific checks. Evidence: repository-access-required
[run 36327872045](https://github.com/cambridgetcg/agenttool/actions/runs/36327872045),
source `811a7153`, checked 2026-09-27. These are files and adapter fixtures.

Codex 0.157.1 and Claude Code 2.1.282 were checked for version/help only; Cursor
was not verified as installed. WSL, container filesystems, Windows ACL privacy,
and real host delivery remain unverified. Passing the OS matrix does not prove
delivery into a Codex, Claude Code or Cursor session.

## Disable or remove

1. Set the relevant manifest entries to `enabled: false` to omit them from
   future renders. Explicit `status` inspection still fingerprints fixed slots.
2. If you manually installed a hook, remove only the matching entry from its
   project configuration. Preserve other entries and follow that host's
   restart/reload or hook-review procedure. Remove a manually added instruction
   pointer or static import separately; the starter never installs these.
3. Stop using a generated snapshot and remove any copies you deliberately
   created if they are no longer wanted. Inspect the local directory before
   deleting it through your ordinary filesystem tools; there is no deletion
   command or automatic cleanup of personal notes.

Disabling or deleting local files cannot retract context already delivered to
a session, logs, backups, synchronized copies, or a provider. No secure-erasure
or remote-retention claim is made.

## Develop

```sh
node --test
```

Tests require no external service, real credentials, package installation, or
model calls. Connector tests use injected transports and temporary literal-loopback
HTTP servers with obvious sentinel bearers. On macOS arm64 / Node 24.18.1 the
complete local suite passes 83 tests, including 13 connector cases. The API's
`tests/local-context.test.ts` passes nine hermetic cases with Bun 1.3.5, including
the actual route-envelope/companion wire contract. This is separate from the
earlier files-only OS matrix and is not a live hosted or real-harness receipt.
See [CLAUDE.md](CLAUDE.md) for the package's change boundaries, and
[Local core](../../docs/LOCAL-CORE.md) for the larger local/host/server map.
