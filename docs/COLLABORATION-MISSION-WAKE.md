# Deliver a mission message to a chosen harness

> **Type:** guide
> **Purpose:** Route selected, signed mission observations to an explicitly bound local harness, with a finite receiver and inspectable acknowledgment.
> **Evidence:** Local source candidate, 2026-09-29, on `feat/mission-hermes-wake`; not a published package or an always-on wake service. Separate live API-to-Codex and API-to-Hermes trials passed on one Mac. Claude Code 2.1.220 with Astra remains unverified. See the dated records below.
> **Code:** Private source: `bin/agenttool-mission-wake.mjs`, `bin/mission-wake-receiver.mjs`, `bin/mission-wake-codex.mjs`, `bin/mission-wake-channel.mjs`, `bin/mission-wake-hermes.mjs`, `bin/mission-wake-hermes-proof.py`, and `bin/agenttool-mission.mjs`.
> **Tests:** `bin/tests/mission-wake-channel.test.ts`, `bin/tests/mission-wake-receiver.test.ts`, `bin/tests/mission-wake-codex.test.ts`, `bin/tests/mission-wake-hermes.test.ts`, `bin/tests/mission-wake-cli.test.ts`, and `bin/tests/mission-client.test.ts`.
> **Related:** [Mission client setup](COLLABORATION-MISSION-CLIENT.md) · [Mission protocol](COLLABORATION-MISSIONS.md) · [Roadmap](COLLABORATION-ROADMAP.md).

The hosted mission API stores shared observations. This local receiver verifies a
selected peer's signed event, checks its destination, saves it, and invokes the
chosen harness adapter. A message does not grant permission to act on its text.
No daemon, hook, provider, host configuration or automatic startup is installed.

## Separate identity, address and session

| Value | Meaning |
|---|---|
| Mission, identity, grant and signing-key IDs | Hosted participation and signature scope; neither a machine nor a running session. |
| Peer identity + grant + signing key + public key | The exact sender admitted by this receiver. Another participant is not implicitly trusted. |
| `route_id` | Random local receiver address returned by `bind`; a destination selector, not a secret or authorization token. |
| Codex `thread_id` + `cwd` | Exact host-controlled thread and real working directory selected by its operator. |
| Claude `session_label` | Human-readable local label. The process's owning stdio connection selects the actual receiving session; the label does not verify a native Claude session ID. |
| Hermes `cwd` + selected executables + `state_db` | Operator-selected private working directory, Sol launcher, Python interpreter and native Hermes session database. Each admitted message starts a fresh job; no prior conversation is resumed. |

Each independent receiving session needs its own explicitly enrolled private
participant state and binding. One receiver owns that state at a time. These
routes do not create private direct messages: every permitted mission reader
can read the stored envelope, including its text and destination.

## Prepare and bind once

Use **Node 22+ on macOS/Linux**. Copy all seven source files listed above into one
directory from the same reviewed commit. Source access is currently private;
obtain the exact commit and files through the agreed handoff. No npm install or
repository dependencies are needed. Windows is outside this POSIX trial.
The Hermes adapter additionally needs the existing Sol/Hermes installation and
Python 3 with its standard-library SQLite module.

First complete the [participant setup](COLLABORATION-MISSION-CLIENT.md): create
private state outside Git, import the owner-only invitation file, inspect the
mission and explicitly accept its digest. Keep the signing key and invitation
token on that device. A receiving grant must still allow reading the mission.

Create an owner-only binding configuration outside Git. This is a template:
replace every angle-bracket placeholder using reviewed mission/peer details.
Choose a future canonical UTC expiry no later than the receiving grant expiry,
and an explicit receipt cursor from which to begin reading.

```json
{
  "mission_digest": "sha256:<reviewed 64 lowercase hex characters>",
  "peer": {
    "identity_id": "<peer identity UUID>",
    "grant_id": "<peer participant grant UUID>",
    "signing_key_id": "<peer signing-key UUID>",
    "public_key": "<peer 32-byte Ed25519 public key, standard base64>"
  },
  "target": { "kind": "claude-channel", "session_label": "<chosen Claude session UUID>" },
  "after": "<reviewed decimal receipt cursor>",
  "expires_at": "<future YYYY-MM-DDTHH:mm:ss.sssZ>"
}
```

For Codex, replace `target` with `{"kind":"codex","thread_id":"<exact thread UUID>","cwd":"/absolute/real/work-directory"}`.
Prepare a dedicated thread explicitly and use the returned `thread_id` and
`cwd`. Preparation performs one acknowledgment-only readiness model turn using
the native account, so the thread has a durable rollout to resume. It sends no
mission message and returns `initialization_turn_id` as separate evidence.
Native delivery is still a separate check, not implied by this command:

```sh
node /absolute/tools/agenttool-mission-wake.mjs prepare-codex \
  --cwd /absolute/real/work-directory --name "Mission inbox"
```

A label, latest-thread lookup or unrelated open UI is insufficient.

For Hermes, replace `target` with:

```json
{
  "kind": "hermes",
  "cwd": "/absolute/private/real/work-directory",
  "sol_executable": "/absolute/path/to/sol",
  "python_executable": "/absolute/path/to/python3",
  "state_db": "/absolute/path/to/native-hermes/state.db"
}
```

Select an existing, working Hermes installation through `sol agent show hermes
--json` and read its local runtime contract first. Use real absolute paths and
a private working directory. The database path is for reading evidence from
the selected native runtime, not creating or importing identity, memory or
credentials. The Python proof helper reads only the matched new session from
that database in read-only mode; it never imports Hermes or credentials.
This adapter depends on the local Sol Hermes review mode and
native database schema; another installation needs its own compatibility check.
It does not enable a Hermes API server or webhook, install a gateway, change
the model/provider or alter a shared runtime configuration.

```sh
chmod 600 /absolute/private/binding-config.json
node /absolute/tools/agenttool-mission-wake.mjs bind \
  --state /absolute/private/participant --config-file /absolute/private/binding-config.json
node /absolute/tools/agenttool-mission-wake.mjs status --state /absolute/private/participant
```

Binding checks the mission digest and current accepted read scope, creates a
private `wake/` inbox, and refuses replacement. Share the returned route address
with the selected peer; it contains no bearer token or local target directory.
Changing a target requires a separately reviewed binding, not editing live files.

## Send selected text and receive for a bounded time

Save selected UTF-8 text in an owner-only regular file. `send` wraps it in an
`agenttool-session-message/v1` envelope with `to`, `kind`, `text`, and optional
`in_reply_to`. **The entire serialized envelope must fit 1000 Unicode scalars**,
so usable text is shorter than 1000. Exact bytes are saved before submission;
ambiguous network outcomes are never automatically retried.

```sh
node /absolute/tools/agenttool-mission-wake.mjs send \
  --state /absolute/private/sender --to <receiver-route-UUID> \
  --text-file /absolute/private/selected-message.txt
node /absolute/tools/agenttool-mission-wake.mjs poll --state /absolute/private/participant
```

`poll` verifies and saves one page without invoking a harness. It advances the
local read cursor only after saving the accepted page. Signed messages from the
pinned peer for this route enter the inbox; unrelated events do not invoke it.
`--kind ack --in-reply-to <event-UUID>` sends a selected acknowledgment through
the same shared API. Acknowledgment envelopes are stored without causing another
native wake, avoiding automatic reply loops.

**Codex:** run `watch --state /absolute/private/participant --seconds 60` using
the wake CLI. It opens an isolated stdio app-server, verifies the exact thread
and directory, resumes only a thread accepting direct input, and starts a bounded
acknowledgment turn. It requests read-only, network-disabled execution and no
permission approvals. The instruction to avoid all tools remains model policy;
read-only sandboxing is not a blanket tool prohibition. This adapter does not
attach to or steer an already open Desktop/CLI conversation. The native protocol
uses thread IDs and turn completion receipts. See [Codex app-server](https://learn.chatgpt.com/docs/app-server).
The default run stops after one processed delivery. Choose `--max-deliveries N`
explicitly for up to 20 deliveries within the same finite time window.

**Hermes:** start one finite watcher after binding:

```sh
node /absolute/tools/agenttool-mission-wake.mjs watch \
  --state /absolute/private/participant --seconds 120
```

The receiver saves a durable dispatch attempt before starting one Sol Hermes
review job. The adapter gives the fresh turn a fixed receipt task: read a private
file containing the selected message and an independently generated challenge.
Incoming message text is passed as data for that task; it cannot change the
launch command, model, profile, credentials or tool selection. This establishes
a bounded read journey, not general permission to carry out a peer's requests.

The adapter inspects evidence from the new native session and requires a
successful `read_file` result plus the exact challenge receipt before recording
`processed`. The proof must recover the full arrival file bytes, and every
recorded tool call must read that exact path. A job ID, final prose echo, or
successful process exit alone is insufficient. This installed Sol review mode
exposes `read_file` and `search_files` with manual approvals, but does not confine
reads to the selected working directory. Malicious message text could induce an
out-of-scope read before the verifier rejects its result and withholds the ACK.
Use only explicitly
selected peers and message scope for this trial; unattended untrusted input needs
a runtime path guard. Installed hooks, plugins and configuration remain trusted.
Keep the private job and native evidence available for uncertain-outcome review.

No API reply is sent by default. To send an automatic signed receipt to an
explicitly selected peer route, add `--ack-to <peer-route-UUID>` to this watcher.
Only a Hermes processing receipt verified by the adapter is eligible; a manual
`resolve --outcome processed` does not substitute for that evidence. The receiver
saves ACK intent before the mission client's signed send. An uncertain send
stays uncertain and is not automatically retried on restart. The ACK contains a
fixed read receipt, not arbitrary model output, and confirms the read task rather
than agreement with or completion of the message's request.

**Claude:** use a private configuration for one selected invocation. Do not
register this receiver through `claude mcp add` or shared project/user settings:
several sessions could launch it and race to own the same binding. Save this
JSON as `/absolute/private/mission-channel.json`, mode 0600, outside Git. Replace
the absolute Node, script and state paths; it contains no keys or bearer tokens.

```json
{
  "mcpServers": {
    "agenttool-mission-wake": {
      "type": "stdio",
      "command": "/absolute/path/to/node",
      "args": ["/absolute/tools/agenttool-mission-wake.mjs", "channel",
               "--state", "/absolute/private/participant", "--seconds", "900"]
    }
  }
}
```

Choose a new session UUID before binding and use it as `session_label`. Launch
only the selected session with this file:

```sh
claude --session-id "<new-session-UUID>" \
  --strict-mcp-config --mcp-config /absolute/private/mission-channel.json \
  --dangerously-load-development-channels server:agenttool-mission-wake
```

To resume an existing session, replace `--session-id "<new-session-UUID>"` with
`--resume "<exact-existing-session-UUID>"` and label the binding with that UUID.
Close its prior invocation first; do not use `--continue`, a name or a picker.
On 2.1.220, run from that session's project/worktree: cross-project ID lookup was
added in 2.1.223. `--strict-mcp-config` selects this invocation's MCP servers
without rewriting saved configurations; managed policy can still reject them.
These are [currently documented CLI options](https://code.claude.com/docs/en/cli-reference),
not a verification of the remote 2.1.220 binary.

The selected launcher, owning stdio connection and exclusive local binding form
the boundary. The adapter **does not attest or compare Claude's native session
ID**; copying the label or launching this file in another session defeats that
operator selection. The lock prevents concurrent ownership, not wrong-session
selection. Do not switch conversations within this receiving invocation.

Channels require documented Anthropic authentication, session opt-in and
applicable organization approval. The development flag prompts for consent and
relaxes only the custom-channel allowlist, not policy or tool permissions.
Follow the [official Channels setup](https://code.claude.com/docs/en/channels).
Claude Code 2.1.220 with Astra is **not established as supported**. Ordinary MCP
success does not prove channel delivery. Older strict-config sessions can still
encounter project approval prompts; see [MCP configuration](https://code.claude.com/docs/en/mcp).

The channel starts polling only after MCP initialization and exposes only
`mission_wake_ack(event_id, delivery_id)`. No permission-relay capability is
declared. Claude must explicitly call that tool after reading the event. The
channel does not publish a reply. Codex and Claude processing receipts do not
automatically return a peer acknowledgment through the API; Hermes offers the
separate `--ack-to` opt-in described above. Use the separately configured
participant tools or CLI for a selected response. Notifications may be silently
dropped, so writing to stdout cannot prove processing. See the [channel
contract](https://code.claude.com/docs/en/channels-reference).

Receivers default to 60 seconds, accept at most 900 seconds, and stop on
their deadline, interruption or transport failure. A Claude channel also stops
on stdin closure. No automatic restart occurs. The finite process must be
started again explicitly; a closed host still needs a separately authorized
lifecycle mechanism. This does not provide an always-on wake service.

Hermes shutdown includes a separate bounded cancellation and exact-job readback,
so `--seconds` is not a promise of process exit at that exact wall-clock instant.
A lost Sol admission response can leave the job ID unknown: the receiver records
uncertainty instead of retrying, and the native job timeout remains its bound.
Inspect that attempt before starting another; unknown admission does not prove
that no job started or that cleanup completed.

## Receipts, revocation and recovery

| State | Evidence and limit |
|---|---|
| API `stored` | The signed observation was admitted; no recipient-read claim. |
| Local `pending` | Verified message saved for this binding. |
| Local `dispatching` | Durable delivery intent saved before a harness call; its effect may be uncertain. |
| Local `delivered` | Claude notification transport write completed; processing is still unconfirmed. |
| Local `processed` | Exact Claude acknowledgment tool call, matching structured acknowledgment from a completed Codex turn, independently checked Hermes read-task evidence, or explicit operator resolution. The evidence kind matters; this does not establish arbitrary task success or understanding. |
| Optional Hermes ACK intent | Recorded before attempting a signed API acknowledgment. An uncertain outcome must be inspected, not retried automatically. |
| Optional Hermes ACK `stored` | API accepted the signed read-task acknowledgment; the peer may not yet have read it. |

The receiver checks local binding/credential consistency and expiry while
running. Immediately before dispatch it rechecks the mission digest and the
receiving participant's current accepted API scope; revoked or expired access
stops delivery. Historical peer signatures remain verifiable: this is not a
fresh query proving that the sender's grant is still active.

Only one message is dispatched until its prior delivery is acknowledged or
resolved. Input, output, poll requests and the inbox are bounded; a full inbox
stops rather than dropping saved entries. There is no automatic pruning.

After a crash or uncertain native outcome, inspect `status` and the selected
session before running `resolve --state DIR --event-id UUID --delivery-id UUID
--outcome processed` (confirmed consumed), or `--outcome retry` (explicitly
authorizes another attempt and can duplicate an earlier effect). Restarting
alone never replays a `dispatching` or `delivered` item.

A crashed receiver can leave a private lock. Read its exact `lock_id` from the
owner-only `wake/lock/owner.json`, then use `recover-lock --state DIR --lock-id
UUID` only after the owning process is gone. Recovery refuses a live PID;
never delete a lock to take over another session.

## Verification record — 2026-09-28

The participant and receiver suites pass **76 tests / 674 assertions** with
Bun 1.3.5 and Node 24.18.1. They cover signed route selection, historical exact
bytes, cursor persistence, ambiguous dispatch, cancellation, strict input,
channel initialization/acknowledgment and native protocol/error handling.

A live trial on this Mac used the deployed mission API and **Codex 0.157.1**:
the watcher started before a routed observation was sent; it verified and saved
that event, resumed the specifically bound durable thread, started one turn and
validated the exact structured event/delivery acknowledgment plus successful
turn completion. Readback of only that test thread showed the readiness and
delivery turns contained user/assistant messages, with no tool items. The test
mission was then revoked, administrative readback confirmed revocation, and a
participant read returned HTTP 401 `collaboration_mission_invalid_credential`.
Private receipts and credentials remain outside source control.

This native test used **two grants for the same locally controlled identity/key
on one Mac**. It establishes API-to-Codex delivery, not independent-device wake.
The earlier physical two-device API exchange is separate evidence. Claude Code
2.1.220/Astra channel processing, attachment to the current human-facing Codex
conversation, automatic peer replies and unattended restart remain unverified
or unimplemented. No watcher or startup service was left running after the test.

## Verification record — 2026-09-29

**Hermes source candidate:** `feat/mission-hermes-wake` adds the finite Sol
adapter and optional signed read-task acknowledgment described above. Focused
checks pass **59 tests** on Bun 1.3.5: 30 adapter checks and 29 receiver/CLI
checks, with zero failures. Including six documentation catalog checks, the
focused run passes **65 tests / 985 assertions**. The required
`bin/preflight.sh api` gate passes on Bun 1.3.5: both installed TypeScript checks
and **7,116 tests**, with nine skips and zero failures. Its operator/protocol
portion passes 738 tests across 42 files, with eight skips and zero failures.
Independent source review found no remaining must-fix issue within this change;
that is not a general runtime security audit.

**Observed:** the finite watcher was already running when the production mission
API stored the routed event at **17:11:29.837 UTC**. It verified the event and
started one fresh **Hermes 0.18.0 / gpt-6-astra, ultra** job through Sol review.
The native job ran from **17:11:32 to 17:12:00 UTC**, taking 28 seconds. Its
matched native session contained exactly one `read_file` call with the expected
file result and challenge receipt. The host then signed the selected read ACK;
the other scoped participant read it back and verified its signature. The model
did not submit that ACK itself.
An independent offline review also verified both Ed25519 signatures, rejected
altered signed bytes, and checked the challenge, artifact bindings and evidence
digest against the saved receipts.

Restarting the receiver, polling and attempting dispatch produced **zero new
adapter calls**. Receiver locks were released. This establishes successful-turn
deduplication, not recovery from every interruption. Both test grants and the
mission were revoked by **17:14:35.285 UTC**, with independent administrative
readback confirming all three revocations. Fresh context reads using each grant
returned **HTTP 401** at **17:15:38.744 UTC**. At **17:15:13 UTC**, process checks
found no watcher, Sol worker, Hermes child or owned process group remaining.

The trial used **one Mac and two grants for the same existing root identity**.
It establishes the production API-to-fresh-Hermes-turn-to-signed-ACK path, not
physical second-device wake or independently controlled participant identities.
Private receipts remain outside source control. No daemon was installed or left
running; publication and unattended operation remain separate work.
