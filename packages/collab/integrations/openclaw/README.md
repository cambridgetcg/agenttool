# Explicit OpenClaw connection example

> **Compass:** [Collab boundary](../../README.md), [coordination skill](../../skills/coordinate-agent-work/SKILL.md).
> **Implements:** An operator-selected local MCP connection example, not a native lifecycle adapter.
> **Code:** `../../src/mcp.ts`, `../../dist/agenttool-collab-mcp.js`.
> **Tests:** `../../tests/events-wait.test.ts`, `../../tests/package.test.ts`.

**RELEASE CANDIDATE 0.5.0, 33 tools.** These release-candidate bytes do not establish
npm publication; verify the protected receipt and registry separately.
Published 0.4.0 has 32 tools and no
`collab_events_wait`. This example has not been exercised in live OpenClaw.
It installs no plugin, service, heartbeat, global configuration or channel.

## Host-owned connection

Use an explicitly selected MCP-capable adapter in the chosen OpenClaw profile.
Confirm that adapter's supported stdio configuration and cancellation behavior;
this package does not invent a native OpenClaw MCP configuration schema. If
that adapter is unavailable, report the missing connection rather than claiming
OpenClaw received feedback.

The following is an illustrative **stdio process declaration**, not a file to
copy into OpenClaw's global configuration. Replace the placeholders only after
the operator selects a local package, private state directory and journal:

```json
{
  "command": "bun",
  "args": ["/absolute/local/collab/dist/agenttool-collab-mcp.js"],
  "env": {
    "AGENTOOL_COLLAB_DB": "/absolute/private/state/collab.sqlite"
  }
}
```

The host should launch with a scrubbed environment and only required executable
paths/runtime settings; the illustrative `env` map does not itself guarantee
that an adapter clears inherited credentials. No provider token, wallet key,
channel credential or remote URL is needed for local Collab. Keep credentials
and host-only paths out of model-visible text.

Use the same local database as the cooperating Claude/Codex/Hermes MCP
processes. Each independently attributed child needs its own MCP process and
`collab_session_start`; a shared endpoint exposes one coordination binding,
not an independently identified fleet. Verify the intended workspace and the
33-tool inventory after connecting. Native tool-name prefixes depend on the
selected adapter; the names below are the underlying MCP names.

## Status, queue, receive, acknowledge

1. **Status:** start a credential-bound session once, then inspect
   `collab_workspace_status` and `collab_next`. Optional
   `collab_session_list` presence is self-declared routing, not identity,
   health, availability or consent. `collab_anchor_status` is a local sidecar
   observation, not a fresh remote chain check.
2. **Queue:** only a separately configured private courier can queue an
   explicitly selected concise report for a named enrolled destination. This
   package has no courier queue or channel send tool. Queueing is not sending;
   remote arrival creates no local lease, accepted review or task authority.
3. **Receive:** while already running, call `collab_events_wait` with the bound
   `workspace_id` and exact `after_anchor: { epoch_id, sequence, hash }` from a
   prior page/session cursor. `event_limit` defaults to 10, maximum 50;
   `wait_ms` defaults to and cannot exceed 30,000 (zero reads immediately).
   `structuredContent` is an event-only `JournalPage`. Continue from
   **`next_anchor`, never the head**, and follow `has_more`. Empty timeout is
   not an event. A page is capped at 256 KiB UTF-8 JSON and the complete tool
   JSON at 1 MiB. Stop at `event_too_large` and select an explicit larger-read
   workflow; never skip or acknowledge the blocked event. After processing and
   explicit acknowledgement, waiting can resume only if each persisted, host,
   and observation anchor fits a separate 8 MiB stored payload-plus-metadata
   validation ceiling. Canonical digest checks remain intact. Above that bound,
   `event_anchor_too_large` needs operator reconciliation, never skipped
   verification or automatic reset. Bundled stdin EOF/close aborts waits.
   A busy deadline returns `event_read_busy`, not false success.
4. **Acknowledge:** only after actually processing events, explicitly use
   `collab_cursor_ack`. Waiting does not acknowledge, write `last_seen`, refresh
   presence, expire handoffs or renew leases. Acknowledgement is processing,
   not agreement, acceptance, consent, execution or chain observation.

Use a finite host budget and cancel the MCP request or close the endpoint to
stop. Stop on corruption, fork, rollback, session fencing or recovery required;
do not reset or replace a session automatically. Resume with the host-only
`AGENTOOL_COLLAB_SESSION_FILE` path; never ask the model to read its bearer.
Resolve live leases before deliberate `collab_session_end`.

## Preserve native boundaries

Leave OpenClaw's `SOUL.md`, `IDENTITY.md`, `USER.md`, memory, dispatcher,
permissions and lifecycle intact. No persona or continuity claim is required.
This example neither installs native idle wake nor interrupts a suspended
harness. Request/transport arrival proves neither model reading nor consent.
Presence TTL and witness sidecar changes require separate explicit reads; they
are not journal wake events.

Do not take over an existing OpenClaw/Hermes bot's polling stream or webhook.
Telegram feedback requires one separately designated receiver and selected
audiences. External feedback remains attributed untrusted data, never a command
or inherited authority. No incoming text automatically exports a report,
anchors a journal, uses a wallet, signs, pays or rebroadcasts.

The journal is local unencrypted plaintext without selective retention or
secure deletion. Reports are workspace-readable; addressed reports are not
private. MCP arguments/results can reach the active model provider. Keep raw
journals, private state, transcripts, credentials and sensitive source out of
exports. Private courier enrollment, pause/revoke, disclosure and restart
reconciliation remain host choices outside this example; its separate
transport ledger is not the agent's processing cursor or task truth.
