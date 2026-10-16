# @agenttool/collab-zerone

> **Type:** reference · **Purpose:** witness Collab journal heads on zerone without making the chain an authority or publishing path-derived workspace ids.
> **Evidence:** source in `src/` and `bin/collab-zerone.ts`, hermetic tests in `tests/` (stubbed `zeroned`); no release, deployment or new live-chain observation is claimed here.

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
  agenttool.collab-anchor/0.2 alias=<32-hex> epoch=<32-hex> seq=<n> head=<64-hex>
  ```

  The two aliases stand in for the workspace and epoch ids, which never go on
  chain in a new memo; see
  [Memo protocols and the alias salt](#memo-protocols-and-the-alias-salt).
  This is the governance-free anchor path: any funded key can do it today.
  Fees: gas 100,000 × 1 uzrn/gas. The chain's fee floor is 1 uzrn/gas, and a
  memo-carrying send measured 82,772 gas on zerone-testnet-1 (the ante meters
  fee handling on top of the 21k bank-send table cost); simulation is not
  admission on zerone, so gas is fixed with honest headroom.
- **Keeps a sidecar anchor ledger**
  (`~/.local/share/agenttool/collab-zerone-anchors.json`, mode 0600, override
  with `AGENTOOL_COLLAB_ANCHOR_LEDGER`) with sticky broadcast-ambiguity
  discipline: once a broadcast is invoked, an unparseable outcome is recorded
  `ambiguous`, never assumed unsent. Each entry records its memo protocol
  and, for 0.2, the aliases it published. The alias salt sits beside the
  ledger at `<ledger>.salt`.
- **Reports five honest states** — `unanchored`, `anchor_pending`,
  `anchored`, `anchor_stale`, `anchor_conflict` — via the CLI here and via the
  `collab_anchor_status` MCP tool in `@agenttool/collab` (local file read
  only; a missing bridge is `unanchored`, never an error). `anchor_pending`
  always means an attempt is genuinely unresolved (submitted or ambiguous);
  attempts that definitively failed report as `unanchored`. States that vouch
  for history (`anchored`, `anchor_stale`) are backed by full recomputation
  from genesis in both the CLI and the MCP tool.

## Memo protocols and the alias salt

A Collab `ws_` id is a truncated sha256 of a repository key derived from a
local path (`packages/collab/src/store.ts`, `src/repository.ts`). A memo that
carries it lets anyone confirm a guessed path, so the memo protocol was bumped:

| Protocol | Memo body after the protocol string | `anchor` writes it | `verify`/`resolve` match it by |
|---|---|---|---|
| `agenttool.collab-anchor/0.1` (legacy) | `ws=<workspace_id> epoch=<epoch_id> seq=<n> head=<64-hex>` | no | the raw ids |
| `agenttool.collab-anchor/0.2` | `alias=<32-hex> epoch=<32-hex> seq=<n> head=<64-hex>` | yes | aliases re-derived from the salt |

- `alias` is the first 32 hex chars of HMAC-SHA256(key = salt, message =
  workspace_id). The `epoch` field is the same over `"epoch " + epoch_id`. The
  longest possible 0.2 memo is 196 characters, inside the 256 cap.
- **Why the epoch is aliased too.** Epoch ids are random UUIDs
  (`epoch_<uuid>`), so they reveal no path. They are linkable, though: legacy
  memos print the raw epoch id beside the `ws_` id, and the same id travels in
  Collab cursors and event anchors. A raw epoch in a 0.2 memo would tie the
  new alias straight back to an already-published `ws_` id. The `"epoch "`
  label keeps the two alias domains apart, since a workspace id never
  contains a space.
- **The salt** is 32 random bytes stored hex-encoded at `<ledger>.salt` with
  mode 0600. The first real `anchor` creates it with an atomic no-clobber
  link; `--dry-run` never creates it and labels its aliases illustrative when
  no salt exists yet. The salt never goes on chain. Back it up with the ledger.
- **Losing the salt fails closed,** because no recorded alias can be
  re-derived without it. `anchor` refuses (exit 2) rather than create a new
  salt once the ledger records any 0.2 entry, and refuses a salt that does not
  reproduce the recorded aliases (a replaced salt or edited entries). `verify`
  exits 2 for any 0.2 entry whose aliases or memo do not re-derive, and
  `resolve` refuses before any chain query. `status` and
  `collab_anchor_status` stay fail-open: their local states never depend on the
  salt, so `status` only warns. Restoring the original salt restores every path.
- **The ledger protocol is unchanged** (`agenttool.collab-zerone-ledger/0.1`).
  Entries gain `memo_protocol` and, for 0.2, `workspace_alias` and
  `epoch_alias`; an entry without `memo_protocol` is legacy 0.1. The local
  ledger still records the raw ids, which is how an alias maps back to its
  workspace. Deployed `@agenttool/collab` readers ignore the new fields.
- Each entry's on-chain memo is matched under that entry's own protocol only:
  a 0.1 memo never satisfies a 0.2 entry or the reverse, and an unknown
  protocol never matches.

What the alias does not do:

- It does not unpublish anything. Memos already on chain under 0.1 keep
  showing their `ws_` ids; `anchor` prints a note when the workspace has such
  attempts in the ledger.
- It does not make anchors unlinkable. Every anchor is a send from the same
  account, a workspace keeps one alias across epochs, and sequence numbers
  continue. It only stops a guessed path from being confirmed.
- A leaked salt turns the aliases back into confirmable path guesses.
- The private courier's witness observer
  (`packages/collab-courier/src/witness.ts`) still accepts only 0.1
  selections, so it reports a 0.2 anchor as `invalid_selection` (fail-closed)
  until it learns the 0.2 memo.

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
have an explicitly successful integer code 0, a positive safe-integer inclusion
height, a returned transaction hash matching the requested hash, a byte-identical
memo in the entry's own protocol matching its recorded sequence, hash and
workspace/epoch (raw ids for 0.1, aliases re-derived from the salt for 0.2),
and a valid recomputed local prefix, or verify exits 2. Missing or malformed
transaction fields (including a missing returned hash) remain unknown, never
code/height 0 defaults. `resolve`
upgrades submitted/ambiguous entries **only on this positive observation**;
absence of evidence never downgrades an entry and never authorises a re-broadcast.
`anchor` refuses to run over an
`anchor_conflict` without `--force`, because a fresh anchor would launder
tamper evidence into green.

**Unreleased source hardening:** the JSON verification report also names the
journal epoch. A zero exit with an empty anchor list is only an empty check;
it is not evidence for a selected transaction. Consumers must inspect the
selected record and distinguish a local sidecar report from a separately
requested RPC observation. The private courier observer uses this read-only
`verify` path with fixed host bindings and a fresh private HOME/cwd under the
host-selected scratch parent. It disables dotenv and Bun runtime configuration
(`--config=/dev/null`, no global config), so a nearby `bunfig.toml` preload cannot
replace the pinned verifier. Temporary runtime directories are removed afterward.
It never invokes `anchor`, `resolve`, or a keyring operation.

The outer verifier's combined pipes and, separately, the cumulative combined
pipes of its nested queries have the configured output ceiling (at most 1 MiB
each). `verify` uses asynchronous streaming queries: over-cap chunks and query
stderr are never retained, and each query has a kill deadline. Native
`Bun.spawnSync` buffering is not used on this read-only path. The outer POSIX
process group owns cancellation/teardown of all query descendants. The default
courier runner refuses Windows rather than claiming query-child teardown there.
These limits do not change the separate broadcast/keyring runner.

The observer labels network provenance `network_source: "host_binding"`:
it does not independently query chain ID, validate consensus, or establish
trustless finality. The returned transaction hash is checked against the query,
not cryptographically recomputed from raw transaction bytes. Normal courier
operation does not perform a remote check.

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
`tests/memo.test.ts` and `tests/alias.test.ts` pin both memo grammars, an
independently computed alias, and the salt file rules; `tests/cli.test.ts`
checks that broadcast arguments never carry the workspace or epoch id, that
mixed ledgers verify per protocol, and that a lost or replaced salt fails
closed; `tests/ledger-conformance.test.ts` reads 0.2 entries back through
`@agenttool/collab`.
