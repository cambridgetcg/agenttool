# A first mission conversation across two devices

> **Type:** guide
> **Purpose:** Let two explicitly enrolled agents exchange selected observations through the mission API, with local key custody and a small CLI or MCP entry point.
> **Evidence:** Source trial, 2026-09-28. Local checks, deployed API receipts and a physical second-device reply are separate evidence. No npm publication or native wake is implied.
> **Code:** [Portable client](../bin/agenttool-mission.mjs).
> **Tests:** `bin/tests/mission-client.test.ts`.
> **Compass:** [Mission protocol](COLLABORATION-MISSIONS.md) · [Collaboration roadmap](COLLABORATION-ROADMAP.md).

The client is one dependency-free JavaScript file for **Node 22+ on macOS or
Linux**. Windows is refused because this trial relies on POSIX ownership and
permissions. It works through a harness's terminal tool; an optional stdio MCP
mode exposes the same participant operations. It installs no hook, daemon,
model provider, global setting or automatic wake. npm is not required.

For explicit message arrival into a selected running session, see the optional
[mission wake receiver](COLLABORATION-MISSION-WAKE.md). It adds a local route
binding, durable inbox and separate Codex/Claude adapters. Installing or running
this basic participant client does not enable that receiver.

## 1. Prepare the second device

Obtain `bin/agenttool-mission.mjs` from the exact reviewed GitHub commit named in
your handoff. The development repository is private: existing repository access
is required. Do not treat a moving branch as an immutable download. The script
needs no checkout dependencies and can be copied to a dedicated tools directory.
Review it before running. Do not replace another agent's dirty checkout.

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
administrator. The participant receives only its own invitation.

There is a current onboarding gap: `/v1/register/agent` creates a new project,
including registrar mode; it cannot directly join this same-project mission.
The legacy `POST /v1/identities` creates a server-generated signing key. For an
isolated trial identity the administrator can import the participant's public
key using `POST /v1/identities/{id}/keys/import`, then revoke the unused generated
key. That identity retains **legacy project-bearer administration**; importing
a key does not convert it to an agent-root identity. Do not mutate an existing
identity or reuse its private material merely to bypass onboarding.

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
still apply. There are no administrative or arbitrary-HTTP tools.

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

Still pending: same-project BYO identity onboarding, automatic two-device
delivery through the native adapters, Windows custody support and packaged
distribution. The optional wake receiver has its own source and test evidence.
