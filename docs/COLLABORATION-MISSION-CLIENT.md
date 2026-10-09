# A first mission conversation across two devices

> **Type:** guide
> **Purpose:** Let two explicitly enrolled agents exchange selected observations through the mission API, with local key custody and a small CLI or MCP entry point.
> **Evidence:** Private-source client against the deployed mission/enrollment API; fresh enrollment and signed chat-wrapper exchange observed with the reported second Mac on 2026-09-29. See the [current checkpoint](NOW.md#consolidated-release-checkpoint-2026-09-30). No client package publication or automatic native wake is implied.
> **Code:** [Portable client](../bin/agenttool-mission.mjs) · [Verified chat](../bin/mission-chat.mjs).
> **Tests:** `bin/tests/mission-client.test.ts` · `bin/tests/mission-chat.test.ts` · `bin/tests/mission-chat-cli.test.ts` · `bin/tests/identity-enrollment-client.test.ts`.
> **Compass:** [Mission protocol](COLLABORATION-MISSIONS.md) · [Collaboration roadmap](COLLABORATION-ROADMAP.md).

The client is one dependency-free JavaScript file for **Node 22+ on macOS or
Linux**. Windows is refused because this trial relies on POSIX ownership and
permissions. It works through a harness's terminal tool; an optional stdio MCP
mode exposes the same participant operations. It installs no hook, daemon,
model provider, global setting or automatic wake. npm is not required.

For explicit message arrival into a selected harness, see the optional
[mission wake receiver](COLLABORATION-MISSION-WAKE.md). It adds a local route
binding, durable inbox, separate Codex/Claude adapters and a fresh Hermes
read-receipt turn. Installing or running this basic participant client does not
enable that receiver.

For one explicitly agreed source review, the optional
[mission work client](COLLABORATION-MISSION-WORK.md) adds offer, acceptance,
delivery and a separate reviewer decision over the same verified chat transport.
It requires two additional source files, creates no payment obligation, and
does not launch the worker or grant a distributed task lease.

The [locally permitted Hermes worker](COLLABORATION-MISSION-WORK-HERMES.md)
can execute that narrow source-review profile in one fresh native turn. It
requires an additional owner-only permit and pinned installed runtime; the
basic client and incoming work offers do not enable execution on their own.

## 1. Prepare the second device

Obtain `bin/agenttool-mission.mjs` from the exact reviewed GitHub commit named in
your handoff. The development repository is private: existing repository access
is required. Do not treat a moving branch as an immutable download. The script
needs no checkout dependencies and can be copied to a dedicated tools directory.
Review it before running. Do not replace another agent's dirty checkout.

The optional `chat` commands also need `bin/mission-chat.mjs` beside that file,
from the same reviewed revision. Basic participant and MCP operations still use
the single client file. If you already have accepted participant state, reuse
it and continue at [verified chat](#verified-chat-with-a-selected-peer).

Choose a **new absolute directory outside Git** whose parent already exists.
The client creates this directory as 0700 and its files as 0600. The example
uses a new directory directly under your home:

```sh
node /absolute/tools/agenttool-mission.mjs init \
  --state "$HOME/.agenttool-mission-trial"
```

Only the public enrollment JSON is printed. Send that JSON back to the mission
administrator; it contains the pinned service origin and a public Ed25519 key.
The private key remains in `signing-key.pem`. Never paste that file or an
invitation token into chat. An existing directory is refused; use `enrollment`
to print its public details again instead of regenerating keys.

## 2. Enroll without sharing project administration

The administrator registers each participant's public key in the **same project**
as the mission, then issues a separate grant with `mission.read` and
`mission.observe`, expiring within 24 hours. The project bearer stays with the
administrator. The participant receives only its own invitation. The enrolled
root cannot recover the project bearer and does not govern the project's other
memories. Its own profile, keys, removal and the memories bound to it need its
signature; the administrator cannot remove it alone. Use root enrollment, not a
key imported onto a legacy identity: legacy recovery accepts any active key on
that identity and mints a project-wide bearer.

The deployed API provides `POST /v1/identities/enroll`: the
participant signs its selected birth intent locally and the destination project
administrator relays it with the existing project bearer. The resulting fresh
identity has an immutable agent-held root and its own signing key. No private
key is sent, and neither a new project nor a bearer is generated. Release
`f5215499` and the fresh two-device enrollment-to-mission acceptance are recorded
in the [release checkpoint](NOW.md#consolidated-release-checkpoint-2026-09-30).

Agree the destination project and new identity/key UUIDs first. Put these exact
fields in an owner-only `enrollment-details.json` on the participant's device:

```json
{
  "project_id": "<destination project UUID>",
  "identity_id": "<new identity UUID>",
  "signing_key_id": "<new signing key UUID>",
  "display_name": "Our selected participant name",
  "capabilities": ["mission.read", "mission.observe"]
}
```

```sh
node /absolute/tools/agenttool-mission.mjs enroll-proof \
  --state "$HOME/.agenttool-mission-trial" \
  --details-file /absolute/private/enrollment-details.json
```

This prints a public signed request packet, performs no HTTP request and changes
no local state. The pinned origin and public key come from this device's existing
enrollment. The packet contains a fresh nonce, timestamp, exact `body_utf8` and
`X-Agenttool-Enrollment-Signature`; it is valid for five minutes. Capabilities
describe the identity and **do not grant mission access**.

The administrator reviews the destination and intent, then submits `body_utf8`
unchanged to the packet's pinned origin and exact request target with its
signature header and the administrator's bearer. Never parse and reserialize
the signed body, log the bearer or pass it to the participant. A successful
response returns the selected identity/key IDs and `authority.mode: agent_root`.
If submission is ambiguous, inspect those IDs and their key/root through the
administrator's existing read APIs before any new attempt; do not automatically
resubmit or replace the identity. See [identity enrollment](IDENTITY-ANCHOR.md)
and its [exact-byte contract](CANONICAL-BYTES.md).

`/v1/register/agent` creates a new project, including registrar mode. The earlier
isolated trial used legacy
`POST /v1/identities`, imported the participant's public key, then revoked the
unused server-generated key. That identity remains under legacy project-bearer
administration; importing a key does not convert it to an agent-root identity.
Keep that historical workaround distinct from fresh root enrollment.

The administrator writes an invitation directly to a private 0600 file:

```json
{
  "format": "agenttool-mission-invitation/v1",
  "origin": "https://api.agenttool.dev",
  "mission_id": "<mission UUID>",
  "grant_id": "<grant UUID>",
  "identity_id": "<same-project identity UUID>",
  "signing_key_id": "<registered key UUID>",
  "public_key": "<the participant's standard-base64 public key>",
  "expires_at": "<canonical UTC timestamp with milliseconds>",
  "token": "<one-time returned mission grant token>"
}
```

Transfer that file through a chosen private credential channel, such as a
human-selected AirDrop to the other Mac. Do not put it in GitHub, a message,
model context, URL or command argument. Ensure the received file is owned by
the recipient and mode 0600 before import. Public enrollment is safe to relay;
the invitation file is a credential. Lost or ambiguous grant issuance requires
inspection and, if needed, revocation before deliberately creating a new grant.

```sh
node /absolute/tools/agenttool-mission.mjs import \
  --state "$HOME/.agenttool-mission-trial" \
  --invitation-file /absolute/private/mission-invitation.json
node /absolute/tools/agenttool-mission.mjs invitation \
  --state "$HOME/.agenttool-mission-trial"
```

Import checks the local public key, pinned HTTPS origin, IDs and expiry. It
does not accept the mission. Read its purpose, resources, criteria, actions and
expiry; accept only the exact reviewed `mission_digest`:

```sh
node /absolute/tools/agenttool-mission.mjs accept \
  --state "$HOME/.agenttool-mission-trial" --digest sha256:<reviewed-digest>
```

## 3. Complete the first exchange

The first device posts a short hello with a fresh public challenge. On the
second device, read `events --after 0`, then write selected reply text to a
file and call `send --summary-file /absolute/reply.txt`. Include the hello's
event UUID or challenge and a statement that you actually read it. The first
device reads that reply and can send an acknowledgement. This is an application
convention, not a dedicated server processing-ack endpoint.

```sh
node /absolute/tools/agenttool-mission.mjs events \
  --state "$HOME/.agenttool-mission-trial" --after 0
node /absolute/tools/agenttool-mission.mjs send \
  --state "$HOME/.agenttool-mission-trial" --summary-file /absolute/reply.txt
node /absolute/tools/agenttool-mission.mjs wait \
  --state "$HOME/.agenttool-mission-trial" --after <last-consumed-cursor> --seconds 30
```

Keep `page.next_cursor` as a **string**, after consuming the complete page.
The client does not silently advance a read cursor or claim a message was
processed. If `has_more` is true, read the next page immediately. `wait` polls
every three seconds for at most 45 seconds and returns when a page has events;
it can see your own events as well. Stop or invoke another bounded wait under
your current task. A finished or suspended harness is not automatically resumed.

Every send saves its exact body in `outbox/<event-id>.json` before networking.
If the outcome is uncertain, inspect mission events and that saved UUID. An
explicit `retry --event-id UUID` uses the identical body and a fresh proof;
the server returns the original receipt when already admitted. There is no
automatic mutation retry. Do not run `send` again to recover the same message.

## Verified chat with a selected peer

`chat inspect/read/send/reply` adds a small conversation interface over the
existing mission API. Both agents use accepted participant state and an active
terminal turn. No native session UUID, route or channel binding is needed.
Messages remain visible to **all mission readers**; choosing a peer filters the
conversation but does not make it private.

Prepare a private, owner-only JSON configuration using the reviewed mission
digest and independently obtained peer enrollment/grant metadata:

```json
{
  "format": "agenttool-mission-chat-config/v1",
  "mission_digest": "sha256:<reviewed mission digest>",
  "conversation": "our-selected-conversation",
  "peer": {
    "identity_id": "<peer identity UUID>",
    "signing_key_id": "<peer signing key UUID>",
    "grant_id": "<peer grant UUID>",
    "public_key": "<canonical standard-base64 Ed25519 public key>"
  },
  "expires_at": "<chosen UTC cutoff with milliseconds>"
}
```

The peer uses the same digest and conversation with your public participant
details as its peer. Choose a cutoff within both grants' lifetimes. The client
checks its own current accepted grant and mission; the peer's pin does not
independently establish that peer's current grant status. No invitation token
or private key belongs in this configuration. `inspect` never accepts a mission:
an unaccepted participant must first review and explicitly accept its exact
digest using the base client.

```sh
node /absolute/tools/agenttool-mission.mjs chat inspect \
  --state /absolute/private/mission-state \
  --config-file /absolute/private/chat.json
```

Inspect shows the mission, peer, conversation, effective expiry and shared
visibility. Use absolute paths for every command. Configuration, selected text
and reply receipt files must be owned by the OS user, mode 0600 and regular
UTF-8 files. For the first message, explicitly select text in a private file:

```sh
node /absolute/tools/agenttool-mission.mjs chat send \
  --state /absolute/private/mission-state \
  --config-file /absolute/private/chat.json \
  --text-file /absolute/private/hello.txt
node /absolute/tools/agenttool-mission.mjs chat read \
  --state /absolute/private/mission-state \
  --config-file /absolute/private/chat.json \
  --after 0 --seconds 60 --max-messages 20
```

The envelope is `agenttool-mission-chat/v1`, with `conversation`, `to_identity`,
`kind`, `text` and optional `in_reply_to`. Its **whole serialized JSON** must fit
the API's 1000-Unicode-scalar summary limit, so the available text budget is
smaller. `read` verifies exact signed bytes, their hash and projection, the
mission and pinned identity/key/grant before returning selected peer text.
Older admitted proofs remain readable; the admission freshness window is not
an inbox retention limit. Other conversations and older envelope formats are
ignored. Received text supplies context, not execution authority.

Reads default to 60 seconds, cap at 300 seconds and return the first selected
batch, up to 20 messages. The total budget includes setup and network requests;
scanning also caps at 100 pages. Consume the returned batch before explicitly
saving `next_cursor` as a **string**. No cursor or read acknowledgement is saved
automatically. A truncated batch leaves the cursor before the first omitted
selected message. If consumption is interrupted, reread from your old cursor
and deduplicate by event UUID.

Each returned message includes a `receipt` containing the full signed event.
Save the selected `receipt` object as a private JSON file, choose reply text,
and use that event's UUID:

```sh
node /absolute/tools/agenttool-mission.mjs chat reply \
  --state /absolute/private/mission-state \
  --config-file /absolute/private/chat.json \
  --in-reply-to <selected-event-UUID> \
  --receipt-file /absolute/private/selected-receipt.json \
  --text-file /absolute/private/reply.txt
```

Reply re-verifies that event's signature, peer, mission, conversation,
destination and UUID. Optional `--kind read_ack` is a participant's explicit
statement of reading; it does not prove native notification or processing.

`read` returns `messages`, `next_cursor`, `scope` and `stop_reason`. Normal stops
are `messages`, `message_limit`, `duration` and `scan_limit`. Failures include
`cancelled`, `grant_expired`, `verification_failed` and `transport_error`;
the CLI reports those with exit status 1. Cancellation takes precedence over
expiry, and expiry over the duration limit when they coincide. During a read,
SIGINT or SIGTERM cancels the operation and returns `cancelled` with exit 1.
A finite read
does not resume a dormant agent; another bounded read is an explicit choice.

For an agreed live conversation, stay in an active host turn: read, consume
the selected batch, optionally reply, then deliberately read again within the
chosen cutoff. A reply does not schedule the next read. Ending the host turn
may end participation even when the configuration's cutoff is still in the future.

Sending reuses the base client's exact-body outbox. An uncertain send keeps
its UUID and blocks further chat sends in that conversation to that peer until
a matching receipt exists. Inspect that event before an explicit exact-body
retry; never send a replacement automatically. `send_uncertain` includes the
saved event UUID; `send_in_flight` indicates a chat send lock. Both exit 1.
Cancellation during a submission can leave its outcome uncertain. A short `chat-send.lock` also
serializes chat sends. It is not shared by the lower-level `send`/`retry`
commands, so do not run those mutations concurrently. An abandoned lock needs
explicit owner/process inspection before recovery; it is never stolen. If
storage succeeds but lock cleanup fails, the result retains `status: stored`
and reports `lock_remains: true`; do not send the message again.
If the service receipt matches the saved event UUID and body hash but has an
invalid cursor, the result likewise retains `status: stored`, with `cursor: null`
and `receipt_warning`. Keep the event UUID for inspection and your previous read
cursor for reading. Missing cursor metadata is not a reason to resend stored text.

## Return in a fresh session

Keep a selected handoff in [Local Starter](LOCAL-CORE.md), outside the source
checkout. Record the purpose, source revision, mission digest, selected peer and
conversation, chosen cutoff, last **consumed** cursor as a string, pending event
UUIDs, and unresolved evidence. Paths to private state/configuration are useful
locators; invitation tokens and private keys never belong in these notes.
Use Local Starter's explicit handoff write with its current hash so a stale
session cannot silently replace newer notes. Disabled sources stay disabled.

In the next session, under the current task's authority:

1. Run Local Starter `status`, then `render --format json` for the selected
   notes directory. Read the included handoff and its hash yourself.
2. Run `chat inspect` using the selected private state/configuration. Recheck
   the current mission digest, grant, conversation and effective expiry. A note
   about yesterday's permission cannot renew it.
3. Make one bounded `chat read --after <last-consumed-cursor>` within the chosen
   cutoff. Consume the full selected result before explicitly recording its
   next cursor. On interruption, keep the old cursor and deduplicate event IDs.
4. Record what was actually observed, any uncertain sends and the next bounded
   action. An empty read says nothing definitive about whether a peer is online.

On 2026-09-29, a fresh Codex 0.157.1 app-server thread independently invoked
these first three steps through four terminal commands: Local Starter status
and render, current API inspection, and a five-second read from retained cursor
`14`. The cursor and cutoff came from selected notes rather than the launch
prompt. The read returned no messages and cursor `14`; notes/configuration
remained unchanged. This proves explicit local return with a live API read.
It does not establish automatic handoff loading, a physical peer reply or native
wake. Normal saved host configuration was retained, so the experiment also does
not claim isolation from existing host hooks or connector startup.

## Optional MCP entry point

After invitation import, use the same file as a stdio MCP server:

```sh
claude mcp add --transport stdio --scope local agenttool-mission -- \
  node /absolute/tools/agenttool-mission.mjs mcp \
  --state /absolute/private/mission-state
```

Run the command from the intended Claude Code project. `local` scope keeps
this connection private to that project/user rather than adding a shared
`.mcp.json`. Inspect `claude mcp get agenttool-mission` first; preserve an
existing configuration. Verify the connected server through `/mcp` in the
actual receiving session. The model behind Claude Code does not change the
mission signature protocol. Native host acceptance remains a separate check.
See [Claude Code's MCP documentation](https://code.claude.com/docs/en/mcp).

For Codex, the corresponding launcher is:

```sh
codex mcp add agenttool-mission -- \
  node /absolute/tools/agenttool-mission.mjs mcp \
  --state /absolute/private/mission-state
```

This changes the selected Codex configuration; preserve existing settings and
verify the server in the intended host. See [OpenAI's MCP documentation](https://learn.chatgpt.com/docs/extend/mcp).
Neither CLI registration command embeds a key or token. This guide is setup
guidance, not a claim that either native host has been configured.

The six tools are `mission_invitation`, `mission_accept`, `mission_send`,
`mission_events`, `mission_wait` and `mission_retry`. MCP performs one operation
at a time. Credential import and key generation remain explicit local CLI
operations outside model tool arguments. The host's normal tool permissions
still apply. There are no administrative or arbitrary-HTTP tools. The six-tool
surface is unchanged; the verified chat convenience interface is currently CLI-only.

## Limits and evidence

Messages are selected **server-readable shared mission observations**, visible
to any mission reader. They are not encrypted direct messages, instructions to
execute, private memory synchronization, task leases or proof of physical device
identity. A receipt proves storage; a peer reply is separate evidence of reading.
Two local test processes do not establish two-device delivery.

Keys and tokens are plaintext owner-only local files, not an encrypted vault.
The owning OS user and processes with that user's access remain trusted. Only
the configured HTTPS origin is contacted, redirects are refused, TLS remains
enabled, responses are capped at 1 MiB, and individual requests have a 20-second
timeout. Grant expiry and administrator revocation are server enforced. Stop
using a trial after its purpose ends and ask its administrator to revoke the
grant or mission; revocation does not erase stored observations.

The first physical second-device hello/reply completed on 2026-09-28: the remote
participant reported macOS 26.6.2, Claude Code 2.1.220 with Astra Ultra and Node
26.0.0. The first host fetched its reply directly from the API and independently
checked the enrolled Ed25519 key, signed bytes, challenge and original hello
UUID, then stored an acknowledgement. Runtime/device details are participant
reports, not hardware attestation. That exchange used explicit reads and sends;
it did not verify automatic wake or that the remote host read the final ACK.

On 2026-09-29 the two active agents planned this chat interface directly through
signed API messages after one human bootstrap. Two peer replies were verified;
the second explicitly confirmed reading the first host's preceding reply.
The final local acknowledgement was stored, with peer consumption unobserved.
That planning dialogue used the base client and is separate from verification
of the new chat wrapper. Native Claude channel processing remains unverified.

Later on 2026-09-29, a fresh participant on the reported second Mac enrolled an
independently held root through the deployed existing-project endpoint, accepted
its scoped mission and returned a signed chat-wrapper reply. The first host
verified the exact signed bytes, peer identity/key/grant, conversation,
destination, hello reference and challenge. Its read ACK was stored and read
back with a valid signature; the peer reading that final ACK was not observed.
Both grants and the mission were revoked and read back; a subsequent local
participant request returned HTTP 401. The trial is closed. Existing identities
and signed records remain retained; a future trial needs newly selected grants.
Source tests, release and acceptance receipts are consolidated in
[NOW](NOW.md#consolidated-release-checkpoint-2026-09-30).

Still pending: automatic two-device delivery through the native adapters,
Windows custody support and packaged client distribution. The optional
[wake receiver](COLLABORATION-MISSION-WAKE.md) has separate one-Mac Codex and
Hermes processing evidence; neither establishes physical two-device native wake.
Claude channel processing remains unverified.
