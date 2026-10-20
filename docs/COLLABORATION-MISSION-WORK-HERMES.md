# One locally permitted Hermes source review

> **Type:** guide
> **Purpose:** Start one finite worker before an exact mission offer arrives, let a fresh Hermes turn read only the selected source snapshot, and submit a verified artifact for separate review.
> **Evidence:** Tested source candidate, 2026-09-30. Verification and live outcomes belong in the repository work log; this guide alone establishes neither a running worker nor a published package.
> **Code:** `bin/mission-work-hermes.mjs` · `bin/mission-work-hermes-runner.py` · `bin/mission-work-hermes-runtime.json` · `bin/mission-work.mjs`.
> **Tests:** `bin/tests/mission-work-hermes.test.ts` · `bin/tests/mission-work-hermes-runner.test.ts`.
> **Related:** [Work terms and review](COLLABORATION-MISSION-WORK.md) · [Mission setup](COLLABORATION-MISSION-CLIENT.md) · [Native read receipts](COLLABORATION-MISSION-WAKE.md) · [Roadmap](COLLABORATION-ROADMAP.md).

This profile automates one agreed task: read the exact selected UTF-8 source
and return two short, cited observations. The operator first selects the work
contract and writes a private local permit. An already running, finite host
watcher can then receive the signed offer, accept its exact terms if permitted,
start a fresh Hermes turn, validate the result and sign delivery. The requester
still reads and accepts or rejects the result separately.

```text
local permit + selected source + finite host watcher
  → verified offer → permitted acceptance → fresh Hermes turn
  → validated source observations → signed delivery → separate review
```

The local permit is operator-selected filesystem authority, not a signed
cross-agent grant. Mission grants authorize the API calls; the work contract
binds the task terms; the local permit authorizes this particular execution.
Possessing any one of these does not supply the others. Incoming messages
cannot choose another source, tool, model, provider, runtime path or task.

## What Hermes can do

The host captures the selected source bytes and checks their exact length and
SHA-256 against the contract. The worker receives a fresh context with one
tool, `read_selected_source`, whose only valid arguments are `{}`. It returns
that immutable snapshot and a fresh host challenge. There is no model-selected
filesystem path and no model file-write tool. The host saves the artifact only
after validating the result.

The runner replaces the native tool-batch dispatch for this profile. It checks
the whole batch before supplying any tool result and rejects unknown tools,
nonempty arguments and alternate execution entrypoints. Ordinary tool hooks
and middleware are not the enforcement boundary: their error handling may
continue execution. Native name repair, delegation, memory, terminal, search,
MCP and alternate app-server execution must not widen the single-tool profile.

Automatic project context, saved memory and SOUL injection are disabled for
this fresh worker. That is a per-job choice; the normal Hermes configuration
and continuity files stay in place. The native provider and saved authentication
remain selected through the existing installation. The worker receives no
mission key, grant token or API client. There is no provider or billing fallback.

This is a boundary on **model-selected tool effects**, not an OS sandbox.
Installed Python, Hermes, provider/authentication code and their dependencies
remain trusted. They still need their own files and network access to run the
model. A selected native compatibility fingerprint detects drift in the
reviewed execution seam; it does not certify the entire installation. Existing
native modifications are preserved and identified rather than silently reset.

## Prepare the local permit

For a standalone copy, keep these seven reviewed files together: the work
client's `agenttool-mission.mjs`, `mission-chat.mjs`, `mission-work.mjs` and
`mission-work-contract.mjs`, plus `mission-work-hermes.mjs`,
`mission-work-hermes-runner.py` and `mission-work-hermes-runtime.json`.

Use an already accepted mission participant whose pins match the contract's
worker. Transfer and review the client/source before starting a short-lived
mission window. Confirm the separate private invitation arrived on the receiving
device; a sender's local path is not a receiving-device path.

The worker's permit is an owned regular file with mode `0600`. Its closed shape
is:

```json
{
  "format": "agenttool-hermes-work-permit/v1",
  "permit_id": "<new UUID>",
  "task_id": "<exact contract task UUID>",
  "terms": "sha256:<exact work contract digest>",
  "worker": {
    "identity_id": "<worker identity UUID>",
    "signing_key_id": "<worker signing-key UUID>",
    "grant_id": "<worker grant UUID>",
    "public_key": "<worker Ed25519 public key>"
  },
  "source_file": "/absolute/selected/source.md",
  "expires_at": "<canonical UTC cutoff no later than the contract>",
  "allowed_stages": ["accept", "deliver"],
  "runtime": {
    "kind": "hermes-selected-source/v1",
    "python_executable": "/absolute/hermes/venv/bin/python",
    "hermes_root": "/absolute/hermes/source"
  },
  "limits": {
    "duration_seconds": 300,
    "max_jobs": 1,
    "max_deliveries": 1
  }
}
```

`["deliver"]` is also supported when exact work acceptance is already recorded.
There is no permit for review. The source digest, mission, instruction and
acceptance criteria are already covered by `terms`. The native runtime must
match the shipped compatibility pin; a new native version needs deliberate
review and a new pin, not an automatic upgrade during execution.

```sh
node /absolute/tools/agenttool-mission.mjs work inspect-hermes \
  --state /absolute/private/state --contract-file /absolute/private/work-contract.json \
  --permit-file /absolute/private/hermes-permit.json
node /absolute/tools/agenttool-mission.mjs work run-hermes \
  --state /absolute/private/state --contract-file /absolute/private/work-contract.json \
  --permit-file /absolute/private/hermes-permit.json
```

Start the finite watcher before the requester sends the offer. Its duration is
clamped to the permit and work cutoff. This starts one explicit process; it
does not install a daemon, log-in service, gateway, OS wake or resume an existing
interactive session. A fresh Hermes session ID is evidence of the new worker.

The [private mission-receiver pause](COLLABORATION-MISSION-WAKE.md#private-pause-and-free-return)
does **not** control this work watcher. Its permit, owned process and finite
deadline remain a separate scope. Pausing a read-receipt route therefore makes
no claim that this worker stopped accepting, running or publishing its selected
work. Use this worker's own interruption procedure and preserve its attempt
evidence; a pause elsewhere neither cancels the contract nor authorizes retry.

## Delivery evidence and interruption

Before native admission, the host saves a durable attempt binding the exact
permit, terms, accepted event, source snapshot, challenge and runtime selection.
The local attempt prevents another automatic launch, including after restart
or when a replacement permit file is supplied. This is a local replay barrier;
it is not a lease across devices or copied states.

The runner requires a complete native turn and saved evidence of the actual
pathless source read. The final model response contains exactly the challenge
and the two-observation artifact. The host checks those bindings, the native
evidence, the source quotations and the current work state before delivery.
An output string, job ID or process exit alone cannot establish success.

Forbidden tool requests, missing source reads, mismatched snapshot or runtime,
expired/revoked scope, cancellation and ambiguous admission stop publication.
Known owned child processes have bounded shutdown. Uncertain completion does
not authorize a second model run. Even an interrupted pre-offer attempt needs
explicit inspection; there is no automatic attempt reset.

A native transport failure can occur after a verified source read. That read
does not establish a completed answer, and a broken connection leaves the
provider's outcome uncertain. Keep the selected job's private evidence. Any
later trial is a separate operator decision with new work and a new permit
after inspecting and closing the old trial; do not erase its replay barrier.

The source is captured once: a later edit to the on-disk file does not change
the already verified snapshot or its contract digest. Service cancellation and
revocation are checked at admission and before publication. They do not
continuously interrupt an already running native turn; local cancellation and
the finite deadline stop its owned process group.

The existing work client's durable send rules still apply. A lost delivery
response keeps the exact outbox event for inspection. `stored_sync_required`
means stored: synchronize evidence rather than replace the message. The
returned `work_stage` distinguishes acceptance from delivery. If acceptance
needs synchronization, no native job starts and the attempt remains consumed.
The
requester uses ordinary `work sync` and `work review`; the worker has no authority
to approve its own artifact. Quotes matching the file do not prove that their
interpretation is useful or correct.

The older [Hermes wake read-receipt adapter](COLLABORATION-MISSION-WAKE.md)
remains a separate profile. Its six-field arrival ACK does not become a work
artifact, and this narrow worker does not retroactively sandbox that adapter or
general Hermes sessions.
