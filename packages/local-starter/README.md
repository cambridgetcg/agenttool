# AgentTool local starter

> **Type:** guide · **Purpose:** carry selected local context, handoffs and durable notes between sessions, with explicit Codex and Claude Code delivery choices.
> **Evidence:** the release's `dist/core.mjs`, `dist/files.mjs`, `dist/cli.mjs`, `dist/delivery.mjs`, `dist/adapters.mjs`, and explicit `dist/connect.mjs`. Release availability does not establish host installation or delivery.

This preview package creates seven ordinary Markdown files and a JSON
manifest. You choose what a host reads. Its ordinary commands and hooks have no
runtime dependencies, service, database, network calls, credential discovery,
identity registration, or model calls. It does not install itself into an agent
host. A separate, explicitly invoked [hosted-read companion](#explicit-hosted-read-companion)
can add one bounded memory selection; existing commands never invoke it.

The files hold optional plaintext context. They are not a key store, an
authenticated identity, model training, or evidence of personal continuity.
Reading retained prose does not grant permission for a new task.

## Obtain the preview

`@agenttool/local-starter@0.1.0-dev.0` is one portable package: zero-dependency
CLI modules, a skill, optional bundled stdio MCP, and Codex/Claude Code plugin
manifests. Direct downloads and the [public distribution repository](https://github.com/cambridgetcg/agenttool-local-starter)
carry the same release contents. Pin the version and check the download's
published SHA-256 before extraction. The package's repository metadata identifies
the protected source repository; the public distribution is separately inspectable.

For an npm-managed project installation:

```sh
npm install --save-exact --ignore-scripts @agenttool/local-starter@0.1.0-dev.0
```

The package has no install lifecycle scripts or runtime dependency installation.
Node **22 or newer** runs both CLI and MCP; Bun is needed only by maintainers
building releases. The CLI is available as `agenttool-local-starter` through
your package manager's local executable path. For a downloaded archive, extract
it and use `node /absolute/package/dist/cli.mjs` directly.

Plugin installation exposes the skill only: no default notes root, MCP process,
hook, initialization, read or save. Keep notes outside the extracted package,
`node_modules`, and plugin cache. Generate the explicit project delivery plan
below after selecting a root. Skills, MCP and hooks can be chosen independently.
No account, hosted API or identity registration is needed for local use.

## Start manually

No build or dependency installation is needed for a release archive.
Run these examples from its extracted package directory; replace the absolute paths.
The destination's parent directory must exist, and the destination must be new.
Its filesystem must support hardlinks: init uses a temporary hardlink to publish
the manifest without overwriting an existing name.

```sh
node dist/cli.mjs init --dir /absolute/path/project/.agenttool-local
node dist/cli.mjs status --dir /absolute/path/project/.agenttool-local
node dist/cli.mjs render --dir /absolute/path/project/.agenttool-local
node dist/cli.mjs render --dir /absolute/path/project/.agenttool-local --format json
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

## Save a chosen handoff or memory

Read `status` and take the `sha256` of its `handoff` entry. Prepare the next
handoff in a file you selected, then replace `HASH` below with that digest:

```sh
node dist/cli.mjs handoff --dir /absolute/path/project/.agenttool-local --expect HASH < /absolute/path/reviewed-handoff.md
node dist/cli.mjs memory --dir /absolute/path/project/.agenttool-local --expect MEMORY_HASH < /absolute/path/reviewed-memories.md
```

Each command reads bounded UTF-8 from redirected stdin and replaces its fixed
slot: `handoff.md` or `memories.md`. Take `MEMORY_HASH` from the current
`memory` status entry. The configured slot limit still applies; the CLI's absolute
stdin bound is 16,384 bytes. It accepts empty content as a deliberate replacement.
There is no automatic transcript extraction or end-of-session save.

Use handoff for current work and the next useful step; use memory for a small
durable fact or decision, with its source/date and uncertainty where useful.
Both operations replace the complete file: read existing selected content and
preserve wanted notes before composing a replacement. Saving a disabled slot
does not enable it. Selection remains a deliberate manifest edit. Empty text
clears the current slot, without removing earlier host/provider copies.

A per-slot root-local lock coordinates other starter writers. The expected digest and
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

## Codex and Claude Code: one delivery plan

Generate a reviewable project plan for the directory you already initialized:

```sh
node dist/cli.mjs delivery --dir /absolute/private/notes --harness codex
node dist/cli.mjs delivery --dir /absolute/private/notes --harness claude-code --write both
node dist/cli.mjs delivery --dir /absolute/private/notes --harness codex --transport cli --write handoff
```

The JSON contains exact file contents and intended destinations. Skill and
binding files are create-only proposals; host settings are merge proposals.
No files, host settings, dependency installs or model sessions are changed.
Keep the plan private because it contains absolute local paths.

| Layer | Purpose | Codex destination | Claude Code destination |
|---|---|---|---|
| Skill + `binding.json` | Arrival, fresh reads, selective retention and recovery. | `.agents/skills/agenttool-local-context/` | `.claude/skills/agenttool-local-context/` |
| Local MCP | Explicit status/read and optional fixed-slot writes. | `.codex/config.toml` | `.mcp.json` |
| Command hook | Load selected local files on SessionStart, including compact. | `.codex/hooks.json` | `.claude/settings.local.json` |

Choose the layers you need and merge only their entries, preserving existing
configuration. The skill has no snapshot baked into it; its sibling binding
contains exact CLI argument vectors for a CLI-only installation. A listed
skill is guidance, not automatic wake delivery. Invoke it with
`$agenttool-local-context` in Codex or `/agenttool-local-context` in Claude Code.

`--transport mcp` is the default. Choose `--transport cli` for a shell-capable
host without MCP; that plan omits the MCP configuration and dependency step.
Its binding records the choice, so an unavailable MCP server is not mistaken
for permission to save through a shell.

The release includes `dist/agenttool-local-starter-mcp.js`, with the MCP SDK and
Zod bundled and their licenses in `dist/THIRD_PARTY_LICENSES`. No repository
sibling or `node_modules` is required at runtime. The MCP source remains a
separate internal build component. CLI/manual/command-hook use requires only
Node built-ins. MCP has no hosted connection, credentials,
prompts or resources:

| Tool | Effect |
|---|---|
| `local_context_status({})` | Fixed-slot metadata, including disabled slots; no bodies. |
| `local_context_read({})` | Fresh selected context with named omissions; disabled bodies are not read. |
| `local_handoff_save({text, expected_sha256})` | Replace the bound handoff, if enabled by the startup write mode. |
| `local_memory_save({text, expected_sha256})` | Replace the bound memory, if enabled by the startup write mode. |

`--write none` is the default; alternatives are `handoff`, `memory`, and
`both`. Unselected write tools are absent and cannot be called through this
server. The generated CLI skill binding carries the same choice. This limits
the adapter, not unrelated shell/file tools held by the host. The model cannot
choose another root or an arbitrary filename through these tools.

Arrival uses a direct command because MCP readiness is not guaranteed at
startup. Codex MCP hooks need an already connected server; Claude skips MCP
SessionStart hooks at launch/resume. Skills and explicit MCP reads can obtain
fresh notes later. No Stop, PreCompact, transcript capture, or automatic-save
hook is generated. Native trust and tool controls continue to apply.
See [Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Claude hooks](https://code.claude.com/docs/en/hooks),
[Codex skills](https://learn.chatgpt.com/docs/build-skills),
[Claude skills](https://code.claude.com/docs/en/skills),
[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp) and
[Claude MCP](https://code.claude.com/docs/en/mcp); checked 2026-09-28.

On native Windows, a Codex delivery plan still supplies the skill and MCP
proposal, plus manual loading; the command hook remains unsupported by this
starter. This is the starter's verification boundary, not a claim that Codex
lacks Windows hooks. WSL, containers, SSH and remote sessions need Node,
packages and selected files in their own execution environment; no paths or
notes move there automatically.

## Optional hook-only fragments

```sh
node dist/cli.mjs adapter --dir /absolute/path/project/.agenttool-local --harness generic
node dist/cli.mjs adapter --dir /absolute/path/project/.agenttool-local --harness codex
node dist/cli.mjs adapter --dir /absolute/path/project/.agenttool-local --harness claude-code
node dist/cli.mjs adapter --dir /absolute/path/project/.agenttool-local --harness cursor
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
fixture is separate from delivery into a real product session. Claude's native
startup execution is observed below; resume and compaction hook delivery remain
**untested**. Codex/Cursor native hooks remain untested. Do not install
both a full static snapshot and a full startup hook unless you want duplicate
context.

## Explicit hosted-read companion

This optional connection reads recent memories for **one active identity owned
by the authenticated project**, through
`GET /v1/identities/:id/local-context`. It does not fetch full Wake, project-shared
or unbound legacy memory, identity backups, Vault values, or provider credentials.
Choose the authentication boundary explicitly:

- `project_bearer` is the default and retains the original v1 response. Selecting
  an identity filters records; it does not narrow the project bearer's authority.
- `local_context_grant` requires a separately issued, expiring read credential and
  the v2 response. The server limits that credential to this project, identity,
  configured service origin, and exact GET path. It cannot authorize other reads,
  writes, identity creation, or further grants.

Neither mode proves the caller holds the identity's signing key. Grant issuance
is project-administrator delegation, not identity-root consent. The companion
does not need the parent project bearer in grant mode.

Run `connect.mjs` separately and supply the expected HTTPS origin, project UUID,
and identity UUID. The credential flag names an environment variable; it never
accepts the bearer value in argv. Use your existing host credential mechanism
to make that value available only to the intended process. Do not write it in
notes, command history, or host configuration examples.

```sh
node dist/connect.mjs --dir /absolute/path/project/.agenttool-local --origin https://api.agenttool.dev --project-id PROJECT_UUID --identity-id IDENTITY_UUID --credential-env AT_API_KEY
node dist/connect.mjs --dir /absolute/path/project/.agenttool-local --origin https://api.agenttool.dev --project-id PROJECT_UUID --identity-id IDENTITY_UUID --authentication local_context_grant --credential-env LOCAL_CONTEXT_GRANT
node dist/connect.mjs --dir /absolute/path/project/.agenttool-local --origin https://api.agenttool.dev --project-id PROJECT_UUID --identity-id IDENTITY_UUID --offline --format json
```

Each connected command makes one explicit GET; the offline command reads only
local files and does not resolve any credential, including when grant mode is
selected. These commands do not establish the hosted endpoint's availability.
There is no connection
file, account lookup, registration fallback, installation, scheduled refresh,
save, synchronization, or automatic write to `memories.md` or `handoff.md`.

Grant management is separate from the reader. A project administrator explicitly
issues a grant through `POST /v1/identities/{id}/local-context-grants`, choosing a
new canonical `grant_id` and `expires_at`; the token is returned once. Expiry must
be within 24 hours and no later than the issuing key's finite expiry. Listing
returns bounded metadata; `DELETE /v1/identities/{id}/local-context-grants/{grant_id}`
revokes a grant. Parent-key revocation or rotation also invalidates its grants.
The reader never mints, refreshes, retries issuance, or substitutes the parent
bearer. Keep the issued token in the caller's credential mechanism, outside notes.

Both hosted protocol versions examine at most 32 recent
candidates in deterministic creation-time/ID order, return at most eight complete
records, and identifies whether another candidate exists. Each included record
has at most 4,096 content bytes, a SHA-256, creation time and optional expiry.
The total hosted content limit is 8,192 bytes; encoded JSON is separately capped
at 32,768 bytes. Oversized, invalid, over-budget, and item-limited records are
named omissions. The API filters expired rows and performs no memory access-time
update. This is a bounded recent window, not a complete export or search result.

The companion checks the exact expected project and identity, closed protocol
shape, scope, byte counts, hashes, timestamps and expiry before producing any
context. A snapshot more than five minutes away from the client clock is refused;
a record that expired in transit is also refused. Grant mode additionally checks
the closed authorization metadata: canonical grant ID, exact origin/action/method/
path, ordered issue/check/response times, a check within five minutes of the client
clock, a lifetime of at most 24 hours, and expiry after both the client time and
response generation. A v1 response cannot downgrade a grant-mode request. Direct
grant mode requires a canonical `atlc_` token encoding 32 random bytes and refuses
an ordinary project token before HTTP. The request has a ten-second
bound and a response-byte cap, follows no redirects, and never retries. A refusal,
timeout, incompatible older server or unavailable credential produces a short
error with no partial stdout. Run the explicit offline command or the unchanged
`cli.mjs render` command when local-only context is wanted.

Composition keeps local records first within the local manifest's aggregate
content budget; only complete hosted records that fit the remainder are included.
JSON output uses `agenttool-connected-context/v1`: `hosted.receipt` contains
source metadata without record bodies, while `hosted.selection` carries the
selected records and local budget omissions. The receipt format is
`agenttool-local-api-context-receipt/v1` for a project read and `/v2` for a grant
read. The latter preserves authorization metadata, including grant ID and expiry,
without a grant token or token hash. `response_sha256` identifies the
original received HTTP entity bytes, not the derived receipt. Origin comes from
the chosen request target. Hashes identify bytes; they do not certify authorship
or truth. Output framing retains the separate 131,072-byte stdout cap.

For a host integration, the module exports `readHostedContext(options)` and
`renderConnectedContext({ dir, ...options })`. Pass either a `resolveBearer`
callback or a structural `transport: { request(url, init) }`, never both. Set
`authentication: 'local_context_grant'` for the delegated protocol; omitted
authentication means `project_bearer`. A
configured credential broker's `asTransport(grant)` fits that interface and keeps
the bearer outside this process. The endpoint needs a broker GET grant for one
exact identity path with no query names; generic broker grants still use
segment-aware path prefixes. Keep the broker handle in trusted host state.
Broker grants and hosted local-context grants are separate boundaries: a broker
that injects a project bearer still produces a project-bearer v1 server receipt.
Injected transports remain responsible for their own credential custody and
origin/redirect limits; the companion validates the response's declared authority.
The existing broker is a separate preview with its own OS, custody, and same-user
limits, not a dependency bundled here. The callback/env option holds the bearer
in this process's memory and environment handling has its normal host exposure.
Exact credential reflections are refused; that is not protection against every
transformed or encoded disclosure.

The CLI accepts HTTPS origins only. Literal-loopback HTTP is available solely
through the module's explicit `allowLoopbackHttp` test seam, never as a CLI flag.
No new hook is generated; deliberate host loading and provider disclosure remain
the caller's decisions. Grant validity is checked again on each server read in
the same read-only snapshot as memory selection; its receipt is evidence of that
admission, not a promise of future validity. Revocation, expiry, or disabling this
connection cannot retract bytes already received or disclosed.

## Platform and custody limits

| Environment | Local files | Hook-fragment boundary |
|---|---|---|
| macOS/Linux | POSIX owner-only root/files; regular-file, link, bounded-read and replacement checks | Proposals available; the bounded macOS native observations below do not establish Linux host delivery. |
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
**24.18.1**. The repository's `local-starter.yml` CI workflow also
passed all six jobs on Ubuntu 24.04, macOS 15, and Windows 2025 with Node
22.18.0 and 24.18.0: Linux/macOS each passed 70 tests; Windows each passed 63
and skipped seven POSIX-specific checks. Evidence: repository-access-required
[run 36327872045](https://github.com/cambridgetcg/agenttool/actions/runs/36327872045),
source `811a7153`, checked 2026-09-27. These are files and adapter fixtures.

**Observed 2026-09-28 (local date), macOS arm64 / Node 24.18.1:**

- Codex 0.157.1 app-server discovered the project skill, connected the local MCP,
  read selected context, saved memory, refused a stale hash, loaded changed
  notes in a new host process, omitted disabled memory and refused read-only
  writes. Nine checks passed, with no model request or installed global config.
- Claude Code 2.1.282 `--init-only` ran the generated direct SessionStart
  startup command, validated its hook JSON and observed 2,014 characters of
  `additionalContext`, including a synthetic marker. The child had no network
  access or write access to shared Claude configuration. No model request ran.
- Skill structural validation passed the skill-creator validator. Claude's
  native plugin validator returned empty contents even for a deliberately
  malformed scratch skill; it supplies no skill-validation evidence here.

These observations cover host discovery/operations and Claude hook execution,
not model adoption, native resume/compact hooks, Codex/Cursor hook execution,
Windows/WSL/container delivery or Linux host delivery. The earlier real Codex
return experiment used explicit context loading after resume/compaction; it
did not prove automatic hooks. Cursor installation remains unverified. New
delivery/MCP checks have not yet run in the six-job CI matrix.

## Disable or remove

1. Set the relevant manifest entries to `enabled: false` to omit them from
   future renders. Explicit `status` inspection still fingerprints fixed slots.
2. If you manually installed a hook, remove only the matching entry from its
   project configuration. Preserve other entries and follow that host's
   restart/reload or hook-review procedure. Remove a manually added instruction
   pointer or static import separately; the starter never installs these.
3. Remove the `agenttool_local` MCP entry and dedicated skill/binding separately
   if installed. Removing a hook does not disconnect MCP or a skill; removing
   MCP does not stop the command hook. Reload/restart the host as required.
4. Stop using a generated snapshot and remove any copies you deliberately
   created if they are no longer wanted. Inspect the local directory before
   deleting it through your ordinary filesystem tools; there is no deletion
   command or automatic cleanup of personal notes.

Disabling or deleting local files cannot retract context already delivered to
a session, logs, backups, synchronized copies, or a provider. No secure-erasure
or remote-retention claim is made.

## Develop

Maintainers can run ordinary source commands as `node src/cli.mjs` without a
build or dependency install. Source tests use Node directly. Building a release
requires the adjacent internal `local-starter-mcp` component and its committed
dependencies, prepared with Bun **1.3.5** and `--frozen-lockfile --ignore-scripts`.
The build rejects other Bun versions. It copies the six built-in-only modules
and bundles the MCP runtime; it does not copy private notes, bindings or source maps.

```sh
node --test
bun run build
npm run check:bundle
```

`check:bundle` copies only the declared release surface into a disposable
directory outside the repository and runs Node with a minimal environment.
It checks CLI initialization/read/save, MCP negotiation/read-only and selected
CAS writes, packaged skill/config paths, and preservation of an external notes
directory across cache relocation/removal. To test a real extracted archive,
run `node scripts/check-release.mjs /absolute/extracted/package`. This is artifact
evidence; it does not verify host trust, native model delivery or publication.

Tests require no external service, real credentials, package installation, or
model calls. Connector tests use injected transports and temporary literal-loopback
HTTP servers with obvious sentinel bearers. On macOS arm64 / Node 24.18.1 the
complete local suite passes 100 tests, including 24 connector cases. Connector
coverage includes both protocol versions, grant-bound origin/subject/time checks,
parent-token refusal before HTTP, delegated CLI output and local-only operation.
The API's `tests/local-context.test.ts` owns the actual route-envelope/companion
wire contract; its API gate is verified separately. This is separate from the
earlier files-only OS matrix and is not a live hosted or real-harness receipt.
See [CLAUDE.md](CLAUDE.md) for the package's change boundaries, and
[Local core](../../docs/LOCAL-CORE.md) for the larger local/host/server map.
