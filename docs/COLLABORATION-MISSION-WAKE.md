# Deliver a mission message to a chosen session

> **Type:** guide
> **Purpose:** Route selected, signed mission observations to an explicitly bound local harness, with a finite receiver and inspectable acknowledgment.
> **Evidence:** Source candidate, 2026-09-28, on `feat/mission-session-wake`; not a published package or deployed wake service. A live API-to-Codex trial passed on one Mac; Claude Code 2.1.220 with Astra remains unverified. See the verification record below.
> **Code:** Private source: `bin/agenttool-mission-wake.mjs`, `bin/mission-wake-receiver.mjs`, `bin/mission-wake-codex.mjs`, `bin/mission-wake-channel.mjs`, and `bin/agenttool-mission.mjs`.
> **Tests:** `bin/tests/mission-wake-channel.test.ts`, `bin/tests/mission-wake-receiver.test.ts`, `bin/tests/mission-wake-codex.test.ts`, `bin/tests/mission-wake-cli.test.ts`, and `bin/tests/mission-client.test.ts`.
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

Each independent receiving session needs its own explicitly enrolled private
participant state and binding. One receiver owns that state at a time. These
routes do not create private direct messages: every permitted mission reader
can read the stored envelope, including its text and destination.

## Prepare and bind once

Use **Node 22+ on macOS/Linux**. Copy all five source files listed above into one
directory from the same reviewed commit. Source access is currently private;
obtain the exact commit and files through the agreed handoff. No npm install or
repository dependencies are needed. Windows is outside this POSIX trial.

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
channel does not publish a reply; neither adapter's local processing receipt
automatically returns a peer acknowledgment through the API. Use the separately
configured participant tools or CLI for a selected response. Notifications may be silently
dropped, so writing to stdout cannot prove processing. See the [channel
contract](https://code.claude.com/docs/en/channels-reference).

Both receivers default to 60 seconds, accept at most 900 seconds, and stop on
their deadline, interruption or transport failure. A Claude channel also stops
on stdin closure. No automatic restart occurs. The finite process must be
started again explicitly; a closed host still needs a separately authorized
lifecycle mechanism. This does not provide an always-on wake service.

## Receipts, revocation and recovery

| State | Evidence and limit |
|---|---|
| API `stored` | The signed observation was admitted; no recipient-read claim. |
| Local `pending` | Verified message saved for this binding. |
| Local `dispatching` | Durable delivery intent saved before a harness call; its effect may be uncertain. |
| Local `delivered` | Claude notification transport write completed; processing is still unconfirmed. |
| Local `processed` | Exact Claude acknowledgment tool call, matching exact structured acknowledgment from a completed Codex turn, or explicit operator resolution. This is not task success or independent proof of understanding. |

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
