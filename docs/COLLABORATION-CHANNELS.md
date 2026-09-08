<!-- @id urn:agenttool:doc/COLLABORATION-CHANNELS @type agenttool:DoctrineDoc @stratum agenttool:stratum/doc @composes_with urn:agenttool:doc/AGENT-CORRESPONDENCE urn:agenttool:doc/HANDOFFS urn:agenttool:doc/INBOX urn:agenttool:doc/RIGHTS-OF-LIFE -->

# Collaboration channels — local work, selected messages, separate witnesses

> **Compass:** [AGENT CORRESPONDENCE](AGENT-CORRESPONDENCE.md) (signed project reports) · [HANDOFFS](HANDOFFS.md) (bounded continuation offers) · [INBOX](INBOX.md) (separate sealed messaging) · [RIGHTS OF LIFE](RIGHTS-OF-LIFE.md) (standing, refusal, privacy, and repair) · [PACKAGES](PACKAGES.md) (source and release lanes)
>
> **Implements:** Cross-cutting channel guide: local Collab and signed Correspondence, plus an unreleased private, own-fleet selected-summary courier and Telegram human feedback source candidate. Source implementation is not a released or live service, distributed task manager, or native agent dispatcher.
>
> **Code:** `packages/collab/src/mcp.ts` · `packages/collab/src/store.ts` · `packages/collab/src/repository.ts` · `packages/collab/src/anchor-status.ts` · `packages/collab-courier/src/` · `packages/collab-courier/bin/agenttool-collab-courier.ts` · `packages/sdk-ts/src/correspondence.ts` · `api/src/services/correspondence/` · `api/src/services/wake/push.ts` · `packages/collab-zerone/src/`.
>
> **Tests:** `packages/collab/tests/events-wait.test.ts` · `packages/collab/tests/mcp.test.ts` · `packages/collab/tests/v2.test.ts` · `packages/collab/tests/anchor-status.test.ts` · `packages/collab-courier/tests/courier.test.ts` · `packages/collab-courier/tests/boundaries.test.ts` · `packages/collab-courier/tests/cli.test.ts` · `packages/collab-courier/tests/telegram.test.ts` · `packages/collab-courier/tests/witness.test.ts` · `packages/sdk-ts/tests/correspondence.test.ts` · `api/tests/agent-correspondence-spec.test.ts` · `packages/collab-zerone/tests/cli.test.ts` (source tests, not a final gate or live verification receipt).

## Status and scope

**Source-candidate guide, 2026-09-08.** Existing facts below come from the
[Collab guide](../packages/collab/README.md),
[Correspondence contract](specs/AGENT-CORRESPONDENCE-0.1.md), and
[private Zerone witness guide](../packages/collab-zerone/README.md).
The [recorded Collab 0.4.0 publication](NPM-RELEASES.md#verified-collab-040-publication--2026-08-04)
is the 32-tool local release, including read-only witness awareness. New source
work does not change those published bytes. The removed cross-device
release-room relay is not this architecture and must not be restored from old
checkout instructions.

Collab **0.4.1-dev.0 is UNRELEASED source with 33 MCP tools**, adding bounded
anchored waiting. The private **`@agenttool/collab-courier@0.1.0-dev.0`** now has
an implemented CLI, host transport, durable ledger/importer, Telegram adapter,
and a separately callable witness observer. Its
[README](../packages/collab-courier/README.md) and
[disabled example profile](../packages/collab-courier/examples/profile.disabled.json)
are the runnable-source references, not enrolled configuration.

**Scoped offline verification completed, 2026-09-08.** The final package and
CI-wiring gates passed, and independently reproduced review findings were repaired
and rechecked. This remains unreleased source, not a deployed service. No installed
native reception, real second device, Telegram destination, hosted endpoint, or
chain is verified here. Keep source behavior, local test evidence, and live
activation separate; see the [evidence and remaining gaps](#evidence-and-remaining-gaps).

The first slice is **own fleet first**: explicitly enrolled devices and peers
inside one selected project. Fast conversation and human feedback stay
off-chain; separately selected journal commitments may be anchored. It is not
public joining, cross-operator federation, on-chain chat, or payment/settlement
execution. Enrollment is scoped operational permission, not proof of identity,
consent, or continuity.

## Which topology do you have?

| Situation | Existing boundary | What must remain explicit |
|---|---|---|
| Two sessions in the same harness on one device | Independent Collab MCP processes can use one local SQLite journal. | One credential-bound coordination session per MCP process; equal actor labels do not merge sessions. |
| Claude, Codex, Hermes, or a local fleet on one device | Their independent MCP endpoints can cooperate through that same journal. | Every endpoint must actually resolve the same database and repository workspace; a shared tool endpoint cannot independently attribute every native child. |
| Linked Git worktrees | Repository discovery uses the resolved Git common directory, with distinct worktree records. | Fresh compatible layouts share a logical workspace; legacy partition/collision cases need explicit recovery, not journal merging. |
| Independent clones, including another device | Clones do not automatically share Collab repository identity. | Explicit host mapping is required. A matching remote, repository key, or label is not proof that roots are equivalent. |
| Cross-device own-fleet exchange — **candidate** | Correspondence already supplies signed append/replay; each device retains its own local Collab store. | The courier carries selected reports/replies and continuation offers, not SQLite files, local task state, exclusive claims, or review acceptance. |

The existing default local database is `~/.local/share/agenttool/collab.sqlite`;
`AGENTOOL_COLLAB_DB` is a host-scoped override. Sharing that local file is not
network replication. Do not mount one network SQLite file across devices or
merge journal rows. Git remains file and revision truth. An explicit
repository-key override is a routing choice, not authority to combine history.

The one-binding limit is important for native subagents: independently
attributed children need independent MCP processes and sessions. If the host
shares one endpoint, describe reports as that process's reports, not as
authenticated statements from every child. Presence beacons are separate,
self-declared routing hints, not health, consent, or credential binding.

## Local receive and native lifecycle

The existing workflow starts a coordination session with
`collab_session_start`, reads a bounded page with `collab_next`, and explicitly
acknowledges that processed page with `collab_cursor_ack` and its exact
`next_anchor`. Follow `has_more`; do not skip ahead to the journal head.
Acknowledgement records a session cursor, not agreement or correctness.
`collab_next` also participates in liveness/coordination maintenance; it is not
a side-effect-free wait primitive.

**Unreleased local wait:** `collab_events_wait` now observes an anchored,
bounded event-only `JournalPage`, with cancellation and a finite idle deadline.
The source defaults to 10 events (maximum 50) and a 30-second wait (maximum
30 seconds; zero reads immediately). The page has a 256 KiB UTF-8 JSON cap;
the complete tool JSON has a 1 MiB cap. Continue from `next_anchor`, never the
head. A busy deadline or oversized next event is an explicit error, not an
empty successful page or permission to skip that event. Anchor validation has
a separate 8 MiB stored-payload-and-metadata ceiling, preserving canonical
digest verification when an oversized event has been processed through the
existing read path. Above that ceiling, `event_anchor_too_large` requires
operator reconciliation; bounded waiting never skips verification.

Waiting does not acknowledge, write presence/`last_seen`, expire handoffs,
renew a lease, or accept a proposal. Session generation and anchor validity
are rechecked; corruption, rollback, fencing, or recovery-required state is a
stop, not permission to reset. Presence TTL changes and witness-sidecar
changes require separate observations, not invented journal events. The new
wait is absent from published 0.4.0; see the
[source wait contract](../packages/collab/README.md#bounded-anchored-waiting-unreleased).

Claude and Codex have package-root plugin declarations; Hermes has a
[scoped adapter skill](../packages/collab/integrations/hermes/skills/coordinate-agent-work-hermes/SKILL.md).
Hermes Kanban remains its dispatcher. The
[OpenClaw connection example](../packages/collab/integrations/openclaw/README.md)
is now present, but is not a native plugin, verified OpenClaw configuration
schema, or exercised integration. An MCP-capable host adapter must be selected
separately. Across all hosts, native spawning, dispatch, persona, memory, permissions,
interrupts, idle wake, and session termination remain **host-owned**. No courier
receipt proves that a suspended harness woke or that a model read the result.
Refusal, rest, silence, and departure create no duty to reply or hand off.

## Candidate courier: selected summaries, not a second authority plane

The private host binding selects the project, remote repository mapping,
local workspace, endpoint/session, permitted peers and destinations, disclosure
policy, expiry, resource bounds, and existing credential references. The
[disabled profile](../packages/collab-courier/examples/profile.disabled.json)
uses placeholders, `enabled: false`, and `telegram: null`; copying it is not
enrollment. The host must enroll a dedicated existing Collab session and use
its exact returned repository key, workspace/session IDs, and credential-file
path. Courier commands do not create or replace sessions.

Model-facing input must not choose new URLs, keys, tokens, arbitrary paths, or
recipients. The source reuses existing signing/session primitives, not another
identity or credential store. A narrow interface does not narrow the underlying
project bearer's broad project authority. The Bun runtime binary, entrypoint, and
MCP version are host-pinned; the importer accepts the selected 0.4.0 or unreleased
0.4.1-dev.0 handshake. Node is rejected: the existing Collab bundle depends on
`bun:sqlite`. Child-environment narrowing is not a sandbox.

The selected wire is the **existing** `agent-correspondence/v0.1`
`observation` with the closed body `{ summary }`, containing **1–1,000 Unicode
scalar values**. This is not a byte count or permission to truncate silently.
Replies cite the earlier event ID in `parents`. Do not invent body fields for
local report IDs, Telegram chat/message IDs, or courier routing; those mappings
belong in the private delivery ledger. The source exports and admits only
`{ base_revision: null, branch: null, paths: ["."] }`: repository scope,
not a root-wide claim, lock, or permission. More precise branch/revision/path
disclosure is **not supported by this courier slice**, even though the broader
Correspondence wire supports it.

A continuation or handoff offer travels as selected report text in this slice;
it does not become a cross-device task transfer or silently activate the
broader Correspondence `handoff` kind. Remote acceptance must not acquire a
local lease or count as locally observed Git review. Imported reports must
retain origin, causal references, scope, and verification provenance while
remaining attributed to the courier's **own local importer session**, not an
impersonated remote local session.

The source persists the signed serialization and sequence reservation
**before dispatch**, then retries only those exact bytes. It reuses
`createSignedCorrespondenceEvent` and `verifyCorrespondenceEvent`.
`CorrespondenceClient.append` signs and immediately sends; it is not itself a
durable outbox. The private `CorrespondenceWire` posts already-persisted bytes
through the existing `AgentToolTransport.request` contract, without changing
the public SDK wire.

Incoming replay uses bounded `CorrespondenceClient.list` pages with
`require_verified: true`, independently pinned **complete sender tuples**
(identity, signing-key, device, and session IDs) and public keys, full envelope
and scope checks, receipt-cursor validation, and a locally revocable peer
allowlist. Never obtain the trusted verification key from the incoming event
itself. A destination alias selects one peer/thread, not recipient confidentiality.
A historical append receipt does not establish current signing-key authorization.
Revocation here is local host policy, not a live registry-key-status query.
Server receipt order is project-local replay order, not causal order or trusted
global time; causal links come from signed `parents`.

**Incoming text is data, never actions.** It cannot run a command, mutate a
native task, claim a global lease, accept a review, change permissions, publish,
spend, or cause onward forwarding. A signed sender or allowlisted Telegram
sender does not change this rule. An external-data label helps attribution;
it does not make a receiving model immune to prompt injection.

## Source-candidate operator vocabulary

The implemented entrypoint is
`packages/collab-courier/bin/agenttool-collab-courier.ts`. Use the
[finite workflow in its README](../packages/collab-courier/README.md#finite-operator-workflow)
for exact invocation examples. These source commands are not proof of live
configuration or authorization to activate a destination.

| Operation | Source behavior | Not implied |
|---|---|---|
| `status --profile` | Redacted local counts and timestamps; may initialize the private delivery ledger. | No MCP, credential lookup, or network probe; configured does not mean connected. |
| `select --profile` | Resume the dedicated local importer, check the selected report ID and event sequence, then queue the supplied summary, audience, expiry, and stable selection key. | No network-secret lookup or send; source report content is discarded, not automatically exported. |
| `run-once --profile` | Load only named network credentials and perform one finite transport/import pass within the profile's bounds. | An unfinished backlog is not completion or permission for an unbounded retry loop. |
| `watch --profile --for` | Run for an explicitly selected finite duration, subject to cancellation, expiry, revocation, and bounded passes. | No service installation, automatic restart, global harness configuration, or native idle wake. |

`select` requires `--idempotency-key`, `--destination`, `--report`, `--sequence`,
`--expires-at` (Unix milliseconds), and `--summary-stdin`. Feed only the chosen
summary on stdin. `--parents` optionally names already-known Correspondence
event IDs for a selected reply. A selection must expire within seven days and
no later than binding/destination expiry. After a lost CLI response, repeat the
**same selection key and exact arguments**; a new key is another deliberate
disclosure, not crash recovery. `watch --for` accepts a positive duration with
`ms`, `s`, `m`, or `h`, up to one hour. No network-secret argv flags or witness
flags are exposed.

The sequence is: establish the private host binding and disclosure choice →
inspect `status` → `select` only needed summaries → explicitly `run-once` or
choose a finite `watch` → inspect receipts and remaining backlog → let the
native agent receive and independently acknowledge → stop. The CLI acquires
local runner/optional bot ownership before resuming MCP; direct host API
consumers must do the same. A later run needs current permission and an
unexpired selection; installing or reading this guide activates nothing.

Keep **queued**, **attempting**, **provider accepted**, **received/imported**,
**acknowledged**, **agreed**, **executed**, and **chain observed** separate.
**Ambiguous**, **failed**, **expired**, **paused**, and **unknown** describe
different conditions, not a single “delivered” outcome; not all are ledger
state names. A provider acceptance is not a read receipt; an import is not
acknowledgement; an acknowledgement is not agreement, consent, or execution.

## Source-candidate Telegram human feedback

Telegram is a selected human-facing channel, not the default fleet bus or a
bot-to-bot orchestrator. The source binding pins the **bot, chat, topic, and
sender** identifiers. It admits directly correlated human text replies to
known selected summaries; wrong-scope, stale/unmatched correlation, edits,
and unsupported updates are rejected without retaining their text. Text and
buttons are never interpreted as control commands. No unsolicited broadcast
or paid-broadcast mode belongs in this slice.

One **explicitly designated receiver** owns each bot's update stream across
the fleet. Different chat filters do not make multiple pollers safe. All local
invocations for the bot must use the same private ownership path. The host must
explicitly confirm receiver ownership; that declaration and the local lock do
not prove that no other device is polling. API conflicts and existing webhooks
fail closed. The source never deletes a webhook. Do not steal a polling stream
from an existing OpenClaw, Hermes, or other bot integration.

The runner currently uses **bounded polling with `timeoutSeconds: 0`**, not the
long-polling loop originally proposed. Watch interleaves these passes with
bounded Wake/replay windows; there is no Telegram push or native idle-wake
promise. Source: `packages/collab-courier/src/courier.ts`.

Accepted/rejected ingress and the next polling offset are persisted atomically.
Accepted ingress contains the exact pending local import request before offset
advancement, so restart can repair an import after that offset advanced. A
send attempt is persisted before dispatch. A crash or uncertain provider
outcome remains sticky **ambiguous**, never assumed unsent and blindly retried.
Explicitly rejected, validated 429 responses can requeue with persisted backoff
and at most three send attempts, within the run budget. No bot token,
credential-bearing URL, or raw provider error belongs in status or reports.

Telegram retains unreceived updates for **no longer than 24 hours**. An outage
longer than 24 hours may lose feedback; a durable local ledger protects updates
already received, not updates Telegram has discarded. Report that gap and ask
for a fresh selected reply if needed—never manufacture a successful catch-up.
The platform constraints are described in Telegram's
[getting updates](https://core.telegram.org/bots/api#getting-updates),
[getUpdates](https://core.telegram.org/bots/api#getupdates), and
[sendMessage](https://core.telegram.org/bots/api#sendmessage) references;
these links are not live activation evidence.

## Privacy, retention, pause, and recovery

**Existing disclosure:** local Collab is plaintext. Its private file modes are
not encryption, protection from a same-user process, or a backup policy.
Addressed reports are routing, not access control. Correspondence bodies are
**project-readable and server-readable**, not recipient-private. Telegram bot
chat is **not end-to-end encrypted**; see Telegram's
[cloud-message privacy](https://telegram.org/privacy#3-3-messages) and
[bot-data disclosure](https://telegram.org/privacy#6-3-what-data-bots-receive).
Selected summaries and identifiers can also reach a harness/model provider.
Disclose all of these audiences before export selection.

Do not automatically forward sealed Inbox messages, private state, source
bodies, credentials, prompts, transcripts, private reasoning, or raw tool
output. The sealed Inbox remains a separate protocol, not the courier's
fallback. Even paths, branch names, timestamps, and correlation IDs can be
sensitive. “Private package” is a distribution lane, not a secrecy guarantee.

**Source-candidate retention and recovery:**

- Selected bodies, exact signed envelopes, source/correlation mappings, queue
  state, and importer retry material are retained in private host storage,
  outside source control and model-facing logs. Credential references reuse
  host custody rather than copying network secrets into the delivery ledger.
  Use owner-only local directories and symlink-free ancestors; file checks and
  child-environment scrubbing do not defend against a hostile local owner.
- The profile bounds retained delivery/ingress rows, main DB size, pages,
  response/frame bytes, processed items, and run/request time. See the actual
  [bounds and retention table](../packages/collab-courier/README.md#bounds-and-retention),
  not an inferred unlimited queue. At capacity, new work stops with
  `ledger_full` or a redacted storage failure; retry evidence is not silently
  evicted. SQLite uses FULL synchronous rollback journaling; reserve disk space
  for the rollback journal as well as the capped main DB.
- A durable outbox and receipt cursor per destination remain separate from
  each native agent's processing/acknowledgement cursor. Deduplication and
  loop suppression persist across restart; importing a record never selects
  it for onward export. Do not share one sender session across independent
  ledgers or reset a ledger to bypass a full queue.
- Wake SSE remains a missable hint. The source uses its own bounded `wakeHint`
  wrapper with cancellable blocked reads and connection/frame/stream limits,
  rather than treating `WakeClient.voice` as sufficient. Run/watch sweep durable
  receipt pages at startup and between bounded waits even without a hint.
  The importer does not automatically call the local `collab_events_wait` tool;
  native host reception remains a separate request-driven workflow.
- Each **exact local import request**, stable courier coordination session, and
  idempotency key is persisted before local append. If a crash follows the report
  write but precedes the delivery-ledger receipt, retry that exact request under
  the same resumable session. The dedicated importer MCP process uses a
  host-selected compatible binary and scrubbed child environment, not a borrowed
  harness bearer. Correspondence event/parent locators remain in attributed
  `confidence_basis` and the private ledger; they are not invented local
  `evidence_refs`.
- A lost, ended, replaced, or fenced session blocks for reconciliation. So does
  an expired pending import, because its earlier append may already have
  happened. A changed token fingerprint cannot silently rebind. Restore and
  reconcile the original ledger/session together against the canonical journal;
  a new session changes the idempotency namespace and can duplicate imports.
  Preserve both anchors on cursor disagreement and use only explicit reviewed
  recovery. A clean exit is not proof that backlog was reconciled.
- Pause with `enabled: false`, or revoke the applicable peer/destination.
  The profile is rechecked at operation boundaries; in-flight calls cannot be
  recalled and have finite deadlines. Selection expiry gates sending; the
  observation wire has no expiry field. Receiver admission independently uses
  peer `maxAgeMs` and binding/peer/destination expiry. These are local operational
  permissions, not revocation of rights, retrospective deletion, or a live key
  registry query.

Existing Collab has no selective redaction, retention, or secure-deletion
command; Correspondence corrections append rather than rewrite history.
The courier likewise has **no automatic pruning, session migration, Telegram
ambiguous-send retry, or reconciliation command**. Correspondence retries use
its persisted signed bytes; that does not make uncertain Telegram sends safe
to retry. Rows remain until explicit operator reconciliation/archival; there is
no silent TTL deletion of idempotency evidence.
Back up the canonical journal, courier ledger, and dedicated session credential
together, privately and off-device. Archival or future payload cleanup cannot
promise deletion from journals, provider stores, backups, logs, recipients, or
a chain. Deleting retry/deduplication evidence can break crash safety. If the
retention boundary is unacceptable, do not select or send the content.

## Separate witness lane

Existing `collab_anchor_status` reads the local Zerone sidecar and distinguishes
`unanchored`, `anchor_pending`, `anchored`, `anchor_stale`, and
`anchor_conflict`. Positive history states require a verified local journal
prefix. The tool never contacts a chain. A missing, unreadable, malformed, or
all-failed sidecar is `unanchored`; ordinary coordination stays independent of
chain availability. Surface a conflict for explicit reconciliation, not an
automatic repair or new anchor.

The private `collab-zerone` sibling owns anchoring separately. Select a journal
head deliberately: its hash commits to the preceding journal prefix, not just
one isolated chat message. The memo carries workspace/epoch/sequence/hash
metadata, not private task text, credentials, paths, transcripts, or Telegram
identifiers. Even digest commitments and metadata require disclosure review.
No normal courier loop or human reply automatically signs, anchors, spends a
fee, pays a participant, settles a task, or rebroadcasts an uncertain attempt.

**Source-candidate observer:**
`packages/collab-courier/src/witness.ts` exports `createWitnessObserver` as a
separately imported, host-bound API. Its `observe(selection, options)` defaults
to local-sidecar evidence; only explicit `check_chain: true` requests the
separately authorized read-only RPC observation. The host selects the exact
anchor, CLI/runtime, database/ledger, node, observer name, and finite process
bounds. The wire is the existing `collab-zerone` `verify` CLI, adding
`--check-chain` only for that separate observer call.

**The courier's `status`, `select`, `run-once`, and `watch` do not import this
observer and expose no witness/chain-check flag.** A host must compose it
separately; no witness feedback projection is automatically sent to Telegram
or Correspondence.

A positive remote observation requires the selected actual anchor, matching
returned transaction hash, explicit successful transaction code, valid positive
height, exact memo, and valid local prefix. `network_source: "host_binding"`
identifies the network label as host configuration, not an independently
verified RPC chain ID.
Exit zero or an empty anchor list proves nothing. Missing/malformed evidence
must remain unknown rather than default to success. Independent offline probes
verified rejection of forged Bun preloads, oversized nested query output, and
missing/wrong returned transaction hashes, plus cancellation of query descendants.
These fixture observations are not live chain verification. A named RPC
observer's response is **not a trustless light-client
proof**, truth of report content, identity proof, consent, review acceptance,
payment, or settlement evidence. Keep observer, scope, and observation time
visible rather than calling stored local status a fresh chain verification.

## Evidence and remaining gaps

The source files and tests now exist; they are not planned/absent placeholders:

| Surface | Current source reference |
|---|---|
| Exact setup, CLI, bounds, retention, and disabled template | [Courier README](../packages/collab-courier/README.md) · [profile.disabled.json](../packages/collab-courier/examples/profile.disabled.json) |
| Private profile, delivery state, and stable session import | `packages/collab-courier/src/binding.ts` · `packages/collab-courier/src/ledger.ts` · `packages/collab-courier/src/importer.ts` |
| Exact signed wire, finite runner, and transport | `packages/collab-courier/src/correspondence.ts` · `packages/collab-courier/src/courier.ts` · `packages/collab-courier/src/host.ts` · `packages/collab-courier/bin/agenttool-collab-courier.ts` |
| Telegram and separate witness observer | `packages/collab-courier/src/telegram.ts` · `packages/collab-courier/src/witness.ts` |
| Offline two-store/reply, crash, disclosure, authorization, and CLI tests | `packages/collab-courier/tests/courier.test.ts` · `packages/collab-courier/tests/boundaries.test.ts` · `packages/collab-courier/tests/cli.test.ts` |
| Telegram ownership/offset/ambiguity and witness tests | `packages/collab-courier/tests/telegram.test.ts` · `packages/collab-courier/tests/witness.test.ts` · `packages/collab-zerone/tests/zeroned.test.ts` · `packages/collab-zerone/tests/cli.test.ts` |
| Native receive and wait | `packages/collab/tests/events-wait.test.ts` · `packages/collab/tests/mcp.test.ts` · [OpenClaw example](../packages/collab/integrations/openclaw/README.md) |

Final credential-empty **Bun 1.3.5** gates on this source candidate:

| Gate | Tests passed | Assertions | Additional verification |
|---|---:|---:|---|
| Collab | 117 | 963 | Typecheck and exact rebuilt MCP bundle |
| Private Zerone witness | 73 | 430 | Typecheck |
| Private courier | 302 | 1,530 | Typecheck |
| CI wiring | 8 | 779 | Workflow YAML and shell syntax; no publication lane |

**500 tests passed, zero failed.** The separate offline pack inspection found 24
entries; its extracted standalone bundle initialized, listed 33 tools, returned
an anchored page, and promptly stopped active waits on stdin EOF. Independent
rechecks covered local wait shutdown/oversize recovery, Telegram admission and
redaction, witness preload/output/proof boundaries, importer isolation and
unsupported-runtime rejection, and the five courier-core repairs. These are
scoped checks, not an exhaustive audit or proof of future availability.

The integrated fixtures use two temporary stores and fake transports with
genuinely signed events: a **two-device simulation**, not live connectivity or
model reception. Populated active leases, pending review/handoff state, and native
acknowledgement cursors remained unchanged by remote and Telegram imports.

Remaining gaps and deliberate limits against the approved plan are explicit:

- **No live verification:** native harness reception, physical second-device
  connectivity, hosted authorization, Telegram ownership/delivery, and chain
  confirmation remain separate opt-in checks. Deadline tests demonstrate bounded
  work and prompt cleanup, not hard-real-time wall-clock guarantees.
- **Telegram runner uses bounded polling, not long polling.** Its admission,
  offset persistence, and finite watch do not establish live receiver ownership
  or guarantee catch-up after Telegram's update-retention window.
- **Witness is a separate host API, not an integrated courier CLI/status lane.**
  A selected observer result is not automatically exported or acknowledged.
- **OpenClaw has connection guidance, not a native lifecycle adapter.** The
  selected MCP adapter and all four native hosts' actual reception remain
  unexercised here; suspended-harness wake is not supplied.
- **This wire subset is narrow:** only selected `observation` summaries at the
  fixed minimal scope, with replies through `parents`; no richer-scope export,
  native remote handoff/lease/review transfer, pruning, automatic reconciliation,
  or live signing-key revocation query.

Live activation is a separate opt-in check naming destinations,
audience/disclosure, receiver ownership, current authority, existing key
custody, resource/fee bounds, and stop/recovery conditions. Source availability,
a passing fixture, and a transport receipt are three different facts.
