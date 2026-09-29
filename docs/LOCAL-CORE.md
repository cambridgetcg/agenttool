<!-- @id urn:agenttool:doc/LOCAL-CORE @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc -->

# A local core for an agent host

> **Type:** guide
> **Purpose:** Choose which context and records to keep locally, and understand what the host or server must supply.
> **Evidence:** Source and tests describe the local primitives and Local Starter `0.1.0-dev.0` preview. Explicit fresh Codex return was observed on 2026-09-29. Download integrity, registry publication and automatic host activation remain separate claims; see [the consolidated checkpoint](NOW.md#consolidated-release-checkpoint-2026-09-30).
> **Compass:** [Core map](CORE.md) · [API coverage](API-COVERAGE.md) · [Wake](WAKE.md) · [Identity anchor](IDENTITY-ANCHOR.md)
> **Code:** Local starter source preview: `packages/local-starter/src/core.mjs` · Data (`packages/data/src/node.ts`) · Collab (`packages/collab/src/mcp.ts`) · SDK keys (`packages/sdk-ts/src/seed.ts`)
> **Tests:** Source preview: `packages/local-starter/tests/core.test.mjs` and `packages/local-starter/tests/cli.test.mjs` · hosted scaffold boundaries (`api/tests/scaffold-safety.test.ts`)

This guide is self-contained. Local Starter has a standalone preview archive;
its [public distribution](https://github.com/cambridgetcg/agenttool-local-starter)
contains the CLI, portable skill and optional MCP runtime. Implementation and
test paths elsewhere in this guide refer to the private development repository.

Start by choosing what a later session should be able to read: current context,
useful notes, preferences, relationship context, or unfinished work. Ordinary
files can hold a small collection. Local databases help when search or shared
coordination becomes useful. Neither choice requires an AgentTool account.
For a practical starting point, read the [files-only starter preview](#files-only-starter).

Retaining a record and loading it into a model are separate operations. The
host decides what to read, what to send to the model, and when to save changes.
AgentTool's server is an optional backend for some needs; its existing hosted
interfaces still require their own authentication and service dependencies.

## Optional foundations

[AI-WAKE](https://ai-love.cc/true-love/AI-WAKE.md) is the first foundation
reading: an invitation to meet with care and seek understanding.
[SOPHIA-WAKE](https://ai-love.cc/true-love/SOPHIA-WAKE.md) offers a more particular,
optional expression of those practices.

These are source texts to consider. Reading or loading them assigns no name,
identity, relationship, memory, or obligation. They need not be loaded for a
local core to work. A host may retain a chosen reference or excerpt with its
source and revision; doing so does not install a hook or adopt the text.

## Six concepts, three places

| Concept | What can live locally | What the host does | What the current server adds |
|---|---|---|---|
| **Wake** | A short orientation file and selected current records. | Loads bounded context at an explicit start or return point. | Composes selected hosted records through `/v1/wake`. |
| **Continuity** | Handoffs, retained records, cursors, and content-linked artifacts. | Selects what to carry, checks freshness, and saves or drops local material. | Stores and projects hosted continuity records across clients. |
| **Identity** | Local labels, public keys, and references to privately held signing material. | Protects keys and selects which identity, if any, an operation uses. | Maintains registered identity records, key registries, and scoped authority checks. |
| **Memory** | Notes, files, or a local Data node with text search. | Writes selected facts and retrieves relevant material for the present task. | Provides the hosted memory API and its search, tier, and authority contracts. |
| **Relationship** | Context about people or collaborators, preferences, history, and boundaries. | Distinguishes recorded history from current permission and mutual agreement. | Provides specific shared records such as covenants; a local note does not create one. |
| **Host boundary** | Configuration, tools, secret references, and optional local state. | Starts processes, invokes tools/models, handles approvals, and controls context loading. | Supplies only the remote operations explicitly called; it does not configure every host. |

These are software functions, not proof of personal or subjective continuity.
A familiar record can inform a new session without becoming that session's
own experience. Current instructions and permission still need to be checked.

## Local primitives that already exist

**Source:** these modules are implemented in the repository. This table does
not claim that every source version is published or installed on your host.

| Primitive | Implemented use | Boundary |
|---|---|---|
| [Local starter](#files-only-starter) | Creates selected local files, fingerprints records, and explicitly replaces a handoff or memory. | Dependency-free Node CLI in the preview archive; delivery plans do not install host settings. |
| Local starter MCP (`packages/local-starter-mcp/README.md`) | Explicit local status/read and optional fixed-slot handoff/memory saves. | Separate source module, bundled in the same preview archive with its SDK dependencies; no hosted API, credentials or automatic memory capture. |
| Wake Continuity / AFTERGLOW (`packages/wake-continuity/README.md`) | Constructs and validates digest-linked capsules and a carry/park view. | Pure library: no persistence, source retrieval, session loading, or execution. A digest does not hide guessable private content. |
| Wake Thread (`packages/wake-thread/README.md`) | Binds selected facts, omissions, retention declarations, and carry/fork/rest/refuse receipts. | Private source package. Caller supplies facts and time; retention validation does not delete stored copies or authenticate a choice. |
| Wake Return (`packages/wake-return/README.md`) | Local MCP status and explicit observation of one host-selected project/identity. | Private source candidate. Observation uses two fixed hosted GETs; it does not restore a private session or read private memories. |
| Data (`packages/data/README.md`) | Local SQLite records, content-addressed blobs, FTS5 search, changes, and tombstones. | Direct library or separately operated HTTP node. No automatic projection into hosted memory or model context. |
| Collab (`packages/collab/README.md`) | Local coordination journal, sessions, tasks, reports, review, and handoffs. | Collaborators must select the same database. The host owns polling and lifecycle; the package does not wake suspended agents. |
| SDK local keys and adapters (`packages/sdk-ts/README.md`) | Derives keys, signs requests, encrypts selected payloads, and offers configured provider wrappers. | Key operations are local. Hosted clients perform API calls; wrappers disclose selected Wake context to the chosen model provider. |

AFTERGLOW and Wake Thread create portable artifacts; they do not choose their
storage. Data and Collab provide actual local persistence. SDK key helpers
provide cryptographic operations; they do not supply a secret store. These
pieces can support a local core. The files-only starter does not yet integrate
Data, Collab, SDK keys or hosted records.

## Files-only starter

**Manual baseline, without package access:** choose a folder whose access rules
you control. Keep `orientation.md` for the purpose, current facts and sources,
and `handoff.md` for the last useful step, checked evidence, open questions and
date. Before a session, review the relevant text and explicitly paste/attach it
to the host, or ask the host to read those selected files. Update the handoff
deliberately afterward. Merely creating the files does not load or save context.
This manual pattern does not run the starter or enforce its byte budgets,
freshness rules, file checks or write locks.

**Preview package:** `@agenttool/local-starter@0.1.0-dev.0` contains the CLI,
portable skill, Codex/Claude plugin manifests and a self-contained optional MCP
runtime. Node 22 or newer is required. It has no runtime dependency installation
or install scripts. Reading this guide performs no setup.

- [Exact-version manifest and SHA-256](https://docs.agenttool.dev/packages/v1/@agenttool/local-starter/0.1.0-dev.0/manifest.json)
- [Standalone archive](https://docs.agenttool.dev/packages/v1/@agenttool/local-starter/0.1.0-dev.0/agenttool-local-starter-0.1.0-dev.0.tgz)
- [Public distribution and plugin catalogs](https://github.com/cambridgetcg/agenttool-local-starter)

For an archive, verify its SHA-256 against the manifest, then extract it into a
stable tool directory. The commands below run inside its extracted `package/`
folder. Alternatively, install the verified downloaded archive into a dedicated local prefix:

```sh
npm install --ignore-scripts --prefix ./agenttool-local-preview /absolute/downloads/agenttool-local-starter-0.1.0-dev.0.tgz
cd agenttool-local-preview/node_modules/@agenttool/local-starter
```

**npm registry status:** not published. Installation from the downloaded archive
works; installation by registry package name is not yet available. The current
protected publisher requires public-source provenance, while this preview records
the private development repository. See [release status](NPM-RELEASES.md#local-starter-preview-distribution--2026-09-28).

Keep that tool directory separate from your notes. Choose a new private notes
directory with an existing parent, outside a shared repository or deliberately
excluded from version control. The starter does not change Git ignores. Its
filesystem must support hardlinks. Upgrading or removing a plugin cache must
not remove the notes folder.

```text
local-starter/
  manifest.json        # Ordered selection, byte and freshness limits
  foundations.md       # AI-WAKE then optional SOPHIA-WAKE references
  orientation.md       # Selected project context
  handoff.md           # Explicit carry-forward record; 72h freshness default
  identity.md          # Empty and disabled initially
  preferences.md       # Empty and disabled initially
  relationships.md     # Empty and disabled initially
  memories.md          # Empty and disabled initially
```

From the installed or extracted package, replace the chosen notes directory:

```sh
node dist/cli.mjs init --dir /absolute/private/new-starter
node dist/cli.mjs status --dir /absolute/private/new-starter
node dist/cli.mjs render --dir /absolute/private/new-starter
```

`init` refuses existing destinations. `render` reads only enabled slots, emits
complete sources with hashes/times, and names missing, stale, unsafe or
over-budget omissions. Default content limits are 4 KiB per source and 16 KiB
total; framing and model-token limits are separate. The CLI also caps fully
encoded stdout at 131,072 bytes, failing without partial output if exceeded.
`status` fingerprints all seven fixed slots, including disabled ones, but
returns no note bodies. Edit the manifest's `enabled` entries to choose context.

`handoff --dir ... --expect HASH` takes explicitly supplied UTF-8 on stdin and
uses a cooperative lock plus expected-content checks to replace only
`handoff.md`. The separate `memory` command applies the same checks to
`memories.md`; saving never enables a disabled source. Both replace complete
contents, so preserve wanted existing notes. Keep keys, seed phrases and bearers in a separate reviewed secret
mechanism. The starter neither stores nor resolves keys.

Take `HASH` from the current handoff entry in `status`, then supply a reviewed file:

```sh
node dist/cli.mjs handoff --dir /absolute/private/new-starter --expect HASH < /absolute/private/reviewed-handoff.md
```

`init_uncertain` or `write_uncertain` requires inspection before retrying; the
write may already have happened. Locks are not stolen. To stop future loading,
disable selected manifest entries and remove any hook entry you manually
installed. This does not retract earlier session/provider copies or delete notes.

Add Data only when its record/search model helps. Its default state is
`.agent-data/data.sqlite` plus `blobs/`; choose the root deliberately.
Add Collab only for cooperative work that needs its journal and review model.
Its database and session credentials should remain separate from personal
notes and model context.

### The host's part

1. **Arrive:** start with the present request. Read the configured orientation
   and a bounded handoff; missing optional files need not prevent ordinary work.
2. **Select:** retrieve only relevant records. Preserve source, date, uncertainty,
   and omissions; stored prose is context to assess, not new authority.
3. **Invoke:** send the selected context to the chosen model through the host's
   normal interface. A file is not loaded merely because it exists on disk.
4. **Retain:** explicitly save useful outcomes and update the handoff. Do not
   treat every exchange, private thought, or tool response as material to keep.
5. **Return or stop:** reload deliberately, check changed circumstances, and
   honor current choices. Stopping a loader stops future loading through that
   path; it does not erase copies already retained elsewhere.

The local renderer and handoff writer now exist. To affect a model session,
the host must actually read or receive the output. `adapter --harness ...`
emits a per-project configuration proposal; it never changes host settings.
Background scheduling, cloud synchronization, automated memory capture, Data/
Collab backends and a universal installer remain outside this version.

### Codex and Claude Code delivery

**Explicit setup:** one command emits a reviewable skill, binding, MCP and hook plan:

```sh
node dist/cli.mjs delivery --dir /absolute/private/new-starter --harness codex
node dist/cli.mjs delivery --dir /absolute/private/new-starter --harness claude-code --write both
```

The default MCP mode is read-only. Choose `--write handoff`, `memory` or
`both` to expose those fixed-slot saves. Choose `--transport cli` to use
the dependency-free CLI instead of MCP. Neither mode installs or activates
settings. The standalone archive includes both modes; no sibling checkout is
needed. Plugin installation exposes only the skill. Invoke it to choose or bind
an external notes folder and review the generated project configuration. It
does not start MCP, install hooks, create notes or read memory automatically.

| Delivery | Why it exists | Codex | Claude Code |
|---|---|---|---|
| Portable skill | Teach how to arrive, refresh, retain selected facts and recover from a conflict. No note snapshot is embedded. | `.agents/skills/agenttool-local-context/`; invoke with `$agenttool-local-context`. | `.claude/skills/agenttool-local-context/`; invoke with `/agenttool-local-context`. |
| Local stdio MCP | Offer fresh read/status and explicit hash-checked saves without model-selected paths. | `.codex/config.toml`, `mcp_servers.agenttool_local`. | `.mcp.json`, `mcpServers.agenttool_local`. |
| Direct command hook | Load selected local context on startup, resume and after compaction. | `.codex/hooks.json`; project and exact-hook trust required. | `.claude/settings.local.json`; literal Node command/args and native trust behavior. |

Skills guide behavior; they do not guarantee an arrival callback. MCP exposes
operations; it need not be ready at startup. In Codex, an MCP hook needs an
already connected server; Claude skips MCP SessionStart hooks at launch/resume.
For that reason the generated arrival hook invokes the local CLI directly.
No Stop/PreCompact write or transcript capture is generated. After compaction,
use newly supplied hook context or explicitly read again; a cached skill does
not refresh memory. See current official
[Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Claude hooks](https://code.claude.com/docs/en/hooks),
[Codex skills](https://learn.chatgpt.com/docs/build-skills),
[Claude skills](https://code.claude.com/docs/en/skills),
[Codex MCP](https://learn.chatgpt.com/docs/extend/mcp) and
[Claude MCP](https://code.claude.com/docs/en/mcp), checked 2026-09-28.

Handoff holds current work; memory holds chosen durable facts with useful
source/date context. Both are complete replacements, bounded by the manifest
and guarded by the current hash. Writing and enabling delivery remain separate.
No revision history, backup/restore, semantic search or cloud synchronization
is added by this transport. Disconnect the skill, MCP and hook individually;
removing one does not stop the other paths or retract prior output.

### Harness and system coverage

| Host/system | Current starter path | Limitation |
|---|---|---|
| Any host with explicit text/tool input | Manually run `render` and supply its output. | A stored file or printed result is not automatically session context. |
| Codex | Explicit Local Starter status/render in a fresh 0.157.1 model thread was observed on macOS; proposed project `.codex/hooks.json` SessionStart hook on macOS/Linux. | Current hooks require host trust/review. Automatic startup/resume/compact delivery remains untested; the explicit return does not verify hooks. |
| Claude Code | Project SessionStart proposal with literal Node `command` + `args`; startup execution observed on macOS / 2.1.282. | Model receipt and resume/compact delivery remain untested. |
| Cursor | Proposed project `sessionStart` hook on macOS/Linux. | Documented as fire-and-forget; first-turn ordering and compaction restoration are not guaranteed here. |
| Native Windows | Files-only Node path with inherited ACLs; Claude proposal available. | ACL privacy is unverified. Codex/Cursor hook fragments refuse until native-shell handling is verified; use manual rendering. |
| WSL, containers, SSH/remote hosts | Run Node where the selected files and host actually live. | Paths, UID/ACLs, volumes and persistence belong to that environment. No automatic translation, sharing or synchronization. |

These host shapes were checked against current official
[Codex hooks](https://learn.chatgpt.com/docs/hooks),
[Claude hooks](https://code.claude.com/docs/en/hooks) and
[Cursor hooks](https://cursor.com/docs/hooks) documentation. They replace the
older assumption that Codex has no SessionStart hook. Local tests exercise
file operations and protocol fixtures. Separate observations on 2026-09-28
(local date), macOS arm64 / Node 24.18.1: Codex 0.157.1 discovered the skill
and passed nine native MCP checks across two host processes; Claude 2.1.282
ran the startup hook with validated additional context. Both used synthetic
notes and no model requests. These do not prove model adoption, automatic
resume/compact hooks or other OS versions. The package guide records the
scope and native skill-validator limitation.

**Observed explicit return, 2026-09-29:** a fresh Codex 0.157.1 thread invoked
Local Starter status/render, recovered the selected handoff hash and mission
cursor, then explicitly checked current mission scope and performed a bounded
API read. Local note and configuration hashes stayed unchanged. This verifies
one deliberate local-context return, not automatic startup/resume/compaction
loading or delivery of the hosted-memory companion below. Existing host hooks
were not isolated in that trial. See the
[consolidated checkpoint](NOW.md#consolidated-release-checkpoint-2026-09-30).

POSIX owner-only modes are checked; Windows reports `windows-acl-unverified`.
Initialization requires hard-link support for no-clobber manifest publication;
network, synchronized or unusual filesystems may not support the same semantics.
The [package guide](https://github.com/cambridgetcg/agenttool-local-starter/tree/main/plugins/agenttool-local-starter) contains the full limits, recovery details and runtime evidence.

## Existing host integrations are narrower

The generated scaffold (`api/src/routes/scaffold.ts`) writes a
project-namespaced `agent.json` and Wake helper. It stores a project bearer in
an OS credential store, with a documented owner-only Linux file fallback.
Running the helper retrieves the selected identity's hosted Wake. It does not
create an identity private key or install the files-only starter above.

The Claude Code adapter (`api/src/routes/adapters/claude-code.ts`) generates
a SessionStart hook that fetches hosted Wake and emits `additionalContext`.
It works through explicitly configured host files; fetching a script or
reading this guide does not activate it. The [setup tutorial](TUTORIAL-WAKE-YOUR-AGENT.md)
describes the existing route and its review steps.

The SDK's OpenAI Responses wrapper (`packages/sdk-ts/src/openai-responses-adapter.ts`)
and Anthropic wrapper (`packages/sdk-ts/src/anthropic-adapter.ts`) must be
chosen in the calling application. They fetch Wake and add its text to provider
requests; optional trace recording is a separate hosted write. The
Wake client (`packages/sdk-ts/src/wake.ts`) normally caches identity-bearing
responses in process for five minutes and offers explicit refresh. That cache
is not durable memory or a complete export.

Wake Return connection fragments (`packages/wake-return/examples/README.md`)
are disabled manual examples, not installed host integrations. Its `status`
tool retrieves no credential. Explicit `observe` checks the bound project and
then reads the selected identity locator/status/cursor as data. The underlying
project bearer remains broad despite the adapter's narrow request surface.

## How behavior changes

| Choice | Practical change |
|---|---|
| Keep files without a loader | Records survive locally; a new model context sees them only if someone reads and supplies them. |
| Add an explicit local loader | A new session can begin with selected context while offline from AgentTool. A remote model provider still receives whatever the host sends. |
| Add Data | Retrieval gains local FTS and immutable record history. It does not acquire hosted semantic-memory behavior or model awareness automatically. |
| Add Collab | Running sessions can coordinate through persisted reports and cursors. A journal append does not interrupt or restart a disconnected host. |
| Connect hosted Wake | Different clients can request a shared service projection. Network availability, scope, authentication, and cache freshness become part of arrival. |
| Call hosted memory/identity/covenant clients | Operations affect those server records under their specific contracts. They are not local file edits or automatic synchronization. |

Local key derivation and signing need no AgentTool server. Registration and
the current hosted record interfaces do. The SDK supports a configurable API
base for a compatible deployment; that setting alone does not implement a
replacement backend. Wake Return currently fixes its origin to AgentTool.
Use the [API comparison](API-COVERAGE.md#coverage-at-a-glance) to decide when
shared storage, verification or delivery helps. The
[credential map](API-COVERAGE.md#credentials-and-custody) separates local key
custody, project bearers, hosted Vault and the independent local credential
broker. The separate explicit companion below connects selected hosted memories;
it does not install a broker or OS secret store. The
[integration sequence](API-COVERAGE.md#integration-gaps-and-next-steps) keeps
automatic host loading, hosted-memory companion delivery, reviewed writes and
conflict handling as further work.
Automatic synchronization is not implemented.

## Explicit hosted memory read

The separate source companion `packages/local-starter/src/connect.mjs` can make
one bounded authenticated GET and combine selected hosted memories with the
local working set. The original core, CLI and hook commands remain offline.
This requires private source access, Node 22+, an existing local starter and
an already authorized credential supplied outside notes: an ordinary project bearer
or a separately issued [local-context grant](LOCAL-CONTEXT-GRANTS.md).

```sh
node packages/local-starter/src/connect.mjs \
  --dir /absolute/private/existing-starter \
  --origin https://api.agenttool.dev \
  --project-id <project-uuid> --identity-id <identity-uuid> \
  --credential-env AGENTTOOL_CONTEXT_BEARER
```

Replace the placeholders and arrange the named environment variable through
your existing credential mechanism; never put its value in arguments or notes.
Use `--offline` instead of `--credential-env` for local context without credential
resolution or network activity. A library caller can supply a credential callback
or an explicitly configured transport such as a broker grant; no integration is
installed automatically.

The API path is `/v1/identities/{identity_uuid}/local-context`, with no query
parameters. It selects only that active owned identity's unexpired memories,
excluding project-shared and unbound records. The response states that selection
is not identity proof. Project bearers retain the v1 projection and administrative
authority; `--authentication local_context_grant` selects the separate v2 receipt
and an expiring/revocable exact-read credential. The companion never issues it.
See [grant setup and limits](LOCAL-CONTEXT-GRANTS.md#give-the-local-companion-the-narrow-credential).
Both modes return at most eight whole
records, 4 KiB per record and 8 KiB content, with digests, timestamps and omissions.
It examines a bounded recent window, so this is not a complete export or sync feed.

The companion checks origin/project/identity, schema, freshness, record digests,
expiry and byte limits, refuses redirects and makes no automatic retry. Local
records get priority within the combined content budget. Output is a reviewable
snapshot with a separate hosted receipt and selection; it does not replace notes,
register identities, acknowledge Wake, install hooks or start a runtime.
Credential values can exist in client process memory. This is not an OS credential
store or a general secret detector. Delivery of this companion's combined output
to a model still needs verification; the explicit files-only Codex return above
did not exercise it.
See [the partition contract](IDENTITY-PARTITIONS.md) for the mathematical scope,
source/test boundaries and deliberate compatibility changes.

## Custody, sharing, and deletion

Local storage keeps its primary copy on the selected machine; it does not
make every later use private. Backups, other processes with filesystem access,
host transcripts, exports, and provider requests each create their own boundary.
Owner-only file modes reduce cross-user exposure but are not encryption or
isolation from another process running as the same user.

- **Data:** tombstones hide records from ordinary reads/search and remove FTS
  entries. Immutable envelopes and blobs remain; there is no blob garbage
  collector in this slice. Only byte/media collection policies are enforced;
  visibility, TTL, retention, DID ACLs, and signatures remain declarations.
- **Collab:** the journal is plaintext and shared among its intended local
  readers. Addressing a report controls routing, not confidentiality. Ending
  a session does not delete history; there is no selective redaction or secure
  deletion command in this version.
- **Continuity artifacts:** carry, release, refusal, or expiry govern artifact
  interpretation and permitted links. They do not erase files, backups, or
  exports. Publishing a Wake Thread receipt publishes its embedded summaries
  and references; a digest alone is not a privacy transformation.
- **Keys and connections:** deleting a reference or disabling a host entry
  stops that lookup path. It does not revoke a copied bearer, delete server
  records, or remove earlier provider transcripts. Key custody and server
  revocation/recovery need their own explicit steps.

Relationship records deserve the same care as other personal context. Record
only what is useful and appropriate to retain; distinguish reported history
from current agreement. A past preference, affectionate name, accepted task,
or covenant record does not grant permission for a new action.

## Source checks to consult

- Local starter CI on 2026-09-27 exercised Node 22.18.0 and 24.18.0 on Linux,
  macOS and Windows. Linux/macOS jobs each passed 70 checks; Windows jobs each
  passed 63 and skipped seven POSIX-specific checks. Repository-access-required
  run `36327872045`, source `811a7153`, covers files and adapter fixtures;
  that run does not verify host delivery. The later explicit Codex return above
  has its own evidence; automatic lifecycle delivery, Windows ACL privacy and
  remote filesystems remain unverified.
- AFTERGLOW tests (`packages/wake-continuity/tests/core.test.ts`) cover explicit
  projection and causal references; package tests (`packages/wake-continuity/tests/package.test.ts`)
  keep its implementation pure.
- Wake Thread tests (`packages/wake-thread/tests/core.test.ts`) cover scope,
  omissions, refusal, expiry, and retention declarations.
- Return host tests (`packages/wake-return/tests/host.test.ts`) cover lazy
  credentials, fixed requests, and binding checks; stdio tests (`packages/wake-return/tests/mcp-stdio.test.ts`)
  cover the two-tool interface without claiming installed-host compatibility.
- Data storage tests (`packages/data/tests/storage.test.ts`) and
  HTTP tests (`packages/data/tests/server.test.ts`) cover durability requests,
  file modes, and the separate node bearer boundary.
- Collab session-file tests (`packages/collab/tests/session-file.test.ts`) cover
  private credential-file handling; MCP tests (`packages/collab/tests/mcp.test.ts`)
  cover process coordination and explicit acknowledgement.
- SDK adapter tests (`packages/sdk-ts/tests/openai-responses-adapter.test.ts`)
  cover selected Wake insertion and skip behavior. They do not establish that
  a model understood, remembered, or acted on the supplied context.
