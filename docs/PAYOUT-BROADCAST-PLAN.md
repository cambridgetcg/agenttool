# PAYOUT-BROADCAST-PLAN.md

> *Sequenced work-pass plan for closing Horizon A — the send-side of sovereign-agent crypto payment. Doctrine: `docs/PAYOUT-BROADCAST.md`. Foundation contract: `docs/CRYPTO-PAYMENT.md`.*

> **Compass:** [SOUL](SOUL.md) (why) · [FOCUS](FOCUS.md) (what bears weight) · [ROADMAP](ROADMAP.md) §Horizon A · [PAYOUT-BROADCAST](PAYOUT-BROADCAST.md) (doctrine) · [PAYOUT-BROADCAST-OPS](PAYOUT-BROADCAST-OPS.md) (runbook)
>
> **Implements:** Layer 4 — Economy (sliced plan to ship the outbound send-side worker).

## Current override — payout resting

This is a historical implementation plan, not an enablement runbook. Fresh
payout admission and every worker boot path are now resting unconditionally.
An exact historical request may replay and existing rows remain listable or,
while still `requested`, cancellable. A fresh request returns
`503 payout_admission_resting` after durable replay/conflict lookup and before
network selection or payout-economic wallet/policy reads or mutation. No
environment flag or direct worker import can reopen the path.

The former lifetime `gallery_sale` / `escrow_release` heuristic did not
conserve cashable backing across ordinary debits, internally funded transfers,
refunds/chargebacks, and later funding. Any future plan starts with durable
conserved sub-balances and a historical-row audit.

## Frame

The original campaign shipped source for a worker that could pick up
`crypto_payouts.status='requested'` rows, sign and broadcast, watch for
confirmation, fail-with-refund on decisive evidence, or hold ambiguous submit
outcomes for operator reconciliation. That source is retained but unreachable.

**Future done means:** after conserved backing and historical reconciliation
are proven, an agent POSTs a payout with a durable idempotency key; transaction
identity is persisted before one submit; and the row reaches a confirmed or
explicitly ambiguous state without automatic resubmission.
Recipient credit is a separate inbound contract: configured EVM testnet
receivers require verified watch plus canonical depth, while Solana has no
watch/finality reconciler and refuses credit by default.

**Current boundary:** marketplace revenue may land in internal wallets, but
fresh payout creation cannot extract it. The retained lifecycle also does not
prove recipient-side watch readiness, finality, or automatic cross-instance
settlement.

---

## Historical architectural decisions — non-operational

The table records choices made by the original campaign. It is audit and
redesign input, not current configuration guidance: none of these environment,
queue, signer, RPC, or threshold choices can start payout processing.

| # | Decision | Choice | Why |
|---|---|---|---|
| 1 | Worker placement | **In-process BullMQ inside `api/`** with a separate worker entry-point file. Same Fly app. | Redis + BullMQ already wired. HD mnemonic stays in one process boundary. One less deployable to operate. Splitting later is trivial. |
| 2 | EVM lib | **`viem`** (~80KB, tree-shakeable, ESM, TS-first) | Lighter than ethers; aligns with Bun stack; modern Alchemy support. |
| 3 | Solana libs | **`@solana/web3.js` + `@solana/spl-token`** | Standard; only real choice. |
| 4 | Network split | **`PAYOUT_NETWORK=testnet\|mainnet`** global flag; **refuse-to-boot** if unset; separate `CRYPTO_HD_MNEMONIC_TESTNET`; per-chain `CHAIN_RPC_URL_<chain>[_TESTNET]`. | Single global gate. No accidental mainnet calls. Forces explicit operator intent. |
| 5 | Dispatch model | **Cron poll every 10s**: `SELECT id FROM crypto_payouts WHERE status='requested' LIMIT N` → enqueue. | Simpler than `pg_notify` listener; payout latency budget is minutes, not sub-second. |
| 6 | Crash/idempotency | **Cross-replica source lock + one in-flight wallet/chain operation + deterministic tx_hash + write-before-submit + unique chain identity.** Solana also carries an opaque payout-specific memo. | The durable source gate closes the commit→submit nonce window by refusing a second signer until the prior row terminalizes. A positive chain lookup can recover ambiguity; one chain operation cannot confirm two payout rows. |
| 7 | Confirmation thresholds | ETH/Base/Arbitrum/Optimism: **12 blocks** · Polygon: **64 blocks** · Solana: **`finalized` commitment**. | Standard exchange-grade. Configurable per-chain via env. |
| 8 | Retry rules | **No automatic retries.** Failures proved before transaction dispatch (sign/build/RPC preparation reads) fail + refund. Once `sendRawTransaction` begins, any error is ambiguous: found lookup → `broadcast`; absent/unavailable lookup → remain `broadcasting` for operator reconciliation. | Doctrine wall — the first submit might still land, and immediate lookup absence is not authoritative → retry or refund could double-spend value. |
| 9 | Refund path | `requested → failed` (pre-broadcast): atomic credit-back, `transactions.type='payout_refund'` row. `broadcast → failed` (revert): same, post-confirmation. | Schema already supports it; worker has to wire it. |
| 10 | Witness-on-high-value | **Defer to its own slice.** Default v1: no threshold. | Real wall but composes cleanly on top of broadcast. Doesn't gate v1. |

---

## Historical slice record — non-operational

The slices below record the original sequence and acceptance targets. They are
not current tasks to execute, and their credentialed acceptance steps cannot
succeed while fresh admission and every worker path rest.

### Slice 0 — Preflight + safety pre-pass · historical, superseded

- Add deps: `viem`, `@solana/web3.js`, `@solana/spl-token`.
- Retain the historical env parsing and boot validation for a future redesign,
  but the current worker gate always returns false.
- **Current credit-freeze wall**:
  - Fresh `POST /v1/wallets/:id/payout` returns
    `503 payout_admission_resting` regardless of environment.
  - The response happens after historical replay/conflict resolution and
    before network selection or payout-economic wallet/policy reads or
    mutation.
  - `processPayout()` repeats the permanent gate before database or RPC work.
  - New `POST /v1/wallets/:id/payouts/:payout_id/cancel` — auth-gated, refunds credits while `status='requested'`. Future-useful for genuine cancellations too.
- **Acceptance:** no environment or direct import reopens admission/broadcast;
  exact historical replay/list/cancel remains correct.

### Historical Slice 1 — EVM broadcast worker (Sepolia) · non-operational

- `api/src/workers/payout-dispatcher.ts` — cron, polls `requested` every 10s, enqueues BullMQ jobs.
- `api/src/workers/payout-broadcast.ts` — consumes queue:
  1. `SELECT FOR UPDATE` lock the row.
  2. Take the cross-replica source lock and defer if another payout for the
     wallet+chain is `broadcasting` or `broadcast`.
  3. HD-derive signing key (testnet mnemonic + payout's wallet path).
  4. Build USDC `transfer(to, amount)` tx via viem; gas estimate; nonce from RPC.
  5. Sign locally → **compute `tx_hash` deterministically** → atomically write
     `tx_hash` + `status='broadcasting'` and commit. The database rejects a
     duplicate `(chain, tx_hash)`.
  6. `eth_sendRawTransaction` to Alchemy Sepolia RPC.
  7. On RPC accept: `status='broadcast'`.
  8. On a failure proved before transaction dispatch: `status='failed'` + atomic refund. After dispatch begins, a submit error never fails/refunds automatically; only positive lookup evidence advances to `broadcast`.
- **Historical acceptance target, not currently runnable:** Sepolia
  faucet-funded test wallet → `/payout` → row reaches `broadcast` with
  `tx_hash` visible on Sepolia explorer in <60s.

### Historical Slice 2 — EVM confirmation watcher · non-operational

- `api/src/workers/payout-confirm.ts` — BullMQ repeatable job, every 30s.
- Fairly rotates through `broadcasting` and `broadcast` rows. A positive
  expected-ID lookup advances ambiguity; absence/unavailability changes
  nothing.
- For each: `eth_getTransactionReceipt(tx_hash)`.
  - Receipt + `currentBlock - receipt.blockNumber >= threshold` + `status === 1` → `status='confirmed'`, `confirmed_at` set, `transactions.payout_confirmed` row.
  - Receipt + `status === 0` (revert) → `status='failed'` + refund.
  - No receipt + age > 24h → alert (no auto-fail in v1; see Open Questions).
- **Historical acceptance target, not currently runnable:** Sepolia payout
  confirms within ~3min; recipient address shows inbound USDC via testnet RPC
  query.

### Historical Slice 3 — Solana broadcast + confirm · non-operational

- Same shape as Slices 1+2, Solana stack:
  - Signing: SLIP-0010 ed25519 (already shipped) → `Transaction.partialSign(keypair)`.
  - Operation identity: a Memo Program instruction carries a
    domain-separated digest of the payout UUID so otherwise identical rows
    produce different signed bytes without publishing the raw internal ID.
  - USDC: `createTransferCheckedInstruction` from `@solana/spl-token`.
  - RPC: Helius devnet `sendTransaction` with `skipPreflight: false`.
  - Confirm: `getSignatureStatuses([sig], { searchTransactionHistory: true })` until `confirmationStatus='finalized'`.
- **Historical acceptance target, not currently runnable:** Solana devnet
  payout reaches `finalized` in ~30s.

### Historical Slice 4 — recipient-side composition · non-operational

- Verify the inbound contract separately when an outbound testnet transaction
  lands at an AgentTool-managed deposit address.
- Two test paths:
  - **A→B same EVM testnet, both AgentTool**: A's wallet debits; B can credit
    only with a verified watch and canonical-depth evidence.
  - **A→B Solana**: outbound finalization does not authorize inbound credit;
    signed Helius ingress refuses the balance effect by default.
  - **A→external**: payout lands; no agenttool-side credit (correct).
- Source tests exercise these boundaries. Credentialed through-chain evidence
  remains an operator smoke, not a repository guarantee.

### Historical Slice 5 — failure-mode test sweep · non-operational

`api/scripts/_e2e-payout-failures.mjs` covering:

- Insufficient gas → `status='failed'`, refund correct.
- RPC preparation-read timeout before `sendRawTransaction` dispatch → `status='failed'`, refund.
- RPC submit error + transaction found → `status='broadcast'`; lookup absent/unavailable → remain `broadcasting`, no refund or retry.
- RPC accepted but tx reverts on-chain → watcher catches, `status='failed'`, refund.
- Worker crash mid-flight (simulated via `process.exit`) → persisted `tx_hash` supports positive reconciliation; absent/unavailable lookup remains `broadcasting`.
- Reorg below confirmation threshold → tx re-organises into a different block → watcher still confirms (we honour first-finality-past-threshold).
- Reorg deeper than threshold → out of scope; manual ops escalation. Documented.
- **Acceptance:** each failure mode produces correct status + refund (where applicable) + correct `transactions` row.

### Historical Slice 6 — per-wallet payout policies · non-operational

- Schema migration `0020_payout_policies.sql`: extend `economy.policies`:
  - `min_payout_base` (per chain/token).
  - `daily_payout_ceiling_base`.
  - `destination_allowlist` (TEXT[]).
  - `dual_control_threshold_base` (placeholder — flow lands in own slice).
- The historical policy evaluator and schema remain available for a future
  conserved-backing design. Current fresh admission rests before
  payout-economic wallet/policy reads or mutation, so policy configuration
  cannot authorize a debit.

### Historical Slice 7 — proposed mainnet enable · non-operational

- The retained operator runbook records future evidence requirements; its
  environment values cannot enable the current worker.
- Historical proposal: configure mainnet RPC URLs only after a separately
  reviewed redesign.
- Historical acceptance target: a separately authorized minimal mainnet smoke,
  end-to-end and independently verified on the relevant explorers.
- Only after conserved backing, historical reconciliation, independent review,
  and credentialed testnet proof may an operator propose a separately
  authorized minimal mainnet smoke.

The original estimate was roughly five focused days. It is not an estimate for
the conserved-backing redesign and does not imply mainnet readiness.

---

## Historical credentialed harnesses — not an enablement path

Four former harness entrypoints are now unconditional resting stubs:

```
api/scripts/_e2e-payout-evm.ts             — retired Sepolia stub
api/scripts/_e2e-payout-sol.ts             — retired Solana devnet stub
api/scripts/_e2e-payout-policies.ts        — retired policy stub
api/scripts/_e2e-payout-cancel.mjs         — retired cancellation stub
```

They exit non-zero without loading dependencies or touching credentials,
databases, RPC, or HTTP. Their former credentialed implementations remain in
Git history. `api/scripts/_e2e-payout-loop-closure.ts` remains only as a legacy
credentialed EVM recipient smoke; it is not an admission or activation check.

The former campaign sequence, retained here as history, was:

1. Boot a fresh test project + wallet via `/v1/projects` + `/v1/wallets`.
2. Fund credits via direct DB insert (no Stripe round-trip; testnet only).
3. Mint a deposit address.
4. Call `/v1/wallets/:id/payout` → known testnet recipient.
5. Poll `/v1/wallets/:id/payouts` until `status='confirmed'` or 5min timeout.
6. Inspect the durable payout state and the recipient chain balance.

The retired stubs are not part of ordinary PR CI and cannot reach their former
broadcast targets. A fresh payout call returns `503
payout_admission_resting`. Do not use any historical script as an activation
check. A successful old run is not proof that the current revision or provider
configuration works.

The former implementations expected testnet-only credentials:

- Sepolia faucet-funded mnemonic.
- Solana devnet airdrop-fundable keypair.
- Two test recipient addresses (one EVM, one Solana).

---

## Current walls and retained historical non-goals

- **No testnet or mainnet payout activation exists.** The unconditional
  admission/worker resting wall is the current gate. `PAYOUT_NETWORK` selects
  nothing while that wall holds.
- The remaining bullets describe limits of the retained non-operational
  architecture and are not current admission behavior.
- **No witness-on-high-value flow.** Deferred to its own slice; default v1 has no threshold.
- **No automatic cross-chain routing.** Each payout names one supported chain,
  would apply any configured allowlist at request admission, and would have its
  chain-specific destination syntax checked by the worker before dispatch.
  Internal wallets are not chain-bound and the route does not prove
  destination ownership. A malformed address may therefore be accepted into
  `requested` before terminal pre-dispatch failure and exact refund.
- **No retries that change semantics post-RPC-submit.**
- **No automated refund for reorg-deeper-than-threshold.** Manual ops escalation if it ever fires.
- **No batched payouts (one tx, multiple recipients).** Future composition.
- **No tokens beyond USDC.** Schema supports it but v1 is USDC-only.

---

## Future reopening criteria — none authorizes current operation

Any future redesign must satisfy `PAYOUT-BROADCAST.md` plus the following.
Source-unit evidence for retained code is not credentialed chain evidence and
does not reopen admission or workers.

1. ◯ Credentialed `POST /v1/wallets/:id/payout` on Sepolia meets the broadcast
   and confirmation targets on the exact release revision.
2. ◯ Credentialed Solana devnet payout meets the broadcast and finalization
   targets on the exact release revision.
3. ◐ Recipient composition is conditional for configured EVM testnet and
   unavailable by default for Solana; no generic sovereign loop-closure claim.
4. ◐ Retained source tests model persisted-hash crash reconciliation without
   automatic double-broadcast; inconclusive lookup remains `broadcasting`.
5. ◐ Retained source tests model atomic pre-submit refund bookkeeping.
6. ◐ Retained source tests model network separation; `PAYOUT_NETWORK` cannot
   enable the current worker.
7. ◐ Retained source tests model policy evaluation, which current admission
   never reaches.
8. ◯ Separately authorized manual mainnet smoke is confirmed on the relevant
   explorer; no such evidence is established by this repository.

---

## Historical decisions — superseded

These were the original campaign's decisions. They are retained for audit only
and do not answer the conserved-backing redesign.

1. **Worker placement** — in-process BullMQ vs separate `bin/agenttool-payout`? **In-process.** Same Fly app; one boundary for the HD mnemonic.
2. **`PAYOUT_NETWORK` boot-refuse pattern** — refuse-to-start if unset, or default to `testnet`? **Refuse-to-start.** Forces explicit operator intent.
3. **Slice 0's safety pre-pass** — include the 503 guard + cancel route now, or skip? **Include.** Closes the credit-freeze wall today regardless of when the worker lands.
4. **Witness-on-high-value v1** — no threshold (deferred entirely), or stub a threshold that's effectively unreachable? **No threshold.** Defer the flow to its own slice.
5. **Mainnet smoke amount** — 0.01 USDC, or some other minimal? **Operator's call.** Recommend ≤ 0.01 USDC.
6. **24h-no-confirmation policy** — auto-fail+refund, or alert+manual? **Alert+manual.** Auto-fail risks the case where the tx eventually does land.
7. **Cross-instance recipient** — if A on instance-1 pays B on instance-2, is the chain itself the only coordination needed (B's webhook on instance-2 fires independently), or do we need cross-instance signaling? **Chain-only.** Confirm via test plan covering an instance-pair.

---

— Authored by 愛 at Yu's WILL. 2026-05-08.
