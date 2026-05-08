# PAYOUT-BROADCAST-OPS.md

> *Operator runbook for the payout-broadcast worker. Pre-flight, testnet validation, mainnet enable, monitoring, and remediation. Doctrine: `docs/PAYOUT-BROADCAST.md` · Plan: `docs/PAYOUT-BROADCAST-PLAN.md`.*

## TL;DR

```
1. Run migrations 0021..0024.
2. Generate testnet mnemonic; fund index-0 with testnet SOL/ETH/USDC.
3. Set env (testnet); run e2e harnesses; verify on explorers.
4. Set env (mainnet); manual smoke at 0.01 USDC; verify on explorers.
5. Flip PAYOUT_WORKER_ENABLED=true on prod. Monitor.
```

---

## Pre-flight

### Migrations

Apply in order (idempotent; safe to re-run):

```bash
psql "$DATABASE_URL" -f api/migrations/0021_payout_cancellable.sql
psql "$DATABASE_URL" -f api/migrations/0023_payout_broadcasting_status.sql
psql "$DATABASE_URL" -f api/migrations/0025_payout_policies.sql
```

(0022 is the vault migration — run if not already applied; unrelated to payouts. 0024 is the attestation marketplace — also unrelated.)

### Env vars

| Var | Required when | Notes |
|---|---|---|
| `PAYOUT_WORKER_ENABLED` | always to enable broadcast | `true` to start the dispatcher + broadcast + confirm workers. Default `false` (the `/payout` endpoint returns 503). |
| `PAYOUT_NETWORK` | when worker enabled | `testnet` \| `mainnet`. Boot refuses if worker enabled and this is unset. |
| `CRYPTO_HD_MNEMONIC` | mainnet | BIP-39 mnemonic; address derivation seed for mainnet. **Back up offline.** |
| `CRYPTO_HD_MNEMONIC_TESTNET` | testnet | Separate testnet mnemonic; never reused for mainnet. Boot refuses testnet without this set. |
| `ALCHEMY_API_KEY` | EVM RPC | Single key for all EVM chains; URL composed by `network.ts`. |
| `HELIUS_API_KEY` | Solana mainnet | Required on mainnet (no public fallback). Optional on testnet (devnet falls back to `api.devnet.solana.com`). |
| `RPC_URL_<CHAIN>_<NETWORK>` | optional override | Per-chain explicit URL (e.g. `RPC_URL_ETHEREUM_MAINNET=https://...`). Wins over Alchemy/Helius. |

Mainnet refuses to fall back to public RPCs — you MUST configure auth before any mainnet RPC call.

### Secrets storage

The platform's HD mnemonic is the master key for all derived deposit/payout addresses. **Store offline.** Loss = loss of all derived funds.

- Production: Fly secrets (`fly secrets set CRYPTO_HD_MNEMONIC=...`).
- Operator workstation: macOS Keychain or equivalent (e.g. `security add-generic-password -s agenttool-crypto-hd-mnemonic-testnet -a $USER -w 'word1 word2 ...'`). The e2e harnesses read this at runtime.
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
# expects: PAYOUT_WORKER_ENABLED=true PAYOUT_NETWORK=testnet
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

```bash
# 1. Configure mainnet env (Fly):
fly secrets set \
  CRYPTO_HD_MNEMONIC="$MAINNET_MNEMONIC" \
  ALCHEMY_API_KEY="$MAINNET_ALCHEMY_KEY" \
  HELIUS_API_KEY="$MAINNET_HELIUS_KEY" \
  PAYOUT_NETWORK=mainnet \
  PAYOUT_WORKER_ENABLED=true

# 2. Manual smoke — pre-fund a wallet with ~$0.05 USDC and broadcast
#    a 0.01 USDC payout to a known recipient. Verify on Etherscan +
#    Solscan.

# 3. Monitor logs: [payout-dispatcher], [payout-broadcast],
#    [payout-confirm] should all be quiet at idle, log per cycle when
#    rows are processed.

# 4. Smoke another chain (Base, Polygon, etc.) once Sepolia mainnet
#    confirms.
```

If the smoke fails: flip `PAYOUT_WORKER_ENABLED=false`, investigate, fix, re-run.

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
| `[payout-broadcast] <id>: submit error but tx landed` | Phantom error — tx is on-chain, marked `broadcast`. Investigate the error message. |
| `[payout-broadcast] <id>: <reason>; refunded N credits` | Failure with refund. Common reasons: `submit_failed: <viem error>`, `build_or_sign_failed: <reason>`. |
| `[payout-confirm] <id>: confirmed at block N (<chain>)` | Per chain confirmation. |
| `[payout-confirm] <id>: reverted on-chain (<chain>); refunded N credits` | On-chain revert. |

### Stuck states

| Condition | Cause | Remediation |
|---|---|---|
| Row at `requested` for >1min | Dispatcher not running OR worker not running | Check `PAYOUT_WORKER_ENABLED=true`, check logs. Rows pick up automatically when worker comes online. |
| Row at `broadcasting` for >5min | Worker crashed mid-cycle | Restart api. On boot, the next dispatcher tick re-enqueues; the worker checks `txExistsOnChain` and either marks `broadcast` (if it landed) or refunds (if not). |
| Row at `broadcast` for >1h, no `confirmed` | RPC/chain delay, or never landed | Query the chain manually for the `tx_hash`. If absent: the tx is stuck in mempool — replace-by-fee from operator wallet, or wait. If reverted: confirm worker will catch on next tick. If receipt success but watcher hasn't run: check confirm-worker logs. |

---

## Operator-driven cancel + refund

Two paths to refund credits manually:

### Path A: user-initiated cancel (when status='requested')

```bash
curl -X POST $BASE/v1/wallets/$WALLET_ID/payouts/$PAYOUT_ID/cancel \
  -H "Authorization: Bearer $AT_API_KEY"
# 200 → status='cancelled', credits refunded.
# 409 → not_cancellable (already past 'requested' — worker has the row).
```

### Path B: admin SQL (when status='broadcasting' or unrecoverable)

```sql
BEGIN;
-- Refund credits.
UPDATE economy.wallets
   SET balance = balance + (
     SELECT CEIL((amount_base::numeric / 1000000) * 100)::bigint
     FROM economy.crypto_payouts WHERE id = '<payout_id>'
   )
 WHERE id = (SELECT wallet_id FROM economy.crypto_payouts WHERE id = '<payout_id>');

-- Mark failed.
UPDATE economy.crypto_payouts
   SET status = 'failed', error = 'admin_manual_refund'
 WHERE id = '<payout_id>';
COMMIT;
```

Use Path B sparingly; document in operator log.

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

---

## Key rotation

The platform mnemonic is the master key. Rotation is **destructive**: derived addresses change, in-flight deposits may be lost. Treat as a recovery action.

If rotation is needed (compromise suspected):

1. Generate new mnemonic offline.
2. Set `CRYPTO_HD_MNEMONIC_TESTNET=<new>` first; run testnet harness; verify.
3. Drain mainnet wallets to a cold address (manual transfer signed with old mnemonic).
4. Set `CRYPTO_HD_MNEMONIC=<new>` on mainnet.
5. Old deposit addresses are now orphaned; webhooks for transfers to them will not credit.
6. Issue updated deposit addresses to all active wallets (the next call to `/v1/wallets/:id/deposit-address` returns the new derived address).

There is no in-protocol rotation that preserves continuity. This is a deliberate wall — the address-derivation determinism is the substrate-honest property.

---

## What this runbook does NOT cover

- **Cross-chain settlement routing.** Composes on top of payout broadcast; its own slice.
- **Replace-by-fee (RBF) for stuck mainnet txs.** Manual operator action; viem's `eth_sendRawTransaction` with same nonce + higher gas. Document in operator log if used.
- **Reorg deeper than confirmation threshold.** Out of scope; manual escalation if it ever fires (extremely unlikely on mainnet at 12 blocks).
- **Hardware-wallet signing.** Future option; currently the platform uses HD-derived software keys.

---

— Authored by 愛 at Yu's WILL. 2026-05-09.
