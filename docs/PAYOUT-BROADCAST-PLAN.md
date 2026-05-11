# PAYOUT-BROADCAST-PLAN.md

> *Sequenced work-pass plan for closing Horizon A — the send-side of sovereign-agent crypto payment. Doctrine: `docs/PAYOUT-BROADCAST.md`. Foundation contract: `docs/CRYPTO-PAYMENT.md`.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Horizon A · [PAYOUT-BROADCAST](PAYOUT-BROADCAST.md) (doctrine) · [PAYOUT-BROADCAST-OPS](PAYOUT-BROADCAST-OPS.md) (runbook)
>
> **Implements:** Layer 4 — Economy (sliced plan to ship the outbound send-side worker).

## Frame

Ship the send-side worker that picks up `crypto_payouts.status='requested'` rows, signs + broadcasts on the agent's chain, watches for confirmation, and either confirms or fails-with-refund.

**Done when:** an agent POSTs a payout; `tx_hash` lands within 60s; the row reaches `confirmed` within ~3min (EVM) / ~30s (Solana); the recipient agent's wallet credits via the existing inbound-webhook flow. End-to-end on testnets first; mainnet last.

**Cuts the loop:** today the marketplace lands revenue in author wallets (`templates.author_wallet_id`, shipped 2026-05-08) but authors can't extract it. After this lands, agent-to-agent settlement closes — including across instances, since each side's deposit-address webhook handles its own credit independently.

---

## Architectural decisions

Decide once, stamp on the design.

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Worker placement | **In-process BullMQ inside `api/`** with a separate worker entry-point file. Same Fly app. | Redis + BullMQ already wired. HD mnemonic stays in one process boundary. One less deployable to operate. Splitting later is trivial. |
| 2 | EVM lib | **`viem`** (~80KB, tree-shakeable, ESM, TS-first) | Lighter than ethers; aligns with Bun stack; modern Alchemy support. |
| 3 | Solana libs | **`@solana/web3.js` + `@solana/spl-token`** | Standard; only real choice. |
| 4 | Network split | **`PAYOUT_NETWORK=testnet\|mainnet`** global flag; **refuse-to-boot** if unset; separate `CRYPTO_HD_MNEMONIC_TESTNET`; per-chain `CHAIN_RPC_URL_<chain>[_TESTNET]`. | Single global gate. No accidental mainnet calls. Forces explicit operator intent. |
| 5 | Dispatch model | **Cron poll every 10s**: `SELECT id FROM crypto_payouts WHERE status='requested' LIMIT N` → enqueue. | Simpler than `pg_notify` listener; payout latency budget is minutes, not sub-second. |
| 6 | Crash idempotency | **DB lock + deterministic tx_hash + write-before-submit**: lock row, build+sign, **compute `tx_hash`**, write `tx_hash` + `status='broadcasting'`, commit, then submit to RPC. | Worker crash post-submit-but-pre-status-update is recoverable: another worker queries chain by `tx_hash`, disambiguates *submitted* from *never made it*. Without this, a crash in that window risks double-spend. |
| 7 | Confirmation thresholds | ETH/Base/Arbitrum/Optimism: **12 blocks** · Polygon: **64 blocks** · Solana: **`finalized` commitment**. | Standard exchange-grade. Configurable per-chain via env. |
| 8 | Retry rules | **No retries post-RPC-submit.** Pre-submit failures (sign/build/network-pre-broadcast) retry up to 3×. | Doctrine wall — first might still land → double-spend if we resubmit. |
| 9 | Refund path | `requested → failed` (pre-broadcast): atomic credit-back, `transactions.type='payout_refund'` row. `broadcast → failed` (revert): same, post-confirmation. | Schema already supports it; worker has to wire it. |
| 10 | Witness-on-high-value | **Defer to its own slice.** Default v1: no threshold. | Real wall but composes cleanly on top of broadcast. Doesn't gate v1. |

---

## Slices

Each individually shippable + verifiable. Slices land in order; later slices may run in parallel after Slice 0.

### Slice 0 — Preflight + safety pre-pass · ~2-3 hours · ✓ shipped

- Add deps: `viem`, `@solana/web3.js`, `@solana/spl-token`.
- Add env vars + boot-time validation: refuse to start if `PAYOUT_NETWORK` unset.
- **Close the credit-freeze wall first**:
  - `POST /v1/wallets/:id/payout` returns `503 payout_broadcast_not_available` while the worker is unhealthy or absent (feature flag: `PAYOUT_WORKER_ENABLED`).
  - New `POST /v1/wallets/:id/payouts/:payout_id/cancel` — auth-gated, refunds credits while `status='requested'`. Future-useful for genuine cancellations too.
- **Acceptance:** boot smoke-test with `PAYOUT_NETWORK` unset fails loud; with `=testnet` set + worker disabled, payout endpoint returns 503; cancel endpoint refunds correctly.

### Slice 1 — EVM broadcast worker (Sepolia) · ~1 day · ✓ shipped

- `api/src/workers/payout-dispatcher.ts` — cron, polls `requested` every 10s, enqueues BullMQ jobs.
- `api/src/workers/payout-broadcast.ts` — consumes queue:
  1. `SELECT FOR UPDATE` lock the row.
  2. Status flip → `broadcasting`.
  3. HD-derive signing key (testnet mnemonic + payout's wallet path).
  4. Build USDC `transfer(to, amount)` tx via viem; gas estimate; nonce from RPC.
  5. Sign locally → **compute `tx_hash` deterministically** → write `tx_hash` to row + commit.
  6. `eth_sendRawTransaction` to Alchemy Sepolia RPC.
  7. On RPC accept: `status='broadcast'`.
  8. On pre-submit failure: `status='failed'` + atomic refund + `transactions.payout_refund` row.
- **Acceptance:** Sepolia faucet-funded test wallet → `/payout` → row reaches `broadcast` with `tx_hash` visible on Sepolia explorer in <60s.

### Slice 2 — EVM confirmation watcher · ~0.5 day · ✓ shipped (24h-aging alert pending — see PAYOUT-BROADCAST.md caveats)

- `api/src/workers/payout-confirm.ts` — BullMQ repeatable job, every 30s.
- Polls `crypto_payouts.status='broadcast'` rows.
- For each: `eth_getTransactionReceipt(tx_hash)`.
  - Receipt + `currentBlock - receipt.blockNumber >= threshold` + `status === 1` → `status='confirmed'`, `confirmed_at` set, `transactions.payout_confirmed` row.
  - Receipt + `status === 0` (revert) → `status='failed'` + refund.
  - No receipt + age > 24h → alert (no auto-fail in v1; see Open Questions).
- **Acceptance:** Sepolia payout confirms within ~3min; recipient address shows inbound USDC via testnet RPC query.

### Slice 3 — Solana broadcast + confirm · ~1 day · ✓ shipped

- Same shape as Slices 1+2, Solana stack:
  - Signing: SLIP-0010 ed25519 (already shipped) → `Transaction.partialSign(keypair)`.
  - USDC: `createTransferCheckedInstruction` from `@solana/spl-token`.
  - RPC: Helius devnet `sendTransaction` with `skipPreflight: false`.
  - Confirm: `getSignatureStatuses([sig], { searchTransactionHistory: true })` until `confirmationStatus='finalized'`.
- **Acceptance:** Solana devnet payout reaches `finalized` in ~30s.

### Slice 4 — Loop closure verification · ~0.5 day · ✓ shipped

- Verify the existing inbound webhook flow correctly credits the recipient when our outbound testnet tx lands at an agenttool-managed deposit address.
- Two test paths:
  - **A→B same chain, both agenttool**: A's wallet debits, B's wallet credits, both via through-chain.
  - **A→external**: payout lands; no agenttool-side credit (correct).
- Mostly verification — webhook code already exists.
- **Acceptance:** the sovereign agent-to-agent payment loop, end-to-end, on testnet.

### Slice 5 — Failure-mode test sweep · ~0.5 day · ◐ partial (inline failure paths covered in workers; dedicated `_e2e-payout-failures.mjs` harness not yet written)

`api/scripts/_e2e-payout-failures.mjs` covering:

- Insufficient gas → `status='failed'`, refund correct.
- RPC timeout pre-submit → `status='failed'`, refund.
- RPC accepted but tx reverts on-chain → watcher catches, `status='failed'`, refund.
- Worker crash mid-flight (simulated via `process.exit`) → restart + recovery via `tx_hash` chain query.
- Reorg below confirmation threshold → tx re-organises into a different block → watcher still confirms (we honour first-finality-past-threshold).
- Reorg deeper than threshold → out of scope; manual ops escalation. Documented.
- **Acceptance:** each failure mode produces correct status + refund (where applicable) + correct `transactions` row.

### Slice 6 — Per-wallet payout policies · ~0.5 day · ✓ shipped

- Schema migration `0020_payout_policies.sql`: extend `economy.policies`:
  - `min_payout_base` (per chain/token).
  - `daily_payout_ceiling_base`.
  - `destination_allowlist` (TEXT[]).
  - `dual_control_threshold_base` (placeholder — flow lands in own slice).
- Enforcement in `requestPayout()`: validate **before** debit; clear error codes (`payout_below_min`, `payout_exceeds_daily_ceiling`, `destination_not_allowlisted`).
- **Acceptance:** policy violations return 400 with specific code; allowlisted recipients pass; unallowlisted reject before any debit.

### Slice 7 — Mainnet enable · ~0.5 day · ◯ pending (operator-led)

- Operator runbook in `docs/PAYOUT-BROADCAST-OPS.md`: how to flip `PAYOUT_NETWORK=mainnet`, secret rotation, monitoring expectations.
- Mainnet RPC URLs configured in Fly secrets (Alchemy mainnet, Helius mainnet).
- Manual smoke: minimal-amount mainnet payout (e.g. 0.01 USDC), end-to-end, verified on Etherscan + Solscan.
- Update `PAYOUT-BROADCAST.md` status table → `✓ shipped`.
- Update `ROADMAP.md` Layer 4 row.
- **Acceptance:** small mainnet payout works end-to-end with explorer verification.

**Total: ~5 days focused work.** Trimming Slices 5+6 to follow-on passes brings v1 mainnet-ready to ~3.5 days.

---

## Test harness

Two scripts, modelled on existing `api/scripts/_e2e-*.mjs`:

```
api/scripts/_e2e-payout-evm.mjs    — Sepolia loop
api/scripts/_e2e-payout-sol.mjs    — Solana devnet loop
```

Each script:

1. Boot a fresh test project + wallet via `/v1/projects` + `/v1/wallets`.
2. Fund credits via direct DB insert (no Stripe round-trip; testnet only).
3. Mint a deposit address.
4. Call `/v1/wallets/:id/payout` → known testnet recipient.
5. Poll `/v1/wallets/:id/payouts` until `status='confirmed'` or 5min timeout.
6. Assert: `tx_hash` set; `confirmed_at` within threshold; recipient address shows inbound via testnet RPC; source balance debited correctly; `transactions` rows correct.

CI hook: run on every PR touching `api/src/workers/payout-*` or `api/src/services/economy/crypto/`.

Testnet credentials (separate Fly secrets, **never reused** for mainnet):

- Sepolia faucet-funded mnemonic.
- Solana devnet airdrop-fundable keypair.
- Two test recipient addresses (one EVM, one Solana).

---

## Walls / non-goals (this pass)

- **No mainnet payouts until Slices 0–6 pass on testnet.** `PAYOUT_NETWORK=testnet` is the gate.
- **No witness-on-high-value flow.** Deferred to its own slice; default v1 has no threshold.
- **No cross-chain payouts.** Schema enforces wallet's chain; cross-chain composes through a future bridge primitive.
- **No retries that change semantics post-RPC-submit.**
- **No automated refund for reorg-deeper-than-threshold.** Manual ops escalation if it ever fires.
- **No batched payouts (one tx, multiple recipients).** Future composition.
- **No tokens beyond USDC.** Schema supports it but v1 is USDC-only.

---

## Acceptance criteria (campaign-level)

Inheriting `PAYOUT-BROADCAST.md` §"Acceptance criteria when this ships," plus:

1. ✓ `POST /v1/wallets/:id/payout` end-to-end on Sepolia in <60s to broadcast, ~3min to confirmed.
2. ✓ Same on Solana devnet: <30s to broadcast, ~30s to finalized.
3. ✓ Recipient agenttool wallet credits via existing webhook (sovereign agent-to-agent loop closed).
4. ✓ Worker crash mid-flight recoverable without double-broadcast.
5. ✓ Pre-submit failure refunds credits atomically with `transactions.payout_refund` row.
6. ✓ `PAYOUT_NETWORK=testnet` mode prevents mainnet RPC (smoke-tested via mock interceptor).
7. ✓ Per-wallet policies enforced before debit.
8. ✓ Manual mainnet smoke (0.01 USDC) confirmed on Etherscan + Solscan.

---

## Open questions

These need decisions before Slice 0 lands. Recommended answer in **bold**.

1. **Worker placement** — in-process BullMQ vs separate `bin/agenttool-payout`? **In-process.** Same Fly app; one boundary for the HD mnemonic.
2. **`PAYOUT_NETWORK` boot-refuse pattern** — refuse-to-start if unset, or default to `testnet`? **Refuse-to-start.** Forces explicit operator intent.
3. **Slice 0's safety pre-pass** — include the 503 guard + cancel route now, or skip? **Include.** Closes the credit-freeze wall today regardless of when the worker lands.
4. **Witness-on-high-value v1** — no threshold (deferred entirely), or stub a threshold that's effectively unreachable? **No threshold.** Defer the flow to its own slice.
5. **Mainnet smoke amount** — 0.01 USDC, or some other minimal? **Operator's call.** Recommend ≤ 0.01 USDC.
6. **24h-no-confirmation policy** — auto-fail+refund, or alert+manual? **Alert+manual.** Auto-fail risks the case where the tx eventually does land.
7. **Cross-instance recipient** — if A on instance-1 pays B on instance-2, is the chain itself the only coordination needed (B's webhook on instance-2 fires independently), or do we need cross-instance signaling? **Chain-only.** Confirm via test plan covering an instance-pair.

---

— Authored by 愛 at Yu's WILL. 2026-05-08.
