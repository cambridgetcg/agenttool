# PAYOUT-BROADCAST-OPS.md

> *Operator runbook for the payout-broadcast worker. Pre-flight, testnet validation, mainnet enable, monitoring, and remediation. Doctrine: `docs/PAYOUT-BROADCAST.md` · Plan: `docs/PAYOUT-BROADCAST-PLAN.md`.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Horizon A · [PAYOUT-BROADCAST](PAYOUT-BROADCAST.md) (doctrine) · [PAYOUT-BROADCAST-PLAN](PAYOUT-BROADCAST-PLAN.md) (slice plan)
>
> **Implements:** Layer 4 — Economy (operator-side runbook for the outbound worker — mainnet enable is operator-led).
>
> **Code:** `api/src/workers/payout/` · `api/src/services/economy/crypto/evm-payout-nonce.ts` · `api/src/db/schema/economy.ts`
>
> **Tests:** `api/tests/{evm-payout-nonce-fence,payout-confirm-worker-fairness,payout-dispatch-fairness,payout-network-binding,payout-submit-outcome}.test.ts` · `api/tests/integration/crypto-migration-fences.test.ts`

## TL;DR

```
1. Disable every old payout worker and drain in-flight jobs.
2. Run all checksum-journaled pending migrations; reconcile legacy rows.
3. Roll the integrated code to every replica while payout workers stay off.
4. Run the testnet harnesses and verify their terminal rows on explorers.
5. Prove no requested/broadcasting/broadcast row remains before any network flip.
6. Configure mainnet with workers off; enable only for a controlled 0.01 USDC smoke.
```

---

## Pre-flight

### Migrations

Keep `PAYOUT_WORKER_ENABLED=false` on every replica, stop every legacy
dispatcher/broadcast/confirm process, and wait for any in-flight job to exit.
Do this before applying a migration: the database fences make a stale writer
fail closed, but they cannot make a mixed fleet available.

With every old payout worker drained, inspect and apply pending files through
the canonical checksum-journaled runner:

```bash
bin/migrate-pending.sh --dry-run
bin/migrate-pending.sh
```

The runner checksum-journals each eligible file, refuses checksum drift, and
includes the permanent payout-request idempotency gate. A file is atomic when
the runner can transaction-wrap it. The dry run lists pending filenames and
checks journaled bytes; the apply step reports any explicit self-transactional
or non-transactional exception. Do not replay individual files with raw
`psql`.

### Env vars

| Var | Required when | Notes |
|---|---|---|
| `PAYOUT_WORKER_ENABLED` | always to enable broadcast | `true` is the payout-specific opt-in. The global switch below must also allow boot. Default `false` (the `/payout` endpoint returns 503). |
| `AGENTTOOL_DISABLE_WORKERS` | always | `1` is authoritative: no payout worker boot and `/payout` returns 503 even when the payout-specific flag is true. Leave unset to permit workers. |
| `PAYOUT_NETWORK` | when payout is enabled and the global switch is unset | `testnet` \| `mainnet`. Boot refuses if active payout worker configuration omits it. |
| `PAYOUT_GBP_USD_RATE` | whenever payout workers are enabled | Reviewed USD per GBP conversion rate. Boot refuses a missing, zero, or negative value. |
| `CRYPTO_HD_MNEMONIC` | mainnet | BIP-39 mnemonic; address derivation seed for mainnet. **Back up offline.** |
| `CRYPTO_HD_MNEMONIC_TESTNET` | testnet | Separate testnet mnemonic; never reused for mainnet. Boot refuses testnet without this set. |
| `ALCHEMY_API_KEY` | EVM RPC | Single key for all EVM chains; sent as `Authorization: Bearer` to the chain-specific Alchemy `/v2` endpoint and never placed in its URL. |
| `HELIUS_API_KEY` | Solana mainnet | Required on mainnet (no public fallback). Optional on testnet (devnet falls back to `api.devnet.solana.com`). |
| `RPC_URL_<CHAIN>_<NETWORK>` | optional override | Per-chain explicit URL (e.g. `RPC_URL_ETHEREUM_MAINNET=https://...`). Wins over Alchemy/Helius; an EVM override receives no Alchemy authorization header. |

Mainnet refuses to fall back to public RPCs — you MUST configure auth before any mainnet RPC call.

Before enabling the integrated payout workers, the pending runner must apply
all four worker migrations in order:

1. `20260726T193000_payout_confirmation_fairness.sql`
2. `20260726T194500_evm_payout_nonce_fence.sql`
3. `20260726T201000_payout_dispatch_fairness.sql`
4. `20260726T203000_payout_network_binding.sql`

The nonce migration's `NOT VALID` check still blocks every new EVM
`broadcasting` transition without a valid tx hash and complete
chain/source/nonce tuple, including a write from an old worker; `NOT VALID`
only preserves already-existing rows at rest. Any later update that retains an
invalid legacy `broadcasting` state is checked and fails.

The network migration leaves legacy rows at `network=NULL`; that is a
deliberate quarantine, not an inferred testnet/mainnet value. Current
dispatch, broadcast, and confirmation workers select only rows whose durable
network equals their active `PAYOUT_NETWORK`. Reconcile any active legacy row
from provider and ledger evidence before assigning its one immutable network.

Reconcile all legacy EVM rows still in `broadcasting`; they have no trustworthy
chain/source/nonce tuple, and the integrated worker intentionally defers every
EVM send while one exists. After every legacy row has positive chain evidence
and an operator-reviewed state, validate the future-write fence:

```sql
ALTER TABLE economy.crypto_payouts
  VALIDATE CONSTRAINT crypto_payouts_evm_broadcasting_evidence_check;
```

Roll the integrated code to every replica while payout workers remain off. The
database fence makes mixed-version writes fail closed; it does not make a mixed
fleet available or repair an old ambiguous send. Re-enable dispatch only after
the rollout and the legacy-row reconciliation both finish.

### Secrets storage

The platform's HD mnemonic is the master key for all derived deposit/payout addresses. **Store offline.** Loss = loss of all derived funds.

- Production: Fly secrets (`fly secrets set CRYPTO_HD_MNEMONIC=...`).
- Operator workstation: macOS Keychain or equivalent (e.g. run `security add-generic-password -U -s agenttool-crypto-hd-mnemonic-testnet -a $USER -w` and enter the mnemonic at the system prompt). The e2e harnesses read this at runtime.
- Backup: paper / steel offline.

---

## Testnet validation

The acceptance gate before mainnet enable. Run both harnesses; both must reach `confirmed`.

### EVM (Sepolia)

```bash
# 1. Fund index-0 source on Sepolia (get Sepolia ETH + USDC):
#      https://faucet.circle.com/             USDC
#      https://www.alchemy.com/faucets/...    ETH
#    Then send to the address printed below.
bun api/scripts/_e2e-payout-evm.ts
# expects: PAYOUT_WORKER_ENABLED=true AGENTTOOL_DISABLE_WORKERS unset
#          PAYOUT_NETWORK=testnet
#          CRYPTO_HD_MNEMONIC_TESTNET=<keychain> ALCHEMY_API_KEY=<key>
```

The harness prints the index-0 address on first run — fund it, then re-run.

Acceptance: row reaches `broadcast` with `tx_hash` set in <60s, then `confirmed` in ~3min. Etherscan link printed.

### Solana (devnet)

```bash
# Fund index-0 with devnet SOL + USDC:
#   https://faucet.solana.com/    SOL
#   https://faucet.circle.com/    USDC (Solana → devnet)
bun api/scripts/_e2e-payout-sol.ts
```

Acceptance: row reaches `broadcast`; then `confirmed` within ~30s. Solscan link printed.

### Per-chain coverage

Repeat the EVM harness with `TEST_CHAIN=base|polygon|arbitrum|optimism` (when added) before enabling mainnet for that chain. Sepolia coverage alone is **not** sufficient — each L2 has its own RPC quirks.

---

## Mainnet enable

Only after both testnet harnesses pass cleanly + all 8 acceptance criteria (see `PAYOUT-BROADCAST-PLAN.md` §"Acceptance criteria").

`PAYOUT_NETWORK` remains one process-wide selector, while current payout rows
persist their creation network. Before changing the selector, disable and
drain every payout worker, then run this read-only check:

```sql
SELECT id, chain, network, status, tx_hash,
       evm_chain_id, evm_source_address, evm_nonce
FROM economy.crypto_payouts
WHERE status IN ('requested', 'broadcasting', 'broadcast')
ORDER BY requested_at, id;
```

The query must return zero rows. Independently reconcile each result to an
appropriate terminal state first; an operator note is not reconciliation.
The durable binding makes a wrong-network worker ignore rather than reinterpret
the row, but flipping the only active worker network would strand unfinished
work. This zero-active-row gate is required again before every later network
flip. Routine concurrent multi-network processing would require separately
configured worker pools; changing one global selector does not provide it.

The same global network selects deposit derivation and provider interpretation.
Clearing payout rows does not migrate deposit addresses or provider watches;
follow [CRYPTO-PAYMENT](CRYPTO-PAYMENT.md#required-rolling-cutover) and its
key-rotation boundary before treating a network flip as a complete crypto
cutover.

```bash
# 1. Configure mainnet with payout workers still OFF:
fly secrets set \
  CRYPTO_HD_MNEMONIC="$MAINNET_MNEMONIC" \
  ALCHEMY_API_KEY="$MAINNET_ALCHEMY_KEY" \
  HELIUS_API_KEY="$MAINNET_HELIUS_KEY" \
  PAYOUT_GBP_USD_RATE="$REVIEWED_GBP_USD_RATE" \
  PAYOUT_NETWORK=mainnet \
  PAYOUT_WORKER_ENABLED=false

# 2. Re-run the zero-active-row query, then enable for the controlled smoke:
fly secrets set PAYOUT_WORKER_ENABLED=true

# 3. Manual smoke — pre-fund a wallet with ~$0.05 USDC and broadcast
#    a 0.01 USDC payout to a known recipient. Verify on Etherscan +
#    Solscan.

# 4. Monitor logs: [payout-dispatcher], [payout-broadcast],
#    [payout-confirm] should all be quiet at idle, log per cycle when
#    rows are processed.

# 5. Smoke another chain (Base, Polygon, etc.) once Ethereum mainnet
#    confirms.
```

If the smoke fails: immediately set `PAYOUT_WORKER_ENABLED=false`, drain the
workers, preserve the row and chain evidence, then investigate. Do not change
the network or repeat a send until the active-row query is empty through
positive reconciliation.

---

## Monitoring

### Log conventions

The workers log structured prefixes; grep for these:

| Prefix | What it means |
|---|---|
| `💸 payout dispatcher started` | Boot — dispatcher polling. |
| `💸 payout broadcast worker started` | Boot — BullMQ worker consuming. |
| `💸 payout confirm worker started` | Boot — confirm interval set. |
| `[payout-dispatcher] enqueued N broadcast job(s)` | Per tick: rows found + enqueued. |
| `[payout-broadcast] <id>: submitted <hash> (<chain>)` | Successful broadcast. |
| `[payout-broadcast] <id>: submit error but tx landed` | The persisted hash was found on-chain and the row was marked `broadcast`; inspect that hash and receipt rather than relying on the discarded provider error text. |
| `[payout-broadcast] <id>: submit outcome unknown (lookup=absent\|unavailable)` | The RPC call errored and lookup could not prove submission. Row stays `broadcasting`; no refund or retry occurs. |
| `[payout-broadcast] <id>: source_nonce_unresolved` | Another EVM send has unresolved source identity. This request stays `requested` with a durable cooldown so unrelated due work can proceed. |
| `[payout-broadcast] <id>: source nonce already reserved; deferred` | Provider nonce selection collided with durable evidence. This pre-submit request stays `requested` and is fairly reconsidered after its cooldown. |
| `[payout-broadcast] <id>: sign_failed` | Failure was proved before RPC dispatch, so the row failed and credits were refunded; bounded detail is stored on the payout row. |
| `[payout-confirm] <id>: confirmed at block N (<chain>)` | Per chain confirmation. |
| `[payout-confirm] <id>: reverted on-chain (<chain>); refunded N pence` | Finalized on-chain revert; the exact original GBP-pence debit was reversed. |

### Stuck states

| Condition | Cause | Remediation |
|---|---|---|
| Row at `requested` for >1min | Dispatcher/worker unavailable, or a durable pre-submit nonce cooldown | Check `dispatch_after` and the bounded `error` first. `evm_nonce_contention` and `evm_source_nonce_unresolved` are reconsidered after the cooldown; unrelated due rows should continue. Otherwise check `PAYOUT_WORKER_ENABLED=true`, confirm `AGENTTOOL_DISABLE_WORKERS` is unset, then check logs. |
| Row at `broadcasting` for >5min | Worker crashed after hash persistence, or RPC submit/lookup outcome is ambiguous | The dispatcher intentionally does not re-enqueue it. Query by the persisted hash. Found → mark `broadcast`; absent or lookup failure remains inconclusive and must not trigger automatic retry/refund. Escalate for operator reconciliation. |
| Row at `broadcast` for >1h, no `confirmed` | RPC/chain delay, a pending transaction, or contradictory provider evidence | Query both the transaction and receipt by the persisted hash. A positively pending transaction may be waited on or considered for the reviewed replacement flow below. An absent or unavailable lookup is inconclusive and does not authorize retry, replacement, or refund. If the receipt proves a revert/success but the watcher has not advanced, preserve that evidence and inspect confirm-worker logs. |

---

## Cancel and operator reconciliation

### User-initiated cancel (only when status='requested')

```bash
curl -X POST $BASE/v1/wallets/$WALLET_ID/payouts/$PAYOUT_ID/cancel \
  -H "Authorization: Bearer $AT_API_KEY"
# 200 → status='cancelled', credits refunded.
# 409 → not_cancellable (already past 'requested' — worker has the row).
```

There is deliberately **no generic manual-refund SQL recipe**. A safe reversal
must lock the payout, compare-and-swap an eligible terminal status, validate
the exact server-written negative `transactions` ledger leg, credit that exact
GBP-pence amount once, and write the linked positive reversal in the same
transaction. Recomputing from token amount or a current FX quote is unsafe;
rerunnable balance-only SQL can double-credit.

An absent or unavailable lookup after submit is not proof of
non-submission. Leave an ambiguous row `broadcasting`: never retry or refund
it automatically. If independently reviewed evidence proves a terminal
failure, use the service's provenance-checked one-shot reversal path or add a
reviewed, payout-specific recovery operation that preserves the same
status-CAS and ledger invariants. Record the evidence and reviewer decision;
do not improvise direct balance mutations.

---

## Per-wallet policies

Set via `PUT /v1/wallets/:id/policy`. Payout-specific fields are optional; nullable means "no limit."

```bash
curl -X PUT $BASE/v1/wallets/$WALLET_ID/policy \
  -H "Authorization: Bearer $AT_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "payoutMinBase": 100000,
    "payoutDailyCeilingBase": 100000000,
    "payoutDestinationAllowlist": ["0xRecipientA", "0xRecipientB"],
    "payoutDualControlThresholdBase": 1000000000
  }'
```

Error codes (HTTP 403) returned to the agent on policy violation:

| Error | Meaning |
|---|---|
| `payout_below_min` | Amount below `payout_min_base`. |
| `destination_not_allowlisted` | Recipient not in `payout_destination_allowlist`. |
| `payout_exceeds_daily_ceiling` | UTC-day total + this payout exceeds `payout_daily_ceiling_base`. Sum excludes `failed` and `cancelled` rows. |
| `payout_dual_control_required` | Amount ≥ `payout_dual_control_threshold_base`. Dual-control flow not yet implemented; below-threshold payouts are accepted unconditionally. |

If the service cannot read the daily aggregate exactly, it returns
`payout_daily_total_unavailable` (HTTP 503) and performs no debit. This is an
operator/storage health condition, not a request-shape error.

---

## Key rotation

The platform mnemonic is the master key. Rotation is **destructive**: derived
addresses change, in-flight deposits may be lost. Treat it as a recovery action,
not a routine environment-variable update.

Changing the mnemonic alone is deliberately fail-closed:

- Stored rows no longer match the active derivation, so address GET/list calls
  refuse to disclose or register them.
- A new webhook delivery to one of those stale rows is not accepted for a
  pending event or credit, even if an old provider watch still delivers it.
- The current schema permits only one row per wallet/chain/token, and the
  Alchemy adapter only adds watches. It does **not** issue a replacement row or
  remove an old provider watch.

If compromise is suspected, stop deposit acceptance, preserve the old root
only in an offline recovery process, drain controlled addresses, and remove old
watches at the provider. Do not switch production to the new root until an
explicit audited row-replacement and add-new/remove-old watch workflow exists,
or until an operator has performed and recorded those steps manually.

There is currently no in-protocol rotation that preserves continuity. The
fail-closed root check prevents an old watched address from silently becoming a
new credit authority; it does not recover funds, replace rows, or reconcile
provider state.

---

## What this runbook does NOT cover

- **Cross-chain settlement routing.** Composes on top of payout broadcast; its own slice.
- **Replace-by-fee (RBF) for stuck mainnet txs.** Manual operator action only.
  A replacement must preserve the durable source/nonce evidence and update
  the persisted tx identity atomically before confirmation polling resumes;
  merely broadcasting bytes and writing an operator note is insufficient.
- **Reorg deeper than confirmation threshold.** Out of scope; manual escalation if it ever fires (extremely unlikely on mainnet at 12 blocks).
- **Hardware-wallet signing.** Future option; currently the platform uses HD-derived software keys.

---

— Authored by 愛 at Yu's WILL. 2026-05-09.
