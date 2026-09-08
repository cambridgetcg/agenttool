# Private Collab courier — unreleased source candidate

> **Compass:** [Collaboration channels](../../docs/COLLABORATION-CHANNELS.md) · [Correspondence](../../docs/AGENT-CORRESPONDENCE.md)
> **Implements:** explicitly selected report/reply transport; no distributed task authority.
> **Code:** `src/{binding,ledger,importer,correspondence,courier,host,telegram,witness}.ts` · `bin/agenttool-collab-courier.ts`
> **Tests:** `tests/{courier,boundaries,cli,telegram,witness}.test.ts`

Each device retains its own canonical Collab journal. This private Bun 1.3.5
package composes published `@agenttool/sdk@0.22.1` signing/list contracts with a
host-selected local Collab MCP process. It publishes nothing, installs no service,
changes no harness configuration, and activates no channel on import or install.

## Disclosure and authority

- Export is an operator-selected **1–1,000 Unicode-scalar summary**, never a report
  body, workspace dump, prompt, transcript, secret, or encrypted Inbox message.
- Correspondence is **project-readable**, not private to the destination alias.
  The alias fixes one thread and independently pinned peer; it is not encryption
  or an access-control list. A project bearer remains broad project authority.
- Telegram bot conversations are not end-to-end encrypted. The service and a
  receiving harness/model provider may receive selected text and identifiers.
- Remote arrival is an `observation` report, confidence `unknown`, authority
  `none`. Signature verification establishes signed bytes, not truth, consent,
  identity continuity, a task lease, Git review, agreement, or model attention.
  External text remains prompt-injection-capable data and is never executed.
- Handoff offers can be **selected summary text**. There is no remote
  `collab_handoff_offer/accept`, task-state replication, or lease transfer.
  No new `handoff` wire fields are invented.

## Explicit setup (not performed by tests)

Use [the disabled example](examples/profile.disabled.json) as a schema template,
not an enrolled configuration. All IDs, zero public keys, paths and endpoint are
placeholders. Before enabling a real host, name the disclosure audience, endpoint,
repository mapping, registered sender and peer keys, expiry, receiver owner, and
stop boundary. Use an independently obtained **complete sender tuple**:
identity ID, signing-key ID, device ID, session ID, plus the public key.
Incoming records never supply a verification key.

The host must first enroll a **dedicated existing Collab coordination session**
through its own local MCP setup. Copy its workspace ID, exact returned
`repository_key` (not the pre-hash input), session ID and explicit credential-file
path into the private binding. Do not use a harness session's token. No courier
command births or replaces sessions. Resume increments Collab's fencing generation
but retains its session ID and idempotency namespace.

The binding pins an absolute Bun binary, `runtime: "bun"`, and exactly one absolute
MCP entrypoint in `local.args`. Node is explicitly unsupported: the existing
Collab bundle still imports `bun:sqlite`. Each child gets a fresh
mode-0700 runtime directory under the explicitly bound, owner-only `local.home`.
That directory is its cwd, HOME and XDG_CONFIG_HOME; Bun also receives
`--no-env-file --config=/dev/null`. This prevents ambient workspace/home Bun
configuration preloads from replacing the selected MCP before its handshake.
The child still uses the absolute bound DB/session paths and verifies the
resumed workspace's root; it does not discover a workspace from cwd. Runtime
directories are removed on close/startup failure; an uncatchable parent crash
can leave an orphan for explicit host cleanup. The handshake must return exactly
the selected `0.4.0`
or source `0.4.1-dev.0` version. Only dedicated DB/session references, isolated
HOME/XDG_CONFIG_HOME, fixed PATH and TMPDIR reach the child. No network secret
enters model-facing Collab tools. This is configuration/environment narrowing,
not a sandbox for a malicious host binary or local filesystem owner.

Keep the profile and credential file mode 0600, and delivery/ownership DBs in
owner-only mode-0700 directories on a local filesystem. Supply trusted,
symlink-free ancestor directories; checks cover final files and immediate ledger
parents, not a hostile ancestor replacement. SQLite locks are local, not network
or cross-device exclusivity. POSIX process groups are required; Windows is refused.
Do not share one Correspondence sender session across independent ledgers.

`telegram: null` disables the Telegram path. To configure it deliberately, use
`{botId, token:{env:"NAMED_BOT_TOKEN"}, ownerPath, receiverOwnershipConfirmed:true}`
and a destination `{alias,kind:"telegram",chatId,topicId:null|number,senderIds,
expiresAt,revoked}`. All local invocations for that bot must use the same ownerPath.
An operator must establish that no other host/harness owns polling. Telegram does
not expose a reliable preflight for another nonoverlapping polling client; API 409
conflicts fail closed. Active webhooks are checked and **never deleted**.

## Finite operator workflow

Run the executable from a trusted launcher with a clean cwd/HOME, or invoke Bun
explicitly with `--no-env-file --config=/dev/null` under that same clean host
environment. Child isolation starts only after this CLI runs; a hostile preload
in the operator's own launcher cannot be repaired from inside the selected script.
The example below uses already-selected placeholder values; it is not activation.

```sh
bun --no-env-file --config=/dev/null /opt/agenttool/packages/collab-courier/bin/agenttool-collab-courier.ts \
  status --profile /srv/private-courier/profile.json

# Feed only the chosen summary on stdin, not the source report or credentials.
bun --no-env-file --config=/dev/null /opt/agenttool/packages/collab-courier/bin/agenttool-collab-courier.ts \
  select --profile /srv/private-courier/profile.json \
  --idempotency-key operator-selection-001 --destination fleet \
  --report report_existing --sequence 42 --expires-at 1800000000000 \
  --summary-stdin < /srv/private-courier/chosen-summary.txt

# Only these commands load the explicitly named network secrets from environment.
bun --no-env-file --config=/dev/null /opt/agenttool/packages/collab-courier/bin/agenttool-collab-courier.ts \
  run-once --profile /srv/private-courier/profile.json
bun --no-env-file --config=/dev/null /opt/agenttool/packages/collab-courier/bin/agenttool-collab-courier.ts \
  watch --profile /srv/private-courier/profile.json --for 30s
```

Use a current expiry within seven days and no later than binding/destination
expiry. Retain the **same selection key and exact arguments** after a lost CLI
response; an exact retry returns the prior selection, changed content conflicts.
A new key is a new deliberate disclosure. `--parents` accepts comma-separated
already-known Correspondence event IDs for an explicitly selected return reply.

`status` is redacted local counts and timestamps; no MCP, credential lookup or
network probe. It can initialize the private delivery ledger on first use.
`select` checks the exact report ID and event sequence through the bound local
MCP, then discards source content. It checks the current binding against the
ledger's frozen scope both before and after asynchronous source validation;
profile changes while waiting for stdin cannot enqueue a different audience.
Direct callers with reloadable profiles pass `() => readBinding(path)` to
`selectReport`, rather than a stale snapshot. It loads only the explicitly bound local
session token through the importer, never ambient/network credentials. It does not
send. Run/watch acquire ledger and optional bot ownership **before** resuming MCP.
Direct host API users must likewise hold `ownRunner` before opening `McpImporter`.
The CLI has no network-secret argv flags and emits only closed redacted failures.
One invocation deadline includes MCP startup, stdin and watch work; shutdown waits
use only the remaining budget (at most 500 ms). Cleanup of network, importer,
ledger and ownership is attempted independently, even if one cleanup fails. The
host imports the real installed Undici entrypoint, not Bun's incomplete shim;
its direct dispatcher never inherits an ambient proxy or payer.

## Delivery, replay and crash recovery

- Selection → queued → exact signed bytes plus reserved sequence → attempting →
  provider accepted. Correspondence retries POST the **persisted serialization and
  event ID**, never re-sign. A receipt is not current key authorization, agent
  acknowledgement or agreement.
- Each bound repository/thread destination has a separate canonical decimal
  receipt cursor, not Collab's processed-event cursor. Reads call SDK `list` with
  `require_verified:true` and independently pinned complete sender tuples. Pages
  must match project/repository/thread, ordering, limit, and exact next cursor.
  Count, duplicate IDs and event byte bounds are checked before SDK crypto;
  verification yields between events under one whole-page deadline.
- Imports persist their exact request, source provenance and session ID **before**
  MCP append. Append uses the same session and idempotency key on every retry.
  The report receipt is durable before advancing Correspondence's receipt cursor.
  External event/parent locators live in `confidence_basis` and the private ledger;
  `evidence_refs` stays empty because Collab requires existing local evidence IDs.
- Self echoes are durable rejected dispositions; duplicate receipts/imports are
  suppressed. Nothing automatically re-exports imported reports. Returning feedback
  requires a fresh explicit summary selection, optionally naming its parent event.
- Telegram stores attempting before send. A crash or uncertain provider outcome
  becomes sticky **ambiguous**, never a blind retry. Only explicit rejected 429s
  with validated retry-after can requeue, with at most three send attempts. Backoff
  persists between finite runs; no sleep past the run budget is required. Future
  retries are skipped before selecting eligible outbound work. A durable rotating
  next-turn position shares the item budget across imports, outbound destinations,
  receipt-replay destinations and Telegram ingress, including one-item restarts.
- Telegram accepted/rejected ingress is committed atomically with the next polling
  offset. Accepted ingress contains the exact pending import request before offset
  advancement. A restart repairs imports even when the polling offset is already
  advanced. Wrong bot/chat/topic/sender/reply/expiry, edits and unsupported updates
  are rejected without retaining their text. No callbacks, commands, paid
  broadcasts or automatic forwarding exist.
- Wake SSE carries disposable invalidation hints only. Startup, every reconnect,
  and bounded periodic sweeps replay receipts even without hints. Blocked reads are
  cancellable. No idle-harness interrupt or model reception is claimed.

Profile changes are rechecked at operation boundaries; pause with `enabled:false`
or revoke a peer/destination. In-flight requests cannot be recalled; their finite
request/stream deadlines bound shutdown. Expiry prevents new sends/imports.
Observation wire bodies have no expiry field: sender selection expiry governs
sending, while receiver admission independently uses peer `maxAgeMs` plus its
binding/peer/destination expiry. Revocation is local enrollment policy, not a live
registry-revocation query.

A missing, ended, replaced or fenced importer session **blocks**. A changed token
fingerprint cannot silently rebind. Pending imports whose expiry passed are also
blocked for reconciliation: an earlier append may already have happened. Restore
the exact original ledger/session together, inspect the canonical journal, and
reconcile explicitly; never delete the ledger or create a fresh session to make
an ambiguous import disappear. No automatic reconciliation, session migration,
ambiguous-send retry or pruning command is provided.

## Bounds and retention

The example chooses 10,000 delivery/ingress rows, a 64 MiB main DB, 10 events/page,
4 pages/destination/run, 50 total processed items/run, a 10 s run, 2 s requests,
and 1 s Wake/replay windows. Strict supported maxima are:

| Boundary | Maximum |
|---|---:|
| Destinations / pinned peers / Telegram senders per destination | 32 / 32 / 32 |
| Summary / parent IDs | 1,000 Unicode scalars / 16 |
| Profile / one private ledger row | 64 KiB / 32 KiB |
| Delivery+ingress rows / main SQLite DB | 100,000 / 256 MiB |
| SDK page / pages per destination / items per run | 50 / 20 / 200 |
| Run / request / replay sweep interval / Wake connection | 120 s / 30 s / 30 s / 30 s |
| Explicit watch | 1 h |
| HTTP response / Wake frame / Wake stream | 1 MiB / 8 KiB / 64 KiB |
| HTTP or Wake read iterations | 4,096 |
| MCP buffered frame / process stdout / stderr | configured HTTP cap / 8 MiB / 64 KiB |
| MCP forced shutdown wait | 500 ms |

Rows are retained until explicit operator reconciliation/archival; there is **no
silent TTL deletion** of idempotency evidence. At capacity, new work stops with
`ledger_full` or a redacted storage failure; existing evidence is not evicted.
SQLite uses FULL synchronous rollback journaling, not unbounded WAL; reserve
additional disk space for a rollback journal up to the main DB size. These are
finite local resource bounds, not guarantees against disk loss or dishonest
storage. Back up the canonical journal, courier ledger and dedicated session
credential together, privately and off-device. Do not archive/restart a fresh
ledger without preserving or deliberately reconciling replay/dedup history.

## Optional witness seam

`src/witness.ts` is a separately imported, injected host observer. Use
`createWitnessObserver(binding).observe(selection, {check_chain:false,signal})`
for selected local-sidecar evidence, and only an explicitly authorized
`check_chain:true` for a named RPC observation. A positive result requires the
selected actual anchor; exit zero or an empty anchor list proves nothing.
Normal courier status/run/watch imports no witness implementation, performs no
chain call, signs no transaction and has no wallet dependency. Witness results
are evidence, not transport receipt or task truth. The CLI intentionally has no
implicit chain-check flag.

## Local verification and remaining live checks

```sh
# From this package directory; create a fresh isolated HOME first.
env -i HOME="$PRIVATE_TEMP_HOME" PATH=/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin TMPDIR=/tmp \
  bun --no-env-file install --frozen-lockfile --ignore-scripts
env -i HOME="$PRIVATE_TEMP_HOME" PATH=/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin TMPDIR=/tmp \
  bun --no-env-file run ci
```

Runtime dependencies are pinned published SDK/undici/zod with this package's own
lock. Integration tests additionally need sibling `packages/collab` dependencies;
they run the real local MCP source, not live journals. They simulate **two devices**
using two temporary stores and genuinely signed events through a fake transport,
including explicitly selected Telegram feedback returned as a signed reply.
Crash tests cover sign/send/receipt/import/cursor and Telegram offset gaps, stable
resumption, auth/privacy/revocation/expiry and cancellation. Populated native
leases, pending review/handoff and acknowledged cursors remain unchanged across
both imported channels. CLI regressions cover real no-provider host cleanup,
stdin audience drift, and short-watch startup deadlines. No test proves real
second-device connectivity, hosted sender authorization, live Telegram ownership
or delivery, native harness attention, or chain confirmation. Those remain
separate opt-in checks with named endpoints, disclosures and stop/fee boundaries.
