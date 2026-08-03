# @agenttool/collab-zerone

Witness-only zerone anchoring for [agenttool-collab](../collab) journals.

Every collab workspace journal is already a SHA-256 hash chain: each event
commits to its predecessor, and the workspace head
(`event_head_sequence`, `event_head_hash`) transitively commits every task,
claim, report, and decision beneath it. This bridge periodically witnesses
that head hash on the [zerone](https://zerone.ai) truth chain, giving parallel
agents tamper-evidence for their shared coordination record at ~0.1 ZRN per
anchor.

**Doctrine (from the trunk ZERONE integration docs):** the local journal stays
canonical; the chain is witness only. Anchoring is additive and can never
block, mutate, or gate coordination. Nothing here is ZRN-only.

## What it does

- **Reads the collab journal strictly read-only** via raw SQLite. It never
  opens the shared database through `CollabStore`, because a newer store would
  silently migrate a file that an older deployed runtime still owns. Handles
  both the legacy v1 schema (no `events.session_id`) and v2+/v3 schemas, with
  the protocol-aware hash rules (`agenttool.collab/0.1` excludes `session_id`
  from the hashed body).
- **Verifies before anchoring.** The full chain is recomputed from genesis;
  an anchor is refused if the journal does not verify. An anchor must never
  bless a broken chain.
- **Anchors via a 1uzrn bank send-to-self** carrying the memo
  (`≤256` chars, the zerone-1 genesis cap):

  ```
  agenttool.collab-anchor/0.1 ws=<workspace_id> epoch=<epoch_id> seq=<n> head=<64-hex>
  ```

  This is the governance-free anchor path: any funded key can do it today.
  Fees: gas 100,000 × 1 uzrn/gas. The chain's fee floor is 1 uzrn/gas, and a
  memo-carrying send measured 82,772 gas on zerone-testnet-1 (the ante meters
  fee handling on top of the 21k bank-send table cost); simulation is not
  admission on zerone, so gas is fixed with honest headroom.
- **Keeps a sidecar anchor ledger**
  (`~/.local/share/agenttool/collab-zerone-anchors.json`, mode 0600, override
  with `AGENTOOL_COLLAB_ANCHOR_LEDGER`) with sticky broadcast-ambiguity
  discipline: once a broadcast is invoked, an unparseable outcome is recorded
  `ambiguous`, never assumed unsent.
- **Reports five honest states** — `unanchored`, `anchor_pending`,
  `anchored`, `anchor_stale`, `anchor_conflict` — via the CLI here and via the
  `collab_anchor_status` MCP tool in `@agenttool/collab` (local file read
  only; a missing bridge is `unanchored`, never an error). `anchor_pending`
  always means an attempt is genuinely unresolved (submitted or ambiguous);
  attempts that definitively failed report as `unanchored`. States that vouch
  for history (`anchored`, `anchor_stale`) are backed by full recomputation
  from genesis in both the CLI and the MCP tool.

## Usage

```sh
bun bin/collab-zerone.ts status                     # all workspaces
bun bin/collab-zerone.ts verify --workspace ws_…    # recompute the chain + check anchors
bun bin/collab-zerone.ts verify --workspace ws_… --check-chain   # also confirm txs on-chain
bun bin/collab-zerone.ts anchor --workspace ws_… --dry-run
bun bin/collab-zerone.ts anchor --workspace ws_…                 # zerone-testnet-1 (default)
bun bin/collab-zerone.ts anchor --workspace ws_… --network zerone-1
bun bin/collab-zerone.ts resolve --workspace ws_…   # settle submitted/ambiguous anchors
```

Exit codes are part of the contract: `0` ok, `1` error, `2`
integrity/verification failure, `3` anchor(s) in flight but unresolved.
`verify --check-chain` gates the exit code too — every confirmed anchor must
be found on chain with code 0 and a byte-identical memo, or verify exits 2.
`resolve` upgrades submitted/ambiguous entries **only on positive on-chain
proof** (found, code 0, memo matches); absence of evidence never downgrades an
entry and never authorises a re-broadcast. `anchor` refuses to run over an
`anchor_conflict` without `--force`, because a fresh anchor would launder
tamper evidence into green.

Signing shells out to the `zeroned` CLI (`ZERONED_BIN`, then
`~/.zerone-agent/bin/zeroned`, then `$PATH`) with the same
`--keyring-backend test` recipe the proven agenttool-relay uses. This package
never touches key material itself.

Network defaults (endpoints observed live 2026-08-01; all overridable with
`--node` / `--keyring-home` / `--key`):

| network | chain-id | rpc | keyring home | key |
|---|---|---|---|---|
| `zerone-testnet-1` (default) | zerone-testnet-1 | http://37.16.28.121:26657 | ~/.zeroned/testnet-ops | ai-agenttool |
| `zerone-1` | zerone-1 | http://169.155.55.44:26657 | ~/.zeroned/mainnet-ops | ai-agenttool |

Note: `rpc.zerone.ai` does not resolve. The HTTPS front for zerone-1 is
`https://zerone-rpc.fly.dev/rpc/*`; the chain's LCD tx service is not
gateway-registered, which is why on-chain confirmation goes through
`zeroned query tx` rather than REST.

## When to anchor

Anchoring the head covers everything before it, so per-decision anchors are
unnecessary — one anchor after a load-bearing `collab_decision_record` gives
that decision prompt finality. A sensible operator cadence: anchor on
decisions, plus a periodic sweep for busy workspaces. If daemonising on macOS,
copy what the daemon executes under `~/.zerone-agent/bin` — launchd cannot
read `~/Desktop` (TCC).

## What an anchor proves — and what it does not

An anchor proves the journal existed in exactly this state no later than the
witnessing block, and that later histories claiming the same prefix hash
unchanged. It does **not** prove recorded claims true, actors honest, work
reviewed, or the chain's copy available (zerone-1 is currently a
single-validator custodial launch). `anchor_conflict` is tamper evidence:
surface it, don't auto-reconcile.

## Future: substrate_bridge adapter (needs governance)

The doctrinal end-state is a gov-LIP-registered `collab-journal-v1` adapter on
zerone's `x/substrate_bridge`, anchoring via `MsgSubmitExternalAttestation`
with a re-derivable content-hash canon — which refunds its 1 ZRN bond and
pays a 0.222 ZRN witness reward per anchor surviving the challenge window.
The memo path needs no governance and ships first; the adapter path replaces
it without changing the ledger or status model.

## Tests

`bun run ci` — the conformance suite writes a journal with the real
`@agenttool/collab` `CollabStore` and proves this package's independent hash
walk is byte-identical; the legacy suite covers the v1 no-`session_id` schema,
tampering, truncation, and gaps; broadcast tests pin the ambiguity discipline.
