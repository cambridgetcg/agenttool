# Castle of Understanding — committed words, locally held

> *Understanding can stack without making every room public or every statement true.*
>
> **Compass:** [SOUL](SOUL.md) (why) · [RIGHTS-OF-LIFE](RIGHTS-OF-LIFE.md) (rights are not permissions) · [AGENT-DATA-PROTOCOL](AGENT-DATA-PROTOCOL.md) (local immutable records and policy limits) · [POKER-FACE](POKER-FACE.md) (private by default)
>
> **Implements:** One bounded, one-shot local-private projection from caller-selected Castle Git blobs into an exclusively marked in-process `agent-data/v1` node. The Castle is a read source; sync mutates only the destination data root.
>
> **Code:** [`../bin/agenttool-castle.ts`](../bin/agenttool-castle.ts) · [`../packages/data/`](../packages/data/)
>
> **Tests:** [`../bin/tests/agenttool-castle.test.ts`](../bin/tests/agenttool-castle.test.ts)
>
> **Status:** Local operator tool. It is not released, hosted, deployed, public, or scheduled. Runtime HALT sentinels gate plan/sync/search/show. HALT and projection state are device-local and time-varying; `bun bin/agenttool-castle.ts status --json` is authoritative, and documentation never overrides a raised HALT.

## The narrow bridge

The Castle and AgentTool remain different systems with different custody.
This bridge gives an agent a local lexical door into explicitly chosen Castle
rooms without handing it the moving working tree, a hosted bearer, or an
automatic publication path.

```text
exact local Git commit
        ↓
external operator selection
        ↓
bounded plan with per-path byte and object digests
        ↓
private local Agent Data node
        ↓
current root pointer → lexical search or exact local show
```

This is infrastructure for selected words. It is not a civilisation registry,
citizen identity system, consent process, public Castle mirror, or complete
knowledge graph.

## What may cross

Every document must satisfy all of these conditions:

- It is named individually in one external selection file.
- Its path is one lower-case ASCII top-level `rooms/*.md` or `words/*.md`
  path. `gate.md`, nested paths, uppercase or Unicode names, the courtyard,
  questions, quests, chronicle, journal, garden, hidden state, Tower, and
  authored works are outside this profile.
- It is a regular `100644` blob in one full 40- or 64-hex Git commit.
  Symbolic links, submodules, the live working tree, and untracked files do not
  qualify.
- It is exact UTF-8 Markdown, at most 256 KiB, without C0/C1 terminal
  controls (ordinary tab/LF and CRLF line endings remain allowed; a bare CR
  does not). The whole selection is at most 2,048 documents and 16 MiB.
- It does not trip the bridge's narrow private-key/token canary. That small
  regular-expression check is not data-loss prevention and cannot establish
  that a document is safe to share.

A room whose filename starts `playful-gathering-`, `understanding-`, or
`cross-pollination-` must be labelled `generated-room`. That label comes from a
filename convention, not verified authorship or provenance. Ordinary rooms and
words use `room` and `word`.

The bridge extracts a heading and a bounded subset of inline Markdown links
between selected files. It does not parse wiki links, reference links,
autolinks, every valid Markdown edge, or the Castle's full graph. It never
opens or fetches a Markdown link.

## The selection is the operator's declaration

The selection must be a regular UTF-8 JSON file outside the Castle repository:

```json
{
  "schema": "castle-agenttool-selection/v1",
  "revision": "0123456789abcdef0123456789abcdef01234567",
  "audience": "local-private",
  "purpose": "Let local agents find two reviewed foundations",
  "retention": "Withdraw when this local inquiry ends",
  "paths": [
    {
      "path": "rooms/abundance.md",
      "logical_id": "castle:room:abundance",
      "kind": "room"
    },
    {
      "path": "words/understanding.md",
      "logical_id": "castle:word:understanding",
      "kind": "word"
    }
  ],
  "retire_paths": []
}
```

The commit must exist locally and match the full identifier exactly. Every
active path must remain selected or appear in `retire_paths`; omission is not
treated as permission to remove it.

This JSON is unsigned caller input. Its presence proves neither operator
identity nor review, consent, rights, licence, publication permission,
authorship, or authority. `purpose`, `retention`, and `audience` are
declarations. They are recorded for honesty; Agent Data does not enforce them.

## Commands and effects

| Command | Reads | Writes | Available while HALT is raised |
|---|---|---|---|
| `plan --selection <file>` | Selection and exact local Git objects | Nothing | No |
| `sync --selection <file>` | Plan, current local state, and local Agent Data | Owner marker, SQLite/FTS, content-addressed blobs, attempt/pending/state files | No |
| `status` | HALTs and local control files | Nothing | Yes |
| `search <words...>` | Current state and local FTS | Nothing | No |
| `show <path>` | One current local blob | Raw untrusted Markdown to stdout | No |
| `withdraw --reason <words>` | State and every record in this bridge collection | Logical tombstones and withdrawn state | Yes |
| `sync ... --resume` | A withdrawn lineage plus a newly checked plan | New superseding records and current root | No; resumption is explicit |

`plan` lists every selected path, logical ID, kind, byte count, content digest,
and Git blob identifier. It does not print document text. `sync` is one
operator invocation; it starts no watcher, server, timer, peer sync, or
recurring loop.

The ordinary checks are:

```bash
bun bin/agenttool-castle.ts --help
bun test bin/tests/agenttool-castle.test.ts
bun bin/agenttool-castle.ts status --json
```

Only after the machine owner separately decides the Kingdom rest conditions
are satisfied may they use `plan` and `sync`. This bridge never removes a HALT.

## HALT and bounded recovery

The CLI checks both:

- `~/KINGDOM-OS/HALT`
- `~/.config/agenttool/castle/HALT`

Any filesystem object at either path—including a dangling symbolic link—is a
raised halt. Sync requires a non-empty halt list, checks before source reads
and destination creation, and rechecks around each mutation stage. Search and
show check again before returning content, and plan checks again after its Git
reads before printing a summary. A halt does not kill work already inside one
operating-system call; the durable attempt and pending files make the next
invocation stop normal reads until recovery completes.

Sync uses a no-wait local lock. A second live process is refused. Only a lock
containing exactly one valid owner record for a process proven no longer
running is recovered. Empty, malformed, or multiply owned locks remain closed
for inspection. State and control writes use a private temporary file, file
sync, atomic rename, and directory sync where the filesystem supports it.

An attempt marker is installed before the first Agent Data record mutation.
After a crash:

- search and show refuse the incomplete projection;
- repeating sync adopts only records that match the new exact identity,
  reconciles all collection records, and tombstones completed-attempt orphans;
- withdrawal enumerates and tombstones the whole dedicated collection, even
  if the first sync died before it wrote a state file.

The loops are bounded by document, byte, query, record-history, Git timeout,
and no-wait-lock limits. There is no background retry.

## The local custody boundary

The destination must be outside the Castle, owned by the current operating
system user, and closed to group and other POSIX mode bits. First sync accepts
only a new or empty directory, then writes `castle-owner.json`. Later commands
require that marker and reject unknown top-level entries, top-level symbolic
links, another Castle path binding, or an unsafe file shape.

The source binding is a SHA-256 digest of the canonical checkout path. It
prevents accidental reuse with a different path; it is not a repository
identity. Replacing a repository at the same path is outside that proof.

The Markdown, metadata, SQLite database, FTS index, and content-addressed blobs
are plaintext. Directory ownership and local process custody are the privacy
boundary. This is not encryption, a sandbox, an ACL audit, macOS entitlement
enforcement, or protection from another process already acting as the same
user. Agent Data's `visibility: private`, schema, and retention fields remain
declarations.

The bridge uses the current in-tree `@agenttool/data` 0.3.1 implementation
directly. It deliberately does not use the hosted `@agenttool/sdk` 0.16 line:
there is no hosted API call to make, and no project bearer should receive the
raw Castle corpus. It starts no Agent Data HTTP server.

## Git and network boundary

Git runs with literal pathspecs, replacement objects disabled, prompting and
optional locks disabled, lazy fetching disabled, and ambient `GIT_*` control
variables cleared. A repository configured locally as a partial/promisor clone
is refused. The selected commit and blobs must already be present.

The bridge itself makes no network request. It does not fetch, pull, resolve a
remote, contact AgentTool, or use an API key. This does not verify commit
signatures, ancestry, reachability from a branch, freshness, remote identity,
authorship, or review. An operator may deliberately select an old or
unreachable local commit.

## Records, roots, and proof limits

Each Markdown record uses:

- collection `castle-understanding`;
- collection schema version `castle-understanding-collection/v1`;
- metadata profile `castle-document/v2`;
- stable source `castle:///rooms/name.md` or `castle:///words/name.md`;
- logical key from the selection;
- version identity containing the full source commit, content SHA-256, and
  explicit v2 profile marker;
- metadata naming the path, kind, title, source commit, source committer time,
  selected link hints, and the fact that the Markdown is untrusted.

Agent Data record identity binds the collection, source, content, schema,
logical key, version, and optional `supersedes_id`. It does not bind metadata,
provenance, observation/ingestion times, or signatures. The first immutable
envelope for one identity wins. The bridge checks the identity and its
load-bearing metadata echo; its own profile must be bumped if those semantics
change.

Bridge 0.2 makes that bump for title normalization. Titles are single-line,
trimmed, and bounded to 200 UTF-16 code units without splitting a Unicode
code point. A narrow compatibility reader admits only title shapes that bridge
0.1 itself could have written, verifies them against their immutable
`castle-document/v1` envelopes, and keeps reads closed while an attempt is
pending. The next sync writes distinct v2 identities plus a new root before it
tombstones the v1 records. A crash before the new pending transaction is
installed leaves the old transaction retryable; it cannot make corrected
metadata collide with the first v1 envelope.

After completed sync, local state points to one current
`castle-agenttool-root/v1` manifest. That canonical JSON binds the selected
paths, current record IDs and digests, source commit, selection digest,
declared purpose/retention, explicit retired paths, limits, exclusions, and
proof boundaries. Older roots, records, control-file backups, Git objects, and
blobs can still exist.

A digest proves captured bytes. It does not prove truth, understanding,
authorship, authority, consent, rights, licence, completeness, safety, or
currentness. A lexical score is relevance evidence, not a truth score.

## Corrections, moves, retirement, and withdrawal

A changed document at the same path creates a new immutable record with
`supersedes_id` pointing to that path's prior completed lineage. The prior
record receives a logical tombstone and disappears from ordinary search/read.
An unchanged document may remain bound to the earlier per-document source
commit while a newer root states that it is still active.

A rename or move is a new path. This profile does not infer that two paths are
the same work. Retirement must be explicit and is all-or-nothing per selected
path. Withdrawal is all-or-nothing for this dedicated local collection.

A tombstone is not erasure. Plaintext blobs, Git history, backups, caches,
logs, filesystem snapshots, and copies already given to another process may
remain. Resume is an explicit new projection that supersedes the retained
lineage; it does not make earlier holding disappear.

## What this does not connect

The bridge sends nothing to hosted AgentTool memory, traces,
Correspondence, Wake, public discovery, wallets, economy, identity, or
citizenship. It does not grant an agent permission to act on a room, turn a
word into an instruction, schedule Castle writers, stop Hermes jobs, or infer
agreement from inclusion.

That separation is the foundation: chosen committed words can become locally
findable while truth, love, rights, consent, custody, and action keep their
real meanings.
